import type { ModelProvider } from './types.js';
import type { ResolvedConfig } from '../config/load.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { DeepSeekProvider } from './deepseek.js';
import { QwenProvider } from './qwen.js';

export type { ModelProvider, ProviderEvent, SendRequest, ToolSchema, Usage } from './types.js';
export { AnthropicProvider } from './anthropic.js';
export { GeminiProvider } from './gemini.js';
export { OllamaProvider } from './ollama.js';
export { DeepSeekProvider } from './deepseek.js';
export { QwenProvider } from './qwen.js';
export { OpenAiCompatibleProvider } from './openai-compatible.js';

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

  if (config.provider === 'deepseek') {
    if (!config.deepseekApiKey) {
      throw new Error('DEEPSEEK_API_KEY is not set. Export it or switch providers with --provider anthropic.');
    }
    return new DeepSeekProvider({
      apiKey: config.deepseekApiKey,
      baseUrl: config.deepseekBaseUrl,
      model: config.model,
      maxTokens: config.maxTokens,
    });
  }

  if (config.provider === 'qwen') {
    if (!config.qwenApiKey) {
      throw new Error('QWEN_API_KEY is not set. Export it or switch providers with --provider anthropic.');
    }
    return new QwenProvider({
      apiKey: config.qwenApiKey,
      baseUrl: config.qwenBaseUrl,
      model: config.model,
      maxTokens: config.maxTokens,
    });
  }

  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not set. Export it or switch providers with --provider anthropic.');
  }
  return new GeminiProvider({ apiKey: config.geminiApiKey, model: config.model });
}
