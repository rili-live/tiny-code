import type { Message } from '../agent/types.js';
import type { ModelProvider, ProviderEvent, SendRequest, ToolSchema } from './types.js';

export interface OllamaProviderOptions {
  /** OpenAI-compatible base URL, e.g. "http://localhost:11434/v1". */
  baseUrl: string;
  model: string;
  /** Ignored by Ollama but required by the OpenAI wire format; defaults to "ollama". */
  apiKey?: string;
  /**
   * Abort the request if no bytes arrive for this long (ms). This is an *idle*
   * timeout, reset on every received chunk — a slow-but-progressing model keeps
   * going; a hung one (common when the machine is RAM-starved) is cut loose.
   * Defaults to 120_000.
   */
  timeoutMs?: number;
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * Translate internal messages into OpenAI chat messages (the shape Ollama's
 * `/v1/chat/completions` endpoint accepts). Unlike Gemini, OpenAI correlates
 * tool results to calls by `tool_call_id`, and our Anthropic-style ids survive
 * the round trip — so no id synthesis is needed.
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

export class OllamaProvider implements ModelProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? 'ollama';
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async *send(req: SendRequest): AsyncIterable<ProviderEvent> {
    const messages: OpenAiMessage[] = [
      { role: 'system', content: req.system },
      ...toOpenAiMessages(req.messages),
    ];

    const body = {
      model: this.model,
      messages,
      tools: req.tools.length > 0 ? toOpenAiTools(req.tools) : undefined,
      stream: true,
    };

    // Idle-timeout guard: abort if the server goes silent for `timeoutMs`. The
    // raw fetch (unlike the cloud SDKs) has no built-in timeout, so without this
    // a stuck local model would freeze the REPL with no way to recover.
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
        // but older Ollama builds reject unknown body fields with a 400. Rather than
        // breaking every local turn over a reporting nicety, retry once without it.
        res = await this.post({ ...body, stream_options: { include_usage: true } }, controller.signal);
        if (res.status === 400) res = await this.post(body, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) throw this.timeoutError();
        throw new Error(
          `Cannot reach Ollama at ${this.baseUrl}. Is 'ollama serve' running? (${(err as Error).message})`,
        );
      }

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Ollama request failed (${res.status}): ${detail.slice(0, 200)}`);
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
        yield { type: 'tool_call', id: c.id || `ollama-call-${index}`, name: c.name, input };
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

  private timeoutError(): Error {
    return new Error(
      `Ollama at ${this.baseUrl} went silent for ${Math.round(this.timeoutMs / 1000)}s and was aborted. ` +
        `The model '${this.model}' may be too large for this machine.`,
    );
  }

  /** POST a chat-completions request body to the Ollama server. */
  private post(body: unknown, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  }
}

/** Parse an SSE byte stream into decoded JSON chunks, skipping the `[DONE]` sentinel. */
async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
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
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]' || payload.length === 0) continue;
        try {
          yield JSON.parse(payload) as StreamChunk;
        } catch {
          // Ignore partial/non-JSON keep-alive lines.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
