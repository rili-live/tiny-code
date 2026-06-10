import type { ModelProvider, ProviderEvent, SendRequest } from './types.js';
import { toOpenAiMessages, toOpenAiTools, parseSse } from './openaiFormat.js';

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  /** Cap on tokens to generate per response. Omitted from the request if unset. */
  maxTokens?: number;
  /** Override the base URL, e.g. for Azure OpenAI or a compatible proxy. Defaults to https://api.openai.com/v1. */
  baseUrl?: string;
}

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxTokens: number | undefined;

  constructor(opts: OpenAIProviderOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.maxTokens = opts.maxTokens;
  }

  async *send(req: SendRequest): AsyncIterable<ProviderEvent> {
    const messages = [
      { role: 'system' as const, content: req.system },
      ...toOpenAiMessages(req.messages),
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      tools: req.tools.length > 0 ? toOpenAiTools(req.tools) : undefined,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (this.maxTokens !== undefined) body.max_completion_tokens = this.maxTokens;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Cannot reach OpenAI at ${this.baseUrl}: ${(err as Error).message}`);
    }

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI request failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    // Accumulate tool calls by their streamed index; arguments arrive in fragments.
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finish = 'stop';

    for await (const chunk of parseSse(res.body)) {
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

    for (const [index, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      let input: unknown = {};
      try {
        input = c.args.trim() ? JSON.parse(c.args) : {};
      } catch {
        // Malformed JSON from the model; degrade gracefully.
        input = {};
      }
      yield { type: 'tool_call', id: c.id || `openai-call-${index}`, name: c.name, input };
    }

    yield {
      type: 'done',
      usage,
      stopReason: calls.size > 0 ? 'tool_use' : finish,
    };
  }
}
