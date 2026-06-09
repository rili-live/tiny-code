import type { ModelProvider } from '../../providers/types.js';
import { classifyTurn, type TaskWeight } from '../router.js';
import { checkLocalModel } from '../../system/resources.js';
import { estimateCost } from '../../providers/pricing.js';
import type { ModelDecisionEngine, RouteDecision, TurnSignals } from './types.js';

export interface LocalFirstOptions {
  /** The cheap/local model that handles turns by default. */
  primary: ModelProvider;
  /** The frontier model heavy/stuck turns escalate to. */
  escalation: ModelProvider;
  /** Task-weight classifier. Defaults to {@link classifyTurn}. */
  classify?: (input: string) => TaskWeight;
  /** Consecutive tool-error iterations before auto-escalating. Defaults to 3. */
  stuckThreshold?: number;
  /** RAM-fit check (injectable for tests). Defaults to {@link checkLocalModel}. */
  ramCheck?: (model: string) => { warn: boolean };
}

/** Per-MTok probe used to compare relative model cost for the cost-aware note. */
const COST_PROBE = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

/**
 * The default local-first policy: handle each turn on the cheap/local model and
 * escalate to the frontier model only when capability demands it — the task
 * looks heavy up front, the model explicitly hands off via the `escalate` tool,
 * it gets stuck on repeated tool errors, or (compute awareness) a local model
 * won't fit in available RAM.
 *
 * Cost awareness is wired in but used defensively: the engine can *report* the
 * cost implication of an escalation (see {@link costNote}) but never initiates
 * a cost-driven route change — escalation is always a capability decision.
 */
export class LocalFirstModelEngine implements ModelDecisionEngine {
  private readonly primary: ModelProvider;
  private readonly escalation: ModelProvider;
  private readonly classify: (input: string) => TaskWeight;
  private readonly stuckThreshold: number;
  private readonly ramCheck: (model: string) => { warn: boolean };

  constructor(opts: LocalFirstOptions) {
    this.primary = opts.primary;
    this.escalation = opts.escalation;
    this.classify = opts.classify ?? classifyTurn;
    this.stuckThreshold = opts.stuckThreshold ?? 3;
    this.ramCheck = opts.ramCheck ?? checkLocalModel;
  }

  selectInitial(userInput: string): RouteDecision {
    // Compute awareness: a local primary that won't fit in RAM runs slowly or
    // fails outright, so route it to the frontier up front — even for light work.
    if (this.primary.name === 'ollama' && this.ramCheck(this.primary.model).warn) {
      return { provider: this.escalation, reason: 'compute: local model exceeds RAM' };
    }
    if (this.classify(userInput) === 'heavy') {
      return { provider: this.escalation, reason: 'heavy task' };
    }
    return { provider: this.primary };
  }

  considerEscalation(signals: TurnSignals): RouteDecision | undefined {
    if (signals.alreadyEscalated) return undefined;
    if (signals.escalateRequested) {
      return { provider: this.escalation, reason: 'requested by model' };
    }
    if (signals.consecutiveErrors >= this.stuckThreshold) {
      return { provider: this.escalation, reason: 'stuck — repeated tool errors' };
    }
    return undefined;
  }

  /**
   * A short, human-readable summary of what escalating costs, relative to the
   * primary. Pure reporting — does not influence routing. Local models report
   * as having no API cost.
   */
  costNote(): string {
    const from = estimateCost(this.primary.model, COST_PROBE);
    const to = estimateCost(this.escalation.model, COST_PROBE);
    if (to === null) return 'escalates to a local model (no API cost)';
    if (from === null || from === 0) {
      return 'escalates from a free/local model to a paid model (adds API cost)';
    }
    const multiplier = to / from;
    return `escalation costs ~${multiplier.toFixed(1)}× the primary per token`;
  }
}
