import { z } from 'zod';
import { defineTool } from './types.js';

/**
 * A signal tool, not a worker. When local-first routing is active and the
 * current (cheap/local) model decides a task needs deeper reasoning — a large
 * or multi-file refactor, tricky debugging, or it is simply stuck — it calls
 * this tool. The agent loop watches for it and swaps in the configured frontier
 * model for the rest of the turn, with full conversation context preserved.
 * The tool itself just acknowledges; the loop performs the handoff.
 */
export const escalateTool = defineTool({
  name: 'escalate',
  description:
    'Hand off the current task to a more capable model when it needs deep reasoning, a large or multi-file change, tricky debugging, or you are stuck. Prefer escalating early over guessing. Provide a brief reason.',
  mutating: false,
  schema: z.object({
    reason: z.string().describe('A brief reason the task needs a more capable model.'),
  }),
  async execute(input) {
    return {
      output: `Escalation acknowledged (${input.reason}). A more capable model will continue this task.`,
      summary: 'escalating',
    };
  },
});
