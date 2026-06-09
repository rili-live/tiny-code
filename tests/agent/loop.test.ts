import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AgentLoop } from '../../src/agent/loop.js';
import type { AgentUI } from '../../src/agent/loop.js';
import { LocalFirstModelEngine } from '../../src/agent/decision/index.js';
import { createRegistry } from '../../src/tools/registry.js';
import { defineTool } from '../../src/tools/types.js';
import { escalateTool } from '../../src/tools/escalate.js';
import { PermissionGate } from '../../src/permissions/gate.js';
import type { PermissionChoice } from '../../src/permissions/gate.js';
import type { ModelProvider, ProviderEvent, SendRequest } from '../../src/providers/types.js';

const DONE: ProviderEvent = {
  type: 'done',
  usage: { inputTokens: 0, outputTokens: 0 },
  stopReason: 'end_turn',
};

class ScriptedProvider implements ModelProvider {
  readonly name: 'anthropic' | 'gemini' | 'ollama';
  readonly model: string;
  readonly sent: SendRequest[] = [];

  constructor(
    private readonly turns: ProviderEvent[][],
    model = 'fake',
    name: 'anthropic' | 'gemini' | 'ollama' = 'anthropic',
  ) {
    this.model = model;
    this.name = name;
  }

  async *send(req: SendRequest): AsyncIterable<ProviderEvent> {
    this.sent.push(req);
    const turn = this.turns.shift() ?? [DONE];
    for (const ev of turn) yield ev;
  }
}

function recordingUI(): { ui: AgentUI; events: string[] } {
  const events: string[] = [];
  const ui: AgentUI = {
    onText: (d) => events.push(`text:${d}`),
    onToolStart: (n) => events.push(`start:${n}`),
    onToolResult: (n, r) => events.push(`result:${n}:${r.output}:${r.isError ?? false}`),
    onToolDenied: (n) => events.push(`denied:${n}`),
    onUsage: () => events.push('usage'),
    onRoute: (p, m, r, initial) => events.push(`route:${p}:${m}:${r}:${initial ? 'initial' : 'escalated'}`),
    onAssistantEnd: () => events.push('assistantEnd'),
    onMaxIterations: () => events.push('maxIter'),
  };
  return { ui, events };
}

const echoTool = defineTool({
  name: 'echo',
  description: 'echo',
  mutating: false,
  schema: z.object({ text: z.string() }),
  async execute(input) {
    return { output: input.text };
  },
});

const dangerTool = defineTool({
  name: 'danger',
  description: 'mutating',
  mutating: true,
  schema: z.object({}),
  async execute() {
    return { output: 'boom' };
  },
});

const registry = createRegistry([echoTool, dangerTool]);

function gateWith(choice: PermissionChoice): PermissionGate {
  return new PermissionGate({ tools: [], bash: [], write: [] }, async () => choice);
}

function makeLoop(
  provider: ModelProvider,
  ui: AgentUI,
  gate: PermissionGate,
  maxIterations = 50,
): AgentLoop {
  return new AgentLoop({
    provider,
    registry,
    gate,
    ui,
    system: 'sys',
    cwd: process.cwd(),
    maxIterations,
  });
}

describe('AgentLoop', () => {
  it('ends after a text-only response with no tools', async () => {
    const provider = new ScriptedProvider([[{ type: 'text', delta: 'hello' }, DONE]]);
    const { ui, events } = recordingUI();
    await makeLoop(provider, ui, gateWith('yes')).run('hi');

    expect(provider.sent).toHaveLength(1);
    expect(events).toContain('text:hello');
    expect(events).toContain('assistantEnd');
    expect(events).not.toContain('start:echo');
  });

  it('executes a tool call and feeds the result back', async () => {
    const provider = new ScriptedProvider([
      [{ type: 'tool_call', id: 't1', name: 'echo', input: { text: 'hi' } }, DONE],
      [{ type: 'text', delta: 'all done' }, DONE],
    ]);
    const { ui, events } = recordingUI();
    const loop = makeLoop(provider, ui, gateWith('yes'));
    await loop.run('do it');

    expect(events).toContain('start:echo');
    expect(events).toContain('result:echo:hi:false');

    // Second request must carry: user, assistant(tool_use), user(tool_result)
    expect(provider.sent).toHaveLength(2);
    const second = provider.sent[1]!.messages;
    expect(second).toHaveLength(3);
    const last = second[2]!;
    expect(last.role).toBe('user');
    expect(last.content[0]!.type).toBe('tool_result');
  });

  it('returns an error result when permission is denied (without executing)', async () => {
    const provider = new ScriptedProvider([
      [{ type: 'tool_call', id: 't1', name: 'danger', input: {} }, DONE],
      [DONE],
    ]);
    const { ui, events } = recordingUI();
    await makeLoop(provider, ui, gateWith('no')).run('go');

    expect(events).toContain('denied:danger');
    const second = provider.sent[1]!.messages;
    const toolResult = second[2]!.content[0]!;
    expect(toolResult.type).toBe('tool_result');
    if (toolResult.type === 'tool_result') {
      expect(toolResult.isError).toBe(true);
    }
  });

  it('returns an error for invalid tool input and never executes', async () => {
    const provider = new ScriptedProvider([
      [{ type: 'tool_call', id: 't1', name: 'echo', input: { text: 123 } }, DONE],
      [DONE],
    ]);
    const { ui, events } = recordingUI();
    await makeLoop(provider, ui, gateWith('yes')).run('go');

    expect(events).not.toContain('start:echo');
    const result = provider.sent[1]!.messages[2]!.content[0]!;
    if (result.type === 'tool_result') {
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid input');
    }
  });

  it('reports an unknown tool as an error', async () => {
    const provider = new ScriptedProvider([
      [{ type: 'tool_call', id: 't1', name: 'ghost', input: {} }, DONE],
      [DONE],
    ]);
    const { ui } = recordingUI();
    await makeLoop(provider, ui, gateWith('yes')).run('go');

    const result = provider.sent[1]!.messages[2]!.content[0]!;
    if (result.type === 'tool_result') {
      expect(result.content).toContain('Unknown tool');
    }
  });

  it('routes a heavy turn to the escalation provider up front', async () => {
    const local = new ScriptedProvider([[{ type: 'text', delta: 'local' }, DONE]], 'local');
    const frontier = new ScriptedProvider(
      [[{ type: 'text', delta: 'frontier' }, DONE]],
      'big',
      'anthropic',
    );
    const { ui, events } = recordingUI();
    const loop = new AgentLoop({
      provider: local,
      registry,
      gate: gateWith('yes'),
      ui,
      system: 'sys',
      cwd: process.cwd(),
      engine: new LocalFirstModelEngine({ primary: local, escalation: frontier, classify: () => 'heavy' }),
    });
    await loop.run('refactor everything');

    expect(frontier.sent).toHaveLength(1);
    expect(local.sent).toHaveLength(0);
    expect(events).toContain('route:anthropic:big:heavy task:initial');
  });

  it('keeps a light turn on the local provider', async () => {
    const local = new ScriptedProvider([[{ type: 'text', delta: 'local' }, DONE]], 'local');
    const frontier = new ScriptedProvider([[DONE]], 'big');
    const { ui, events } = recordingUI();
    const loop = new AgentLoop({
      provider: local,
      registry,
      gate: gateWith('yes'),
      ui,
      system: 'sys',
      cwd: process.cwd(),
      engine: new LocalFirstModelEngine({ primary: local, escalation: frontier, classify: () => 'light' }),
    });
    await loop.run('list files');

    expect(local.sent).toHaveLength(1);
    expect(frontier.sent).toHaveLength(0);
    expect(events).not.toContain('route:anthropic:big:heavy task');
  });

  it('escalates mid-turn when the local model calls the escalate tool', async () => {
    const escalateRegistry = createRegistry([echoTool, escalateTool]);
    const local = new ScriptedProvider(
      [[{ type: 'tool_call', id: 'e1', name: 'escalate', input: { reason: 'too hard' } }, DONE]],
      'local',
    );
    const frontier = new ScriptedProvider(
      [[{ type: 'text', delta: 'handled' }, DONE]],
      'big',
      'anthropic',
    );
    const { ui, events } = recordingUI();
    const loop = new AgentLoop({
      provider: local,
      registry: escalateRegistry,
      gate: gateWith('yes'),
      ui,
      system: 'sys',
      cwd: process.cwd(),
      engine: new LocalFirstModelEngine({ primary: local, escalation: frontier, classify: () => 'light' }),
    });
    await loop.run('start small then get stuck');

    // First send on local, second (post-escalation) on frontier.
    expect(local.sent).toHaveLength(1);
    expect(frontier.sent).toHaveLength(1);
    expect(events).toContain('route:anthropic:big:requested by model:escalated');
    expect(events).toContain('text:handled');
  });

  it('auto-escalates after the engine sees repeated tool errors (stuck)', async () => {
    // Three iterations of a failing (unknown) tool trip the default stuck threshold.
    const failing: ProviderEvent[][] = [];
    for (let i = 0; i < 3; i += 1) {
      failing.push([{ type: 'tool_call', id: `g${i}`, name: 'ghost', input: {} }, DONE]);
    }
    const local = new ScriptedProvider(failing, 'local');
    const frontier = new ScriptedProvider([[{ type: 'text', delta: 'rescued' }, DONE]], 'big', 'anthropic');
    const { ui, events } = recordingUI();
    const loop = new AgentLoop({
      provider: local,
      registry,
      gate: gateWith('yes'),
      ui,
      system: 'sys',
      cwd: process.cwd(),
      engine: new LocalFirstModelEngine({ primary: local, escalation: frontier, classify: () => 'light' }),
    });
    await loop.run('keep failing');

    expect(local.sent).toHaveLength(3);
    expect(frontier.sent).toHaveLength(1);
    expect(events).toContain('route:anthropic:big:stuck — repeated tool errors:escalated');
    expect(events).toContain('text:rescued');
  });

  it('stays on the frontier model for follow-up turns once escalated', async () => {
    const escalateRegistry = createRegistry([echoTool, escalateTool]);
    const local = new ScriptedProvider(
      [[{ type: 'tool_call', id: 'e1', name: 'escalate', input: { reason: 'too hard' } }, DONE]],
      'local',
    );
    const frontier = new ScriptedProvider(
      [
        [{ type: 'text', delta: 'handled' }, DONE], // finishes the escalated turn
        [{ type: 'text', delta: 'follow-up' }, DONE], // next turn should land here too
      ],
      'big',
      'anthropic',
    );
    const { ui } = recordingUI();
    const loop = new AgentLoop({
      provider: local,
      registry: escalateRegistry,
      gate: gateWith('yes'),
      ui,
      system: 'sys',
      cwd: process.cwd(),
      engine: new LocalFirstModelEngine({ primary: local, escalation: frontier, classify: () => 'light' }),
    });

    await loop.run('start small then get stuck');
    await loop.run('a routine follow-up');

    // The follow-up turn never touched the local provider.
    expect(local.sent).toHaveLength(1);
    expect(frontier.sent).toHaveLength(2);

    // clearHistory resets stickiness: the next light turn goes back to local.
    loop.clearHistory();
    await loop.run('another light request');
    expect(local.sent).toHaveLength(2);
  });

  it('behaves as a single provider when no escalation is configured', async () => {
    const provider = new ScriptedProvider([[{ type: 'text', delta: 'hi' }, DONE]]);
    const { ui, events } = recordingUI();
    await makeLoop(provider, ui, gateWith('yes')).run('refactor the whole codebase');
    expect(provider.sent).toHaveLength(1);
    expect(events).not.toContain('route:anthropic:big:heavy task');
  });

  it('accumulates token usage across a single turn', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'text', delta: 'hi' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn' },
      ],
    ]);
    const { ui } = recordingUI();
    const loop = makeLoop(provider, ui, gateWith('yes'));
    await loop.run('hello');
    expect(loop.getUsage()).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('accumulates token usage across multiple run() calls', async () => {
    const provider = new ScriptedProvider([
      [{ type: 'done', usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn' }],
      [{ type: 'done', usage: { inputTokens: 20, outputTokens: 8 }, stopReason: 'end_turn' }],
    ]);
    const { ui } = recordingUI();
    const loop = makeLoop(provider, ui, gateWith('yes'));
    await loop.run('first');
    await loop.run('second');
    expect(loop.getUsage()).toEqual({ inputTokens: 30, outputTokens: 13 });
  });

  it('clears conversation history but preserves session usage', async () => {
    const provider = new ScriptedProvider([
      [{ type: 'done', usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn' }],
      [{ type: 'done', usage: { inputTokens: 20, outputTokens: 8 }, stopReason: 'end_turn' }],
    ]);
    const { ui } = recordingUI();
    const loop = makeLoop(provider, ui, gateWith('yes'));

    await loop.run('first');
    expect(loop.getMessages().length).toBeGreaterThan(0);

    loop.clearHistory();
    expect(loop.getMessages()).toHaveLength(0);
    expect(loop.getUsage()).toEqual({ inputTokens: 10, outputTokens: 5 });

    // Next turn starts fresh: the request carries only the new user message.
    await loop.run('second');
    expect(provider.sent[1]!.messages).toHaveLength(1);
    expect(loop.getUsage()).toEqual({ inputTokens: 30, outputTokens: 13 });
  });

  it('stops at the iteration guard when tools never stop', async () => {
    const looping: ProviderEvent[][] = [];
    for (let i = 0; i < 10; i += 1) {
      looping.push([{ type: 'tool_call', id: `t${i}`, name: 'echo', input: { text: 'x' } }, DONE]);
    }
    const provider = new ScriptedProvider(looping);
    const { ui, events } = recordingUI();
    await makeLoop(provider, ui, gateWith('yes'), 3).run('loop');

    expect(events).toContain('maxIter');
    expect(provider.sent).toHaveLength(3);
  });
});
