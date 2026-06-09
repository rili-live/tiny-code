import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTerminalUI } from '../../src/ui/render.js';

function capture(fn: (write: ReturnType<typeof vi.fn>) => void): string {
  const write = vi.fn();
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    write(String(chunk));
    return true;
  });
  fn(write);
  spy.mockRestore();
  return write.mock.calls.map((c) => c[0]).join('');
}

afterEach(() => vi.restoreAllMocks());

describe('createTerminalUI', () => {
  it('streams text and renders a tool start with a preview', () => {
    const out = capture(() => {
      const ui = createTerminalUI();
      ui.onText('thinking...');
      ui.onToolStart('bash', { command: 'npm test' });
    });
    expect(out).toContain('thinking...');
    expect(out).toContain('bash');
    expect(out).toContain('$ npm test');
  });

  it('renders tool results and denials', () => {
    const out = capture(() => {
      const ui = createTerminalUI();
      ui.onToolResult('read_file', { output: 'ok', summary: 'a.txt (1 lines)' });
      ui.onToolResult('bash', { output: 'failed', isError: true });
      ui.onToolDenied('write_file');
      ui.onMaxIterations();
    });
    expect(out).toContain('a.txt (1 lines)');
    expect(out).toContain('write_file denied');
    expect(out).toContain('max iterations');
  });

  it('previews path- and pattern-based tools', () => {
    const out = capture(() => {
      const ui = createTerminalUI();
      ui.onToolStart('read_file', { path: 'src/x.ts' });
      ui.onToolStart('glob', { pattern: '**/*.ts' });
    });
    expect(out).toContain('src/x.ts');
    expect(out).toContain('**/*.ts');
  });

  it('shows a cost line for cloud models and accumulates session totals', () => {
    const out = capture(() => {
      const ui = createTerminalUI({ model: 'claude-opus-4-8' });
      ui.onUsage({ inputTokens: 1000, outputTokens: 1000 });
      expect(ui.getTotals().inputTokens).toBe(1000);
      expect(ui.getTotals().cost).toBeGreaterThan(0);
    });
    expect(out).toContain('1.0k in / 1.0k out');
    expect(out).toContain('session');
  });

  it('labels local models as having no API cost', () => {
    const out = capture(() => {
      const ui = createTerminalUI({ model: 'qwen2.5-coder:7b', provider: 'ollama' });
      ui.onUsage({ inputTokens: 500, outputTokens: 200 });
      expect(ui.getTotals().cost).toBe(0);
    });
    expect(out).toContain('local (no API cost)');
  });

  it('stays silent when showUsage is false but still tracks totals', () => {
    const out = capture(() => {
      const ui = createTerminalUI({ model: 'claude-opus-4-8', showUsage: false });
      ui.onUsage({ inputTokens: 100, outputTokens: 100 });
      expect(ui.getTotals().inputTokens).toBe(100);
    });
    expect(out).toBe('');
  });

  it('renders an escalation route line', () => {
    const out = capture(() => {
      const ui = createTerminalUI();
      ui.onRoute('anthropic', 'claude-opus-4-8', 'heavy task');
    });
    expect(out).toContain('escalated to anthropic:claude-opus-4-8');
    expect(out).toContain('heavy task');
  });
});
