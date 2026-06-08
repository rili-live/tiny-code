import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message } from '../../src/agent/types.js';
import type { ModelProvider, ProviderEvent, SendRequest } from '../../src/providers/types.js';

const createImprovementPr = vi.fn();
vi.mock('../../src/improve/pr.js', () => ({ createImprovementPr }));

const { runImprovement } = await import('../../src/improve/run.js');

class TextProvider implements ModelProvider {
  readonly name = 'anthropic' as const;
  readonly model = 'fake';
  constructor(private readonly text: string) {}
  async *send(_req: SendRequest): AsyncIterable<ProviderEvent> {
    yield { type: 'text', delta: this.text };
    yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn' };
  }
}

const userMsg: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];

function harness(provider: ModelProvider, confirmValue: boolean) {
  const logs: string[] = [];
  return {
    logs,
    opts: {
      provider,
      messages: userMsg,
      cwd: '/x',
      baseBranch: 'main',
      log: (l: string) => logs.push(l),
      confirm: async () => confirmValue,
    },
  };
}

beforeEach(() => {
  createImprovementPr.mockReset();
});

describe('runImprovement', () => {
  it('reports no activity for an empty transcript', async () => {
    const { logs, opts } = harness(new TextProvider('# X'), true);
    await runImprovement({ ...opts, messages: [] });
    expect(logs.join()).toMatch(/No session activity/);
    expect(createImprovementPr).not.toHaveBeenCalled();
  });

  it('reports when reflection yields nothing', async () => {
    const { logs, opts } = harness(new TextProvider('NO_IMPROVEMENT'), true);
    await runImprovement(opts);
    expect(logs.join()).toMatch(/No improvements suggested/);
    expect(createImprovementPr).not.toHaveBeenCalled();
  });

  it('skips PR creation when the user declines', async () => {
    const { logs, opts } = harness(new TextProvider('# Better grep\nbody'), false);
    await runImprovement(opts);
    expect(logs.join()).toMatch(/Skipped/);
    expect(createImprovementPr).not.toHaveBeenCalled();
  });

  it('creates a PR and logs the url on approval', async () => {
    createImprovementPr.mockResolvedValue({ ok: true, url: 'https://example/pr/1' });
    const { logs, opts } = harness(new TextProvider('# Better grep\nbody'), true);
    await runImprovement(opts);
    expect(createImprovementPr).toHaveBeenCalledOnce();
    const arg = createImprovementPr.mock.calls[0]?.[0];
    expect(arg.title).toBe('Better grep');
    expect(arg.markdown).toContain('# Better grep');
    expect(logs.join()).toMatch(/https:\/\/example\/pr\/1/);
  });

  it('logs the failure reason when PR creation fails', async () => {
    createImprovementPr.mockResolvedValue({ ok: false, reason: 'gh CLI not found' });
    const { logs, opts } = harness(new TextProvider('# Title\nbody'), true);
    await runImprovement(opts);
    expect(logs.join()).toMatch(/gh CLI not found/);
  });
});
