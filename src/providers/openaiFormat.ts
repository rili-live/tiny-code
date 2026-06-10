import type { Message } from '../agent/types.js';
import type { ToolSchema } from './types.js';

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * Translate internal messages into OpenAI chat messages (the shape the
 * `/v1/chat/completions` endpoint accepts). Unlike Gemini, OpenAI correlates
 * tool results to calls by `tool_call_id`, and our Anthropic-style ids survive
 * the round trip — so no id synthesis is needed.
 *
 * Assumes the loop never mixes plain text and tool results in one user turn in a
 * way that would interleave them: we emit all `tool` messages first, then any
 * text as a trailing user message. OpenAI requires each `tool` message to follow
 * the assistant `tool_calls` that produced it; today's loop builds messages so
 * that holds. If a future change interleaves them, revisit this ordering.
 */
export function toOpenAiMessages(messages: Message[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      // A user turn may carry plain text and/or tool results; emit each result
      // as its own `tool` message and gather any text into one user message.
      let text = '';
      for (const b of m.content) {
        if (b.type === 'text') text += b.text;
        else if (b.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });
        }
      }
      if (text.length > 0) out.push({ role: 'user', content: text });
      continue;
    }

    // assistant: merge text + tool_use into a single message
    let text = '';
    const toolCalls: NonNullable<OpenAiMessage['tool_calls']> = [];
    for (const b of m.content) {
      if (b.type === 'text') text += b.text;
      else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        });
      }
    }
    const msg: OpenAiMessage = { role: 'assistant', content: text };
    if (toolCalls.length > 0) msg.tool_calls = toolCalls;
    out.push(msg);
  }
  return out;
}

/** Translate normalized tool schemas into OpenAI's `tools` array. */
export function toOpenAiTools(tools: ToolSchema[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.jsonSchema },
  }));
}

export interface StreamChoice {
  delta?: {
    content?: string | null;
    tool_calls?: {
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[];
  };
  finish_reason?: string | null;
}

export interface StreamChunk {
  choices?: StreamChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** Decode a single SSE line into a chunk, or `undefined` for non-data/keep-alive lines. */
export function parseSseLine(raw: string): StreamChunk | undefined {
  const line = raw.trim();
  if (!line.startsWith('data:')) return undefined;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]' || payload.length === 0) return undefined;
  try {
    return JSON.parse(payload) as StreamChunk;
  } catch {
    // Ignore partial/non-JSON keep-alive lines.
    return undefined;
  }
}

/** Parse an SSE byte stream into decoded JSON chunks, skipping the `[DONE]` sentinel. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const chunk = parseSseLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (chunk) yield chunk;
      }
    }
    // Emit a final line that arrived without a trailing newline (e.g. a closing
    // usage frame); otherwise the last chunk's token counts would be dropped.
    const tail = parseSseLine(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
