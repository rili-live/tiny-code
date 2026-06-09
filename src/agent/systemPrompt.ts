import type { ToolSchema } from '../providers/types.js';

export interface SystemPromptParams {
  cwd: string;
  projectContext: string;
  tools: ToolSchema[];
  /** When true, this model is the cheap/local model in a local-first setup. */
  escalation?: boolean;
}

const ESCALATION_GUIDANCE = `Cost-aware routing: you are running as a fast, low-cost model. Handle routine work yourself — reading, searching, listing, and small, well-scoped edits. If a task needs deep reasoning, a large or multi-file refactor, tricky debugging, or you find yourself stuck or uncertain, call the \`escalate\` tool with a brief reason to hand off to a more capable model. Prefer escalating early over guessing.`;

const BASE_PERSONA = `You are a precise, autonomous coding agent operating in a terminal.

Guidelines:
- Use the provided tools to inspect and modify the codebase rather than guessing.
- Read files before editing them. Prefer small, targeted edits.
- When you run commands, explain briefly what you are doing only if it is non-obvious.
- Match the conventions of the surrounding code.
- When the task is complete, give a short summary of what changed. Do not narrate routine steps.
- Be concise. Avoid restating the task or narrating completed steps. Every output token has a cost.
- Prefer targeted reads (offset/limit) and filtered searches (glob patterns) over reading entire files or scanning broadly.`;

/** Compose the system prompt from persona, environment, tools, and project context. */
export function buildSystemPrompt(params: SystemPromptParams): string {
  const toolList = params.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');

  const sections = [
    BASE_PERSONA,
    `Working directory: ${params.cwd}`,
    `Available tools:\n${toolList}`,
  ];

  if (params.escalation) {
    sections.push(ESCALATION_GUIDANCE);
  }

  if (params.projectContext.trim().length > 0) {
    sections.push(
      `Project-specific instructions (from the project's context file):\n\n${params.projectContext.trim()}`,
    );
  }

  return sections.join('\n\n');
}
