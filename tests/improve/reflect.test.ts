import { describe, it, expect } from 'vitest';
import { reflect, serializeTranscript, NO_IMPROVEMENT } from '../../src/improve/reflect.js';
import type { Message } from '../../src/agent/types.js';
import type { ModelProvider, ProviderEvent, SendRequest } from '../../src/providers/types.js';

class TextProvider implements ModelProvider {
  readonly name = 'anthropic' as const;
  readonly model = 'fake';
  readonly sent: SendRequest[] = [];

  constructor(private readonly chunks: string[]) {}

  async *send(req: SendRequest): AsyncIterable<ProviderEvent> {
    this.sent.push(req);
    for (const delta of this.chunks) yield { type: 'text', delta };
    yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn' };
  }
}

describe('serializeTranscript', () => {
  it('flattens text, tool_use, and tool_result blocks', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: '1', name: 'bash', input: { command: 'ls' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: '1', content: 'boom', isError: true }],
      },
    ];
    const out = serializeTranscript(messages);
    expect(out).toContain('[user] fix the bug');
    expect(out).toContain('[tool_use] bash {"command":"ls"}');
    expect(out).toContain('[tool_result (error)] boom');
  });
});

describe('reflect', () => {
  it('returns trimmed markdown when the model proposes something', async () => {
    const provider = new TextProvider(['# Better grep\n', '\n## Summary\nuse rg']);
    const result = await reflect({ provider, transcript: 'session', cwd: '/x' });
    expect(result).toBe('# Better grep\n\n## Summary\nuse rg');
  });

  it('passes no tools to the provider', async () => {
    const provider = new TextProvider(['# x']);
    await reflect({ provider, transcript: 'session', cwd: '/x' });
    expect(provider.sent[0]?.tools).toEqual([]);
  });

  it('returns null on the sentinel', async () => {
    const provider = new TextProvider([NO_IMPROVEMENT]);
    expect(await reflect({ provider, transcript: 's', cwd: '/x' })).toBeNull();
  });

  it('returns null on empty output', async () => {
    const provider = new TextProvider(['   ']);
    expect(await reflect({ provider, transcript: 's', cwd: '/x' })).toBeNull();
  });
});
