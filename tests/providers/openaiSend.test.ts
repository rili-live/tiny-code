import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
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

async function collect(provider: OpenAIProvider): Promise<ProviderEvent[]> {
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

describe('OpenAIProvider.send', () => {
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

    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4.1' });
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
    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4.1' });
    const events = await collect(provider);
    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toMatchObject({ name: 'ls', input: {} });
  });

  it('sends stream_options.include_usage in the request body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ choices: [{ delta: { content: 'ok' } }] }]));

    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4.1' });
    await collect(provider);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('forwards maxTokens as max_completion_tokens, omits it when unset', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ choices: [{ delta: { content: 'ok' } }] }]));

    await collect(new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4.1', maxTokens: 512 }));
    const capped = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(capped.max_completion_tokens).toBe(512);

    fetchMock.mockClear();
    await collect(new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4.1' }));
    const uncapped = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(uncapped).not.toHaveProperty('max_completion_tokens');
  });

  it('sends the Authorization header with the API key', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ choices: [{ delta: { content: 'ok' } }] }]));

    await collect(new OpenAIProvider({ apiKey: 'sk-my-key', model: 'gpt-4.1' }));
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-my-key');
  });

  it('uses a custom baseUrl when provided', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ choices: [{ delta: { content: 'ok' } }] }]));

    await collect(
      new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4.1', baseUrl: 'https://my-proxy.example.com/v1' }),
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://my-proxy.example.com/v1/chat/completions');
  });

  it('still parses a final usage frame that lacks a trailing newline', async () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}'; // no trailing \n
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4.1' });
    const done = (await collect(provider)).find((e) => e.type === 'done');
    expect(done).toMatchObject({ usage: { inputTokens: 3, outputTokens: 4 } });
  });

  it('throws a helpful error when the server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4.1' });
    await expect(collect(provider)).rejects.toThrow(/Cannot reach OpenAI/);
  });

  it('throws on non-2xx responses with the status and body detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid_api_key', { status: 401 }));
    const provider = new OpenAIProvider({ apiKey: 'sk-bad', model: 'gpt-4.1' });
    await expect(collect(provider)).rejects.toThrow(/OpenAI request failed \(401\)/);
  });
});
