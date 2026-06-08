import { describe, it, expect } from 'vitest';
import {
  MODEL_CATALOG,
  getModelInfo,
  estimateCostUsd,
  formatUsd,
  recommendModel,
} from '../../src/models/catalog.js';

describe('getModelInfo', () => {
  it('returns catalog facts for a known model', () => {
    const info = getModelInfo('claude-opus-4-8');
    expect(info?.provider).toBe('anthropic');
    expect(info?.inputPricePerMTok).toBe(5);
    expect(info?.outputPricePerMTok).toBe(25);
  });

  it('returns undefined for an unknown model', () => {
    expect(getModelInfo('gpt-9')).toBeUndefined();
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output tokens against the model rate', () => {
    const info = getModelInfo('claude-opus-4-8')!;
    // 1M input @ $5 + 200K output @ $25 = 5 + 5 = $10
    const cost = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 200_000 }, info);
    expect(cost).toBeCloseTo(10, 6);
  });

  it('is zero for zero usage', () => {
    const info = getModelInfo('claude-haiku-4-5')!;
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 }, info)).toBe(0);
  });
});

describe('formatUsd', () => {
  it('shows 4 decimals for sub-dollar amounts and 2 above', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(12.5)).toBe('$12.50');
  });
});

describe('recommendModel', () => {
  it('performance picks the most capable model for the provider', () => {
    expect(recommendModel({ provider: 'anthropic', priority: 'performance' })?.id).toBe(
      'claude-opus-4-8',
    );
    expect(recommendModel({ provider: 'gemini', priority: 'performance' })?.id).toBe(
      'gemini-2.5-pro',
    );
  });

  it('cost picks the cheapest capable model', () => {
    expect(recommendModel({ provider: 'anthropic', priority: 'cost' })?.id).toBe(
      'claude-haiku-4-5',
    );
    expect(recommendModel({ provider: 'gemini', priority: 'cost' })?.id).toBe('gemini-2.5-flash');
  });

  it('balanced trades cost against capability without dropping to the weakest', () => {
    expect(recommendModel({ provider: 'anthropic', priority: 'balanced' })?.id).toBe(
      'claude-sonnet-4-6',
    );
  });

  it('respects a context-window floor', () => {
    // Haiku has a 200K window; requiring 1M forces a larger model.
    const picked = recommendModel({
      provider: 'anthropic',
      priority: 'cost',
      minContextWindow: 1_000_000,
    });
    expect(picked?.id).not.toBe('claude-haiku-4-5');
    expect(picked?.contextWindow).toBeGreaterThanOrEqual(1_000_000);
  });

  it('returns undefined when constraints exclude every model', () => {
    expect(
      recommendModel({ provider: 'anthropic', priority: 'performance', minCodingScore: 1000 }),
    ).toBeUndefined();
  });
});

describe('MODEL_CATALOG', () => {
  it('has unique model ids', () => {
    const ids = MODEL_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
