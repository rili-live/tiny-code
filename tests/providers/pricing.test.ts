import { describe, it, expect } from 'vitest';
import { estimateCost, formatUsd } from '../../src/providers/pricing.js';

describe('estimateCost', () => {
  it('prices a known cloud model from input/output tokens', () => {
    // opus 4.8: $15/M in, $75/M out -> 1M in + 1M out = $90
    const cost = estimateCost('claude-opus-4-8', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(90, 5);
  });

  it('matches versioned model ids by prefix', () => {
    const cost = estimateCost('gemini-2.5-pro-preview', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBeCloseTo(1.25, 5);
  });

  it('returns null for local/unpriced models', () => {
    expect(estimateCost('gemma3:12b', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
    expect(estimateCost('qwen2.5-coder:7b', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
  });
});

describe('formatUsd', () => {
  it('uses extra precision for tiny amounts', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0012)).toBe('$0.0012');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
