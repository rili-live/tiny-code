import { OpenAiCompatibleProvider, type OpenAiCompatibleOptions } from './openai-compatible.js';

/** DeepSeek's hosted OpenAI-compatible endpoint. */
export const DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com/v1';

export interface DeepSeekProviderOptions extends Omit<OpenAiCompatibleOptions, 'baseUrl'> {
  apiKey: string;
  /** Override the API endpoint (defaults to {@link DEFAULT_DEEPSEEK_URL}). */
  baseUrl?: string | undefined;
}

/**
 * DeepSeek's cloud models (the V4 family powers its coding capability) over the
 * OpenAI-compatible Chat Completions API. Differs from the local Ollama
 * provider only in endpoint, required API key, and error wording.
 */
export class DeepSeekProvider extends OpenAiCompatibleProvider {
  readonly name = 'deepseek' as const;

  constructor(opts: DeepSeekProviderOptions) {
    super({ ...opts, baseUrl: opts.baseUrl ?? DEFAULT_DEEPSEEK_URL });
  }

  protected override label(): string {
    return 'DeepSeek';
  }

  protected override unreachableError(err: Error): Error {
    return new Error(
      `Cannot reach DeepSeek at ${this.baseUrl}. Check your network and DEEPSEEK_API_KEY. (${err.message})`,
    );
  }
}
