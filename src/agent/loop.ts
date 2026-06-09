import type { ModelProvider, Usage } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PermissionGate } from '../permissions/gate.js';
import type { ToolResult } from '../tools/types.js';
import type { Message, ToolResultBlock, ToolUseBlock } from './types.js';

/** Sink for everything the loop wants to surface. The REPL provides the real one. */
export interface AgentUI {
  onText(delta: string): void;
  onToolStart(name: string, input: unknown): void;
  onToolResult(name: string, result: ToolResult): void;
  onToolDenied(name: string): void;
  /** `model` identifies which model produced the usage (for accurate pricing). */
  onUsage(usage: Usage, model?: string): void;
  /** Fired when local-first routing escalates the turn to the frontier model. */
  onRoute(provider: string, model: string, reason: string): void;
  onAssistantEnd(): void;
  onMaxIterations(): void;
}

export interface AgentLoopOptions {
  provider: ModelProvider;
  registry: ToolRegistry;
  gate: PermissionGate;
  system: string;
  ui: AgentUI;
  cwd: string;
  maxIterations?: number;
  /** Frontier model to escalate heavy/stuck turns to (enables local-first routing). */
  escalationProvider?: ModelProvider | undefined;
  /** Classifies a turn up front so heavy tasks start on the frontier model. */
  router?: ((input: string) => 'light' | 'heavy') | undefined;
}

/** Consecutive tool-error iterations before auto-escalating a stuck local model. */
const STUCK_THRESHOLD = 3;

/**
 * The provider-agnostic, UI-agnostic agentic loop: send → stream → run tools →
 * feed results back → repeat until the model stops requesting tools (or the
 * iteration guard trips). Conversation state persists across `run` calls.
 */
export class AgentLoop {
  private readonly provider: ModelProvider;
  private readonly registry: ToolRegistry;
  private readonly gate: PermissionGate;
  private readonly system: string;
  private readonly ui: AgentUI;
  private readonly cwd: string;
  private readonly maxIterations: number;
  private readonly escalationProvider: ModelProvider | undefined;
  private readonly router: ((input: string) => 'light' | 'heavy') | undefined;
  private readonly messages: Message[] = [];

  constructor(opts: AgentLoopOptions) {
    this.provider = opts.provider;
    this.registry = opts.registry;
    this.gate = opts.gate;
    this.system = opts.system;
    this.ui = opts.ui;
    this.cwd = opts.cwd;
    this.maxIterations = opts.maxIterations ?? 50;
    this.escalationProvider = opts.escalationProvider;
    this.router = opts.router;
  }

  /** Conversation history (for inspection / persistence). */
  getMessages(): readonly Message[] {
    return this.messages;
  }

  /** Run one user turn to completion (through any number of tool round-trips). */
  async run(userInput: string): Promise<void> {
    this.messages.push({ role: 'user', content: [{ type: 'text', text: userInput }] });
    const tools = this.registry.toSchemas();

    let active = this.selectInitialProvider(userInput);
    let escalated = active === this.escalationProvider;
    let consecutiveErrors = 0;

    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      let text = '';
      const toolCalls: ToolUseBlock[] = [];

      for await (const event of active.send({
        system: this.system,
        messages: [...this.messages],
        tools,
      })) {
        if (event.type === 'text') {
          text += event.delta;
          this.ui.onText(event.delta);
        } else if (event.type === 'tool_call') {
          toolCalls.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input });
        } else {
          this.ui.onUsage(event.usage, active.model);
        }
      }

      const assistantContent = [
        ...(text.length > 0 ? [{ type: 'text' as const, text }] : []),
        ...toolCalls,
      ];
      this.messages.push({ role: 'assistant', content: assistantContent });
      this.ui.onAssistantEnd();

      if (toolCalls.length === 0) return;

      // The local model can explicitly hand off via the `escalate` tool.
      if (!escalated && toolCalls.some((c) => c.name === 'escalate')) {
        active = this.escalate('requested by model');
        escalated = true;
      }

      const results: ToolResultBlock[] = [];
      let anyError = false;
      for (const call of toolCalls) {
        const result = await this.executeToolCall(call);
        if (result.isError) anyError = true;
        results.push(result);
      }
      this.messages.push({ role: 'user', content: results });

      // Auto-escalate a local model that appears stuck (repeated tool errors).
      if (!escalated) {
        consecutiveErrors = anyError ? consecutiveErrors + 1 : 0;
        if (consecutiveErrors >= STUCK_THRESHOLD) {
          active = this.escalate('stuck — repeated tool errors');
          escalated = true;
        }
      }
    }

    this.ui.onMaxIterations();
  }

  /** Pick the provider for a turn: heavy tasks start on the frontier model. */
  private selectInitialProvider(input: string): ModelProvider {
    if (this.escalationProvider && this.router && this.router(input) === 'heavy') {
      this.ui.onRoute(this.escalationProvider.name, this.escalationProvider.model, 'heavy task');
      return this.escalationProvider;
    }
    return this.provider;
  }

  /** Switch to the frontier provider mid-turn. Falls back to the primary if unset. */
  private escalate(reason: string): ModelProvider {
    if (!this.escalationProvider) return this.provider;
    this.ui.onRoute(this.escalationProvider.name, this.escalationProvider.model, reason);
    return this.escalationProvider;
  }

  private async executeToolCall(call: ToolUseBlock): Promise<ToolResultBlock> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return errorResult(call.id, `Unknown tool: ${call.name}`);
    }

    const parsed = tool.schema.safeParse(call.input);
    if (!parsed.success) {
      return errorResult(call.id, `Invalid input for ${call.name}: ${parsed.error.message}`);
    }

    const allowed = await this.gate.check(tool, parsed.data);
    if (!allowed) {
      this.ui.onToolDenied(call.name);
      return errorResult(call.id, 'The user denied permission to run this tool.');
    }

    this.ui.onToolStart(call.name, parsed.data);
    let result: ToolResult;
    try {
      result = await tool.execute(parsed.data, { cwd: this.cwd });
    } catch (err) {
      result = { output: `Tool threw: ${(err as Error).message}`, isError: true };
    }
    this.ui.onToolResult(call.name, result);

    return {
      type: 'tool_result',
      toolUseId: call.id,
      content: result.output,
      isError: result.isError ?? false,
    };
  }
}

function errorResult(toolUseId: string, content: string): ToolResultBlock {
  return { type: 'tool_result', toolUseId, content, isError: true };
}
