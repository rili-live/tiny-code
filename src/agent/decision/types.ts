import type { ModelProvider } from '../../providers/types.js';

/**
 * A model-selection decision: the provider to use and an optional human-readable
 * reason. An empty/absent `reason` means "no route note" — the loop only fires
 * {@link AgentUI.onRoute} when a decision both changes the active provider and
 * carries a reason.
 */
export interface RouteDecision {
  provider: ModelProvider;
  reason?: string;
}

/**
 * Runtime signals the loop feeds the engine once per iteration so it can decide
 * whether to switch providers mid-turn. These are mechanical bookkeeping the
 * loop already tracks; the engine owns the policy that interprets them.
 */
export interface TurnSignals {
  /** The model called the `escalate` tool during this iteration. */
  escalateRequested: boolean;
  /** Consecutive iterations that ended with at least one tool error. */
  consecutiveErrors: number;
  /** Whether the turn has already been escalated (keeps the engine stateless). */
  alreadyEscalated: boolean;
  /** The provider currently handling the turn. */
  current: ModelProvider;
  /** Iteration index (0-based). */
  iteration: number;
}

/**
 * Owns all model-selection policy. {@link AgentLoop} depends on this interface
 * instead of inlining classification + escalation rules, so the loop keeps only
 * mechanism (send → stream → run tools → repeat) and the policy lives in one
 * cohesive, testable place. Implementations may reason about task weight, cost,
 * and compute (RAM) fit; the loop never sees that reasoning.
 */
export interface ModelDecisionEngine {
  /** Pick the provider that starts a turn, given the user's input. */
  selectInitial(userInput: string): RouteDecision;
  /**
   * Decide whether to switch providers mid-turn. Returns `undefined` to stay on
   * the current provider. Called once per iteration after tool results.
   */
  considerEscalation(signals: TurnSignals): RouteDecision | undefined;
}
