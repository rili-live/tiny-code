import type { ModelProvider } from './types.js';
import type { ResolvedConfig } from '../config/load.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';

export type { ModelProvider, ProviderEvent, SendRequest, ToolSchema, Usage } from './types.js';
export { AnthropicProvider } from './anthropic.js';
export { GeminiProvider } from './gemini.js';
export { OllamaProvider } from './ollama.js';
export { OpenAIProvider } from './openai.js';

/** Construct the configured provider, validating that its API key is present. */
export function createProvider(config: ResolvedConfig): ModelProvider {
  if (config.provider === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Export it or switch providers with --provider gemini.');
    }
    return new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      thinking: config.thinking,
      effort: config.effort,
    });
  }

  if (config.provider === 'ollama') {
    // No API key required — Ollama runs locally.
    return new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.model,
      maxTokens: config.maxTokens,
    });
  }

  if (config.provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not set. Export it or switch providers with --provider anthropic.');
    }
    return new OpenAIProvider({
      apiKey: config.openaiApiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      baseUrl: config.openaiBaseUrl,
    });
  }

  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not set. Export it or switch providers with --provider anthropic.');
  }
  return new GeminiProvider({ apiKey: config.geminiApiKey, model: config.model });
}
