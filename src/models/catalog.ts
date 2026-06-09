import type { Provider } from '../config/load.js';
import type { Usage } from '../providers/types.js';

/**
 * How to weigh cost vs. capability when auto-selecting a model.
 * - `performance`: most capable model (maximize quality, ignore price)
 * - `cost`: cheapest capable model (maximize savings)
 * - `balanced`: best capability-per-dollar among genuinely capable models
 */
export type Priority = 'performance' | 'cost' | 'balanced';

/**
 * Curated facts about a coding model. Pricing is USD per 1,000,000 tokens for
 * the standard (non-cached, ≤200K-context) tier — the common case for an
 * interactive coding session. `codingScore` is a curated 0–100 estimate of
 * relative aptitude on coding/agentic tasks, used only to rank models against
 * each other; it is not a vendor benchmark.
 */
export interface ModelInfo {
  id: string;
  provider: Provider;
  label: string;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  contextWindow: number;
  codingScore: number;
}

/**
 * The date this catalog's pricing and model list were last verified. Models and
 * prices move; keep this current when updating entries. Anthropic figures come
 * from the bundled claude-api reference; Gemini figures from Google's published
 * API pricing.
 */
export const CATALOG_AS_OF = '2026-06-08';

/**
 * The known coding models, newest/most-capable first within each provider.
 * Keep this list curated — tiny-code runs offline-first, so it can't discover
 * models at runtime. Update it (and {@link CATALOG_AS_OF}) as vendors ship.
 */
export const MODEL_CATALOG: ModelInfo[] = [
  // Anthropic — pricing per the claude-api model table.
  { id: 'claude-opus-4-8', provider: 'anthropic', label: 'Claude Opus 4.8', inputPricePerMTok: 5, outputPricePerMTok: 25, contextWindow: 1_000_000, codingScore: 99 },
  { id: 'claude-opus-4-7', provider: 'anthropic', label: 'Claude Opus 4.7', inputPricePerMTok: 5, outputPricePerMTok: 25, contextWindow: 1_000_000, codingScore: 96 },
  { id: 'claude-opus-4-6', provider: 'anthropic', label: 'Claude Opus 4.6', inputPricePerMTok: 5, outputPricePerMTok: 25, contextWindow: 1_000_000, codingScore: 93 },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet 4.6', inputPricePerMTok: 3, outputPricePerMTok: 15, contextWindow: 1_000_000, codingScore: 88 },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5', inputPricePerMTok: 1, outputPricePerMTok: 5, contextWindow: 200_000, codingScore: 75 },

  // Gemini — standard-tier pricing (prompts ≤200K tokens) from Google AI pricing.
  { id: 'gemini-2.5-pro', provider: 'gemini', label: 'Gemini 2.5 Pro', inputPricePerMTok: 1.25, outputPricePerMTok: 10, contextWindow: 1_048_576, codingScore: 90 },
  { id: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', inputPricePerMTok: 0.3, outputPricePerMTok: 2.5, contextWindow: 1_048_576, codingScore: 72 },
  { id: 'gemini-2.5-flash-lite', provider: 'gemini', label: 'Gemini 2.5 Flash-Lite', inputPricePerMTok: 0.1, outputPricePerMTok: 0.4, contextWindow: 1_048_576, codingScore: 55 },
];

/** Look up catalog facts for a model id, or `undefined` if it's not tracked. */
export function getModelInfo(id: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** Estimate the USD cost of a token usage given a model's pricing. */
export function estimateCostUsd(usage: Usage, info: ModelInfo): number {
  return (
    (usage.inputTokens / 1_000_000) * info.inputPricePerMTok +
    (usage.outputTokens / 1_000_000) * info.outputPricePerMTok
  );
}

/**
 * Estimate the USD cost of a token usage for a model id, or `null` when the
 * model isn't in the catalog — e.g. a local/Ollama model that has no API price.
 * A `null` means "no known price", not "free"; callers decide how to present it.
 */
export function estimateCost(modelId: string, usage: Usage): number | null {
  const info = getModelInfo(modelId);
  return info ? estimateCostUsd(usage, info) : null;
}

/** Format a USD amount with precision that stays readable for tiny costs. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? 4 : 2)}`;
}

/**
 * Coding sessions are input-heavy (history is resent every turn), so blend
 * pricing 80% input / 20% output to compare models on a single cost number.
 */
export function blendedCostPerMTok(info: ModelInfo): number {
  return info.inputPricePerMTok * 0.8 + info.outputPricePerMTok * 0.2;
}

/**
 * Minimum coding aptitude to consider, per priority. Keeps `balanced`/`cost`
 * from collapsing onto the cheapest-but-weakest model — score-per-dollar always
 * favors the cheapest, so a capability floor is what makes the tradeoff useful.
 */
const DEFAULT_MIN_SCORE: Record<Priority, number> = {
  performance: 0,
  balanced: 80,
  cost: 60,
};

export interface RecommendOptions {
  provider: Provider;
  priority: Priority;
  /** Reject models below this coding score. Defaults per-priority. */
  minCodingScore?: number;
  /** Reject models whose context window is smaller than this. */
  minContextWindow?: number;
}

/**
 * Pick the model that best fits a cost/performance priority. Returns the single
 * best candidate, or `undefined` if the constraints exclude every model for the
 * provider (callers should fall back to a static default).
 */
export function recommendModel(opts: RecommendOptions): ModelInfo | undefined {
  const minScore = opts.minCodingScore ?? DEFAULT_MIN_SCORE[opts.priority];
  const candidates = MODEL_CATALOG.filter(
    (m) =>
      m.provider === opts.provider &&
      m.codingScore >= minScore &&
      (opts.minContextWindow === undefined || m.contextWindow >= opts.minContextWindow),
  );
  if (candidates.length === 0) return undefined;

  const score = (m: ModelInfo): number => {
    switch (opts.priority) {
      case 'performance':
        // Highest aptitude; break ties toward the cheaper option.
        return m.codingScore - blendedCostPerMTok(m) / 1000;
      case 'cost':
        // Cheapest; break ties toward the more capable option.
        return -blendedCostPerMTok(m) + m.codingScore / 1000;
      case 'balanced':
        // Best capability per dollar.
        return m.codingScore / blendedCostPerMTok(m);
    }
  };

  return candidates.reduce((best, m) => (score(m) > score(best) ? m : best));
}
