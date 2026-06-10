import type { ModelProvider, ProviderEvent, SendRequest } from './types.js';
import {
  type OpenAiMessage,
  toOpenAiMessages,
  toOpenAiTools,
  parseSse,
} from './openaiFormat.js';

export { toOpenAiMessages, toOpenAiTools } from './openaiFormat.js';

export interface OllamaProviderOptions {
  /** OpenAI-compatible base URL, e.g. "http://localhost:11434/v1". */
  baseUrl: string;
  model: string;
  /** Ignored by Ollama but required by the OpenAI wire format; defaults to "ollama". */
  apiKey?: string;
  /** Cap on tokens to generate per response. Omitted from the request if unset. */
  maxTokens?: number;
  /**
   * Abort the request if no bytes arrive for this long (ms). This is an *idle*
   * timeout, reset on every received chunk — a slow-but-progressing model keeps
   * going; a hung one (common when the machine is RAM-starved) is cut loose.
   * Defaults to 120_000.
   */
  timeoutMs?: number;
}

export class OllamaProvider implements ModelProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxTokens: number | undefined;
  private readonly timeoutMs: number;

  constructor(opts: OllamaProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? 'ollama';
    this.maxTokens = opts.maxTokens;
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
      max_tokens: this.maxTokens,
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

