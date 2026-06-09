import { describe, it, expect } from 'vitest';
import { LocalFirstModelEngine } from '../../../src/agent/decision/localFirst.js';
import type { TurnSignals } from '../../../src/agent/decision/types.js';
import type { ModelProvider, ProviderEvent, SendRequest } from '../../../src/providers/types.js';

/** A provider stub with just the identity fields the engine reads. */
function fakeProvider(model: string, name: ModelProvider['name']): ModelProvider {
  return {
    name,
    model,
    // eslint-disable-next-line require-yield
    async *send(_req: SendRequest): AsyncIterable<ProviderEvent> {
      return;
    },
  };
}

const local = fakeProvider('qwen2.5-coder:7b', 'ollama');
const frontier = fakeProvider('claude-opus-4-8', 'anthropic');

function signals(overrides: Partial<TurnSignals> = {}): TurnSignals {
  return {
    escalateRequested: false,
    consecutiveErrors: 0,
    alreadyEscalated: false,
    current: local,
    iteration: 0,
    ...overrides,
  };
}

describe('LocalFirstModelEngine', () => {
  const fits = { warn: false };

  it('routes a heavy turn to the frontier up front', () => {
    const engine = new LocalFirstModelEngine({
      primary: local,
      escalation: frontier,
      classify: () => 'heavy',
      ramCheck: () => fits,
    });
    expect(engine.selectInitial('refactor everything')).toEqual({
      provider: frontier,
      reason: 'heavy task',
    });
  });

  it('keeps a light turn on the primary (no reason)', () => {
    const engine = new LocalFirstModelEngine({
      primary: local,
      escalation: frontier,
      classify: () => 'light',
      ramCheck: () => fits,
    });
    expect(engine.selectInitial('list files')).toEqual({ provider: local });
  });

  it('escalates a light turn when the local model exceeds RAM (compute awareness)', () => {
    const engine = new LocalFirstModelEngine({
      primary: local,
      escalation: frontier,
      classify: () => 'light',
      ramCheck: () => ({ warn: true }),
    });
    expect(engine.selectInitial('list files')).toEqual({
      provider: frontier,
      reason: 'compute: local model exceeds RAM',
    });
  });

  it('does not apply the RAM check to a non-local primary', () => {
    const cloudPrimary = fakeProvider('gemini-2.5-flash', 'gemini');
    let called = false;
    const engine = new LocalFirstModelEngine({
      primary: cloudPrimary,
      escalation: frontier,
      classify: () => 'light',
      ramCheck: () => {
        called = true;
        return { warn: true };
      },
    });
    expect(engine.selectInitial('list files')).toEqual({ provider: cloudPrimary });
    expect(called).toBe(false);
  });

  describe('considerEscalation', () => {
    const engine = new LocalFirstModelEngine({
      primary: local,
      escalation: frontier,
      ramCheck: () => fits,
    });

    it('escalates when the model requests it', () => {
      expect(engine.considerEscalation(signals({ escalateRequested: true }))).toEqual({
        provider: frontier,
        reason: 'requested by model',
      });
    });

    it('escalates once consecutive errors hit the threshold', () => {
      expect(engine.considerEscalation(signals({ consecutiveErrors: 3 }))).toEqual({
        provider: frontier,
        reason: 'stuck — repeated tool errors',
      });
    });

    it('stays put below the threshold and without a request', () => {
      expect(engine.considerEscalation(signals({ consecutiveErrors: 2 }))).toBeUndefined();
    });

    it('never re-routes once already escalated', () => {
      expect(
        engine.considerEscalation(
          signals({ alreadyEscalated: true, escalateRequested: true, consecutiveErrors: 9 }),
        ),
      ).toBeUndefined();
    });

    it('respects a custom stuck threshold', () => {
      const eager = new LocalFirstModelEngine({
        primary: local,
        escalation: frontier,
        stuckThreshold: 1,
        ramCheck: () => fits,
      });
      expect(eager.considerEscalation(signals({ consecutiveErrors: 1 }))?.reason).toBe(
        'stuck — repeated tool errors',
      );
    });
  });

  describe('costNote (cost awareness)', () => {
    it('reports added API cost when escalating from a free local model', () => {
      const engine = new LocalFirstModelEngine({ primary: local, escalation: frontier });
      expect(engine.costNote()).toContain('adds API cost');
    });

    it('reports a cost multiplier between two priced cloud models', () => {
      const cheap = fakeProvider('gemini-2.5-flash', 'gemini');
      const engine = new LocalFirstModelEngine({ primary: cheap, escalation: frontier });
      expect(engine.costNote()).toMatch(/escalation costs ~\d+(\.\d+)?× the primary per token/);
    });

    it('reports no API cost when escalating to a local model', () => {
      const engine = new LocalFirstModelEngine({ primary: frontier, escalation: local });
      expect(engine.costNote()).toContain('no API cost');
    });
  });
});
