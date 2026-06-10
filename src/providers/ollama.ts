import { OpenAiCompatibleProvider, type OpenAiCompatibleOptions } from './openai-compatible.js';

// Re-exported so existing importers keep their `./ollama.js` entry point; the
// translation helpers are shared by every OpenAI-compatible provider now.
export { toOpenAiMessages, toOpenAiTools } from './openai-compatible.js';

export interface OllamaProviderOptions extends Omit<OpenAiCompatibleOptions, 'apiKey'> {
  /** Ignored by Ollama but required by the OpenAI wire format; defaults to "ollama". */
  apiKey?: string;
}

/**
 * Local Ollama server over its OpenAI-compatible endpoint. Same wire format as
 * the cloud OpenAI-compatible providers (it also covers LM Studio and vLLM by
 * pointing `baseUrl` at them); only the auth default and the connection-error
 * wording — which name a local `ollama serve` and RAM pressure — differ.
 */
export class OllamaProvider extends OpenAiCompatibleProvider {
  readonly name = 'ollama' as const;

  constructor(opts: OllamaProviderOptions) {
    super({ ...opts, apiKey: opts.apiKey ?? 'ollama' });
  }

  protected override label(): string {
    return 'Ollama';
  }

  protected override timeoutError(): Error {
    return new Error(
      `Ollama at ${this.baseUrl} went silent for ${Math.round(this.timeoutMs / 1000)}s and was aborted. ` +
        `The model '${this.model}' may be too large for this machine.`,
    );
  }

  protected override unreachableError(err: Error): Error {
    return new Error(
      `Cannot reach Ollama at ${this.baseUrl}. Is 'ollama serve' running? (${err.message})`,
    );
  }
}
