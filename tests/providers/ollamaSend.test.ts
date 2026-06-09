import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaProvider } from '../../src/providers/ollama.js';
import type { ProviderEvent } from '../../src/providers/types.js';

/** Build a fake SSE Response body from a list of OpenAI-style chunks. */
function sseResponse(chunks: unknown[]): Response {
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).concat('data: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) controller.enqueue(enc.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => vi.restoreAllMocks());

async function collect(provider: OllamaProvider): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const e of provider.send({
    system: 's',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    tools: [{ name: 'ls', description: 'list', jsonSchema: { type: 'object' } }],
  })) {
    events.push(e);
  }
  return events;
}

describe('OllamaProvider.send', () => {
  it('maps streamed deltas into text, tool_call, and done events', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'ls', arguments: '{"path":' } }] },
            },
          ],
        },
        {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"."}' } }] }, finish_reason: 'tool_calls' }],
        },
        { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } },
      ]),
    );

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' });
    const events = await collect(provider);

    const text = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta);
    expect(text.join('')).toBe('Hello');

    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toMatchObject({ type: 'tool_call', id: 'c1', name: 'ls', input: { path: '.' } });

    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({
      type: 'done',
      stopReason: 'tool_use',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
  });

  it('degrades to empty input on malformed tool-call JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'ls', arguments: '{bad' } }] } },
          ],
        },
      ]),
    );
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434/v1', model: 'm' });
    const events = await collect(provider);
    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toMatchObject({ name: 'ls', input: {} });
  });

  it('retries without stream_options when the server rejects it with a 400', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('unknown field "stream_options"', { status: 400 }))
      .mockResolvedValueOnce(sseResponse([{ choices: [{ delta: { content: 'ok' } }] }]));

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434/v1', model: 'm' });
    const events = await collect(provider);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    const retryBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(firstBody.stream_options).toEqual({ include_usage: true });
    expect(retryBody.stream_options).toBeUndefined();
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('ok');
  });

  it('forwards maxTokens as max_tokens, and omits it when unset', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ choices: [{ delta: { content: 'ok' } }] }]));

    await collect(new OllamaProvider({ baseUrl: 'http://localhost:11434/v1', model: 'm', maxTokens: 256 }));
    const capped = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(capped.max_tokens).toBe(256);

    fetchMock.mockClear();
    await collect(new OllamaProvider({ baseUrl: 'http://localhost:11434/v1', model: 'm' }));
    const uncapped = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(uncapped).not.toHaveProperty('max_tokens');
  });

  it('throws a helpful error when Ollama is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434/v1', model: 'm' });
    await expect(collect(provider)).rejects.toThrow(/Cannot reach Ollama/);
  });

  it('aborts and reports a timeout when the server goes silent', async () => {
    // Never resolves on its own — only the idle-timeout abort can end it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434/v1', model: 'm', timeoutMs: 20 });
    await expect(collect(provider)).rejects.toThrow(/went silent.*aborted/);
  });
});
