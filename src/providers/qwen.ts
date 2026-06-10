import { OpenAiCompatibleProvider, type OpenAiCompatibleOptions } from './openai-compatible.js';

/** Alibaba DashScope's OpenAI-compatible endpoint (hosts the Qwen models). */
export const DEFAULT_QWEN_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export interface QwenProviderOptions extends Omit<OpenAiCompatibleOptions, 'baseUrl'> {
  apiKey: string;
  /** Override the API endpoint (defaults to {@link DEFAULT_QWEN_URL}). */
  baseUrl?: string | undefined;
}

/**
 * Alibaba's Qwen Coder models (e.g. qwen3-coder-plus) served via DashScope's
 * OpenAI-compatible Chat Completions API. Differs from the local Ollama provider
 * only in endpoint, required API key, and error wording.
 */
export class QwenProvider extends OpenAiCompatibleProvider {
  readonly name = 'qwen' as const;

  constructor(opts: QwenProviderOptions) {
    super({ ...opts, baseUrl: opts.baseUrl ?? DEFAULT_QWEN_URL });
  }

  protected override label(): string {
    return 'Qwen';
  }

  protected override unreachableError(err: Error): Error {
    return new Error(
      `Cannot reach Qwen (DashScope) at ${this.baseUrl}. Check your network and QWEN_API_KEY. (${err.message})`,
    );
  }
}
