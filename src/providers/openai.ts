import type { SendRequest } from './types.js';
import {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleOptions,
  type OpenAiMessage,
} from './openai-compatible.js';

/** OpenAI's hosted Chat Completions endpoint. */
export const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';

export interface OpenAIProviderOptions extends Omit<OpenAiCompatibleOptions, 'baseUrl'> {
  apiKey: string;
  /** Override the base URL, e.g. for Azure OpenAI or a compatible proxy. Defaults to {@link DEFAULT_OPENAI_URL}. */
  baseUrl?: string | undefined;
}

/**
 * OpenAI's hosted models (GPT-4.1, o3, o4-mini, …) over the OpenAI-compatible
 * Chat Completions API. Extends the shared base — same streaming, tool-call
 * accumulation, and idle-timeout guard — and differs only in two ways: it sends
 * `max_completion_tokens` (the hosted API rejects `max_tokens` on newer/reasoning
 * models) and labels its errors "OpenAI".
 */
export class OpenAIProvider extends OpenAiCompatibleProvider {
  readonly name = 'openai' as const;

  constructor(opts: OpenAIProviderOptions) {
    super({ ...opts, baseUrl: opts.baseUrl ?? DEFAULT_OPENAI_URL });
  }

  protected override buildBody(messages: OpenAiMessage[], req: SendRequest): Record<string, unknown> {
    const body = super.buildBody(messages, req);
    // The hosted API uses `max_completion_tokens`; `max_tokens` is rejected on
    // newer/reasoning models. Swap the field the base set.
    delete body.max_tokens;
    if (this.maxTokens !== undefined) body.max_completion_tokens = this.maxTokens;
    return body;
  }

  protected override label(): string {
    return 'OpenAI';
  }
}
