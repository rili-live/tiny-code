import pc from 'picocolors';
import type { AgentUI } from '../agent/loop.js';
import type { ToolResult } from '../tools/types.js';
import type { Usage } from '../providers/types.js';
import { getModelInfo, estimateCostUsd, formatUsd } from '../models/catalog.js';

function preview(name: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  if (name === 'bash') return `$ ${String(obj.command ?? '')}`;
  if (name === 'glob' || name === 'grep') return String(obj.pattern ?? '');
  if (obj.path !== undefined) return String(obj.path);
  return JSON.stringify(obj);
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s*\n\s*/g, ' ').trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
}

/** Compact token count, e.g. 1234 -> "1.2k". */
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Paid (non-local) providers, where missing pricing means "unknown" not "free". */
function isCloud(provider?: string): boolean {
  return (
    provider === 'anthropic' ||
    provider === 'gemini' ||
    provider === 'deepseek' ||
    provider === 'qwen'
  );
}

export interface SessionTotals {
  inputTokens: number;
  outputTokens: number;
  /** Accumulated USD across priced (cloud) turns. */
  cost: number;
}

export interface TerminalUI extends AgentUI {
  /** Cumulative token + cost totals for the session (used by /costs). */
  getTotals(): SessionTotals;
}

export interface TerminalUIOptions {
  /** Default model id, used to price usage when the loop doesn't supply one. */
  model?: string;
  provider?: string;
  /** Print the per-turn usage line. Default true; set false to stay silent. */
  showUsage?: boolean;
}

/** Minimal streaming UI: assistant text inline, compact colored tool summaries. */
export function createTerminalUI(opts: TerminalUIOptions = {}): TerminalUI {
  const showUsage = opts.showUsage ?? true;
  let atLineStart = true;
  const totals: SessionTotals = { inputTokens: 0, outputTokens: 0, cost: 0 };

  const write = (s: string): void => {
    if (s.length === 0) return;
    process.stdout.write(s);
    atLineStart = s.endsWith('\n');
  };

  const ensureNewline = (): void => {
    if (!atLineStart) write('\n');
  };

  return {
    onText(delta) {
      write(delta);
    },
    onToolStart(name, input) {
      ensureNewline();
      write(`${pc.cyan(`● ${name}`)} ${pc.dim(preview(name, input))}\n`);
    },
    onToolResult(_name, result: ToolResult) {
      const status = result.isError ? pc.red('✗') : pc.green('✓');
      const detail = result.summary ?? truncate(result.output, 200);
      write(`  ${status} ${pc.dim(detail)}\n`);
    },
    onToolDenied(name) {
      ensureNewline();
      write(pc.yellow(`  ⊘ ${name} denied\n`));
    },
    onUsage(usage: Usage, model?: string, provider?: string) {
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
      const info = getModelInfo(model ?? opts.model ?? '');
      const cost = info ? estimateCostUsd(usage, info) : null;
      if (cost !== null) totals.cost += cost;

      if (!showUsage) return;
      ensureNewline();
      const tokens = `${fmtTokens(usage.inputTokens)} in / ${fmtTokens(usage.outputTokens)} out`;
      let money: string;
      if (cost !== null) {
        money = `${formatUsd(cost)} turn · ${formatUsd(totals.cost)} session`;
      } else if (isCloud(provider ?? opts.provider)) {
        // A paid cloud model we don't have pricing for — don't imply it was free.
        money = 'cost unknown';
      } else {
        money = 'local (no API cost)';
      }
      write(pc.dim(`· ${tokens} · ${money}\n`));
    },
    onRoute(provider, model, reason, initial) {
      ensureNewline();
      const verb = initial ? '▸ routed to' : '↑ escalated to';
      write(pc.yellow(`${verb} ${provider}:${model} (${reason})\n`));
    },
    onAssistantEnd() {
      ensureNewline();
    },
    onMaxIterations() {
      ensureNewline();
      write(pc.yellow('[Reached max iterations — stopping]\n'));
    },
    getTotals() {
      return { ...totals };
    },
  };
}
