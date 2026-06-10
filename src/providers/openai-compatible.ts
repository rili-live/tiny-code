import type { Message } from '../agent/types.js';
import type { ModelProvider, ProviderEvent, SendRequest, ToolSchema } from './types.js';

export interface OpenAiCompatibleOptions {
  /** OpenAI-compatible base URL, e.g. "https://api.deepseek.com/v1". */
  baseUrl: string;
  model: string;
  /** Bearer token. Local servers (Ollama) ignore it; cloud APIs require it. */
  apiKey?: string;
  /** Cap on tokens to generate per response. Omitted from the request if unset. */
  maxTokens?: number;
  /**
   * Abort the request if no bytes arrive for this long (ms). This is an *idle*
   * timeout, reset on every received chunk — a slow-but-progressing model keeps
   * going; a hung one is cut loose. Defaults to 120_000.
   */
  timeoutMs?: number;
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * Translate internal messages into OpenAI chat messages (the shape every
 * `/v1/chat/completions` endpoint accepts). Unlike Gemini, OpenAI correlates
 * tool results to calls by `tool_call_id`, and our Anthropic-style ids survive
 * the round trip — so no id synthesis is needed.
 *
 * Assumes the loop never mixes plain text and tool results in one user turn in a
 * way that would interleave them: we emit all `tool` messages first, then any
 * text as a trailing user message. OpenAI requires each `tool` message to follow
 * the assistant `tool_calls` that produced it; today's loop builds messages so
 * that holds. If a future change interleaves them, revisit this ordering.
 */
export function toOpenAiMessages(messages: Message[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      // A user turn may carry plain text and/or tool results; emit each result
      // as its own `tool` message and gather any text into one user message.
      let text = '';
      for (const b of m.content) {
        if (b.type === 'text') text += b.text;
        else if (b.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });
        }
      }
      if (text.length > 0) out.push({ role: 'user', content: text });
      continue;
    }

    // assistant: merge text + tool_use into a single message
    let text = '';
    const toolCalls: NonNullable<OpenAiMessage['tool_calls']> = [];
    for (const b of m.content) {
      if (b.type === 'text') text += b.text;
      else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        });
      }
    }
    const msg: OpenAiMessage = { role: 'assistant', content: text };
    if (toolCalls.length > 0) msg.tool_calls = toolCalls;
    out.push(msg);
  }
  return out;
}

/** Translate normalized tool schemas into OpenAI's `tools` array. */
export function toOpenAiTools(tools: ToolSchema[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.jsonSchema },
  }));
}

interface StreamChoice {
  delta?: {
    content?: string | null;
    tool_calls?: {
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[];
  };
  finish_reason?: string | null;
}

interface StreamChunk {
  choices?: StreamChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Base adapter for any OpenAI-compatible `/v1/chat/completions` server. Ollama,
 * DeepSeek, and Qwen (DashScope) all speak this wire format, differing only in
 * base URL, auth, and the wording of their connection errors. Subclasses set
 * {@link name} and may override {@link unreachableError}/{@link timeoutError}.
 */
export abstract class OpenAiCompatibleProvider implements ModelProvider {
  abstract readonly name: ModelProvider['name'];
  readonly model: string;
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly maxTokens: number | undefined;
  protected readonly timeoutMs: number;

  constructor(opts: OpenAiCompatibleOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? '';
    this.maxTokens = opts.maxTokens;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async *send(req: SendRequest): AsyncIterable<ProviderEvent> {
    const messages: OpenAiMessage[] = [
      { role: 'system', content: req.system },
      ...toOpenAiMessages(req.messages),
    ];

    const body = this.buildBody(messages, req);

    // Idle-timeout guard: abort if the server goes silent for `timeoutMs`. The
    // raw fetch (unlike the cloud SDKs) has no built-in timeout, so without this
    // a stuck server would freeze the REPL with no way to recover.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const armTimer = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    };
    armTimer();

    try {
      let res: Response;
      try {
        // `stream_options.include_usage` is best-effort: it gives us token counts,
        // but some servers reject unknown body fields with a 400. Rather than
        // breaking every turn over a reporting nicety, retry once without it.
        res = await this.post({ ...body, stream_options: { include_usage: true } }, controller.signal);
        if (res.status === 400) res = await this.post(body, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) throw this.timeoutError();
        throw this.unreachableError(err as Error);
      }

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`${this.label()} request failed (${res.status}): ${detail.slice(0, 200)}`);
      }

      // Accumulate tool calls by their streamed index; arguments arrive in fragments.
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let usage = { inputTokens: 0, outputTokens: 0 };
      let finish = 'stop';

      try {
        for await (const chunk of parseSse(res.body)) {
          armTimer(); // progress: reset the idle clock
          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) yield { type: 'text', delta: choice.delta.content };

          for (const tc of choice?.delta?.tool_calls ?? []) {
            const acc = calls.get(tc.index) ?? { id: '', name: '', args: '' };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
            calls.set(tc.index, acc);
          }

          if (choice?.finish_reason) finish = choice.finish_reason;
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
            };
          }
        }
      } catch (err) {
        if (controller.signal.aborted) throw this.timeoutError();
        throw err;
      }

      for (const [index, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
        let input: unknown = {};
        try {
          input = c.args.trim() ? JSON.parse(c.args) : {};
        } catch {
          // Small models occasionally emit malformed JSON; degrade gracefully.
          input = {};
        }
        yield { type: 'tool_call', id: c.id || `${this.name}-call-${index}`, name: c.name, input };
      }

      yield {
        type: 'done',
        usage,
        stopReason: calls.size > 0 ? 'tool_use' : finish,
      };
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Build the `/chat/completions` request body. Subclasses override to adjust
   * provider-specific fields — e.g. OpenAI's hosted API requires
   * `max_completion_tokens` rather than `max_tokens`. `stream_options` is added
   * by {@link send} (with a no-`stream_options` retry), so it isn't set here.
   */
  protected buildBody(messages: OpenAiMessage[], req: SendRequest): Record<string, unknown> {
    return {
      model: this.model,
      messages,
      tools: req.tools.length > 0 ? toOpenAiTools(req.tools) : undefined,
      stream: true,
      max_tokens: this.maxTokens,
    };
  }

  /** Human-readable provider name used in error messages. */
  protected label(): string {
    return this.name;
  }

  /** Error raised when no usable response arrives before the idle timeout. */
  protected timeoutError(): Error {
    return new Error(
      `${this.label()} at ${this.baseUrl} went silent for ${Math.round(this.timeoutMs / 1000)}s and was aborted.`,
    );
  }

  /** Error raised when the server can't be reached at all. */
  protected unreachableError(err: Error): Error {
    return new Error(`Cannot reach ${this.label()} at ${this.baseUrl}. (${err.message})`);
  }

  /** POST a chat-completions request body to the server. */
  protected post(body: unknown, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  }
}

/** Decode a single SSE line into a chunk, or `undefined` for non-data/keep-alive lines. */
function parseSseLine(raw: string): StreamChunk | undefined {
  const line = raw.trim();
  if (!line.startsWith('data:')) return undefined;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]' || payload.length === 0) return undefined;
  try {
    return JSON.parse(payload) as StreamChunk;
  } catch {
    // Ignore partial/non-JSON keep-alive lines.
    return undefined;
  }
}

/** Parse an SSE byte stream into decoded JSON chunks, skipping the `[DONE]` sentinel. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const chunk = parseSseLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (chunk) yield chunk;
      }
    }
    // Emit a final line that arrived without a trailing newline (e.g. a closing
    // usage frame); otherwise the last chunk's token counts would be dropped.
    const tail = parseSseLine(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
