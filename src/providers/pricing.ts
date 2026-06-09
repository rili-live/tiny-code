import type { Usage } from './types.js';

/** Cost per 1M tokens, in USD. */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Approximate cloud pricing (USD per 1M tokens). These drift over time — edit
 * this table to match current vendor pricing. Local models (Ollama) are
 * intentionally absent: they have no per-token API cost, so {@link estimateCost}
 * returns `null` for them and the UI reports "local (no API cost)".
 */
export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
};

/** Look up pricing, tolerating versioned suffixes (e.g. "claude-opus-4-8-20260101"). */
function lookup(model: string): ModelPricing | undefined {
  if (PRICING[model]) return PRICING[model];
  // Longest known prefix wins, so "gemini-2.5-pro-preview" matches "gemini-2.5-pro".
  let best: ModelPricing | undefined;
  let bestLen = 0;
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = price;
      bestLen = key.length;
    }
  }
  return best;
}

/**
 * Estimate the USD cost of a single turn's token usage. Returns `null` when the
 * model has no known price (local/unpriced models), signalling "no API cost".
 */
export function estimateCost(model: string, usage: Usage): number | null {
  const price = lookup(model);
  if (!price) return null;
  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMTok +
    (usage.outputTokens / 1_000_000) * price.outputPerMTok
  );
}

/** Format a USD amount with enough precision to be useful at small magnitudes. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
