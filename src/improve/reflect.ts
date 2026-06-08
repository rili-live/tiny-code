import type { ModelProvider } from '../providers/types.js';
import type { Message } from '../agent/types.js';

/** Sentinel the model emits when a session yields nothing worth proposing. */
export const NO_IMPROVEMENT = 'NO_IMPROVEMENT';

const MAX_RESULT_CHARS = 2_000;
const MAX_TRANSCRIPT_CHARS = 60_000;

const REFLECTION_SYSTEM = `You are a contributor reviewing how the "tiny-code" CLI coding agent itself performed in the session below. You are NOT here to finish the user's coding task — you are looking for ways to improve the agent (its prompts, tools, ergonomics, or docs).

Look for recurring friction: tool errors, repeated retries on the same file, denied permissions, confusion, hitting the iteration limit, or missing capabilities.

If — and only if — you find a concrete, worthwhile improvement, respond with a SINGLE markdown document and nothing else, in exactly this structure:

# <concise title>

## Summary
<one or two sentences>

## Motivation
<evidence drawn from this specific session>

## Proposed change
<what should change and why>

## Affected areas
<files, tools, or prompts likely involved>

## Risks
<trade-offs or things to watch>

If there is no clear improvement worth filing, respond with exactly:
${NO_IMPROVEMENT}

Do not propose code. Do not include anything outside the document or the sentinel.`;

/** Flatten the conversation into a compact, readable transcript for reflection. */
export function serializeTranscript(messages: readonly Message[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') {
        if (block.text.trim().length > 0) {
          lines.push(`[${message.role}] ${block.text.trim()}`);
        }
      } else if (block.type === 'tool_use') {
        lines.push(`[tool_use] ${block.name} ${JSON.stringify(block.input ?? {})}`);
      } else {
        const marker = block.isError ? ' (error)' : '';
        lines.push(`[tool_result${marker}] ${truncate(block.content, MAX_RESULT_CHARS)}`);
      }
    }
  }

  const transcript = lines.join('\n');
  return transcript.length > MAX_TRANSCRIPT_CHARS
    ? transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS)
    : transcript;
}

export interface ReflectOptions {
  provider: ModelProvider;
  transcript: string;
  cwd: string;
}

/**
 * Run a single tool-free reflection pass. Returns the proposal markdown, or
 * `null` when the model declines (sentinel) or produces nothing usable.
 *
 * No tools are passed, so this call cannot execute anything — it can only emit
 * text, which keeps reflection safe regardless of what the transcript contains.
 */
export async function reflect(opts: ReflectOptions): Promise<string | null> {
  const userText = `Working directory: ${opts.cwd}\n\nSession transcript:\n\n${opts.transcript}`;

  let text = '';
  for await (const event of opts.provider.send({
    system: REFLECTION_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    tools: [],
  })) {
    if (event.type === 'text') text += event.delta;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed === NO_IMPROVEMENT) return null;
  return trimmed;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
