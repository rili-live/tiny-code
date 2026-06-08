import pc from 'picocolors';
import type { AgentUI } from '../agent/loop.js';
import type { ToolResult } from '../tools/types.js';
import type { ModelInfo } from '../models/catalog.js';
import { estimateCostUsd, formatUsd } from '../models/catalog.js';

function preview(name: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  if (name === 'bash') return `$ ${String(obj.command ?? '')}`;
  if (name === 'glob' || name === 'grep') return String(obj.pattern ?? '');
  if (obj.path !== undefined) return String(obj.path);
  return JSON.stringify(obj);
}

function fmtN(n: number): string {
  return n.toLocaleString('en-US');
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s*\n\s*/g, ' ').trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
}

/**
 * Minimal streaming UI: assistant text inline, compact colored tool summaries.
 * Pass the active model's catalog info to also show a per-turn cost estimate.
 */
export function createTerminalUI(modelInfo?: ModelInfo): AgentUI {
  let atLineStart = true;

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
    onUsage(usage) {
      const cost = modelInfo ? `  ${formatUsd(estimateCostUsd(usage, modelInfo))}` : '';
      write(
        pc.dim(`  ↑ ${fmtN(usage.inputTokens)}  ↓ ${fmtN(usage.outputTokens)} tokens${cost}\n`),
      );
    },
    onAssistantEnd() {
      ensureNewline();
    },
    onMaxIterations() {
      ensureNewline();
      write(pc.yellow('[Reached max iterations — stopping]\n'));
    },
  };
}
