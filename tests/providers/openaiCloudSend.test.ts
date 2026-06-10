import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeepSeekProvider } from '../../src/providers/deepseek.js';
import { QwenProvider } from '../../src/providers/qwen.js';
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

async function collect(provider: DeepSeekProvider | QwenProvider): Promise<ProviderEvent[]> {
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

describe('DeepSeekProvider.send', () => {
  it('targets the DeepSeek endpoint with the API key and streams events', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { choices: [{ delta: { content: 'hi' } }] },
        { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      ]),
    );

    const provider = new DeepSeekProvider({ apiKey: 'sk-deep', model: 'deepseek-v4-pro' });
    expect(provider.name).toBe('deepseek');

    const events = await collect(provider);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-deep' });

    const text = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta);
    expect(text.join('')).toBe('hi');
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ usage: { inputTokens: 5, outputTokens: 2 } });
  });

  it('synthesizes a provider-scoped tool-call id when the server omits one', async () => {
    // The OpenAI wire format normally supplies an id; some servers don't. The
    // fallback must stay non-empty so the result can be correlated next turn.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { name: 'ls', arguments: '{}' } }] } },
          ],
        },
      ]),
    );
    const provider = new DeepSeekProvider({ apiKey: 'k', model: 'deepseek-v4-pro' });
    const call = (await collect(provider)).find((e) => e.type === 'tool_call');
    expect(call).toMatchObject({ name: 'ls', id: 'deepseek-call-0' });
  });

  it('reports a DeepSeek-specific error when the host is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));
    const provider = new DeepSeekProvider({ apiKey: 'k', model: 'deepseek-v4-pro' });
    await expect(collect(provider)).rejects.toThrow(/Cannot reach DeepSeek/);
  });
});

describe('QwenProvider.send', () => {
  it('targets the DashScope endpoint and respects a base URL override', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ choices: [{ delta: { content: 'ok' } }] }]));

    const provider = new QwenProvider({
      apiKey: 'sk-qwen',
      model: 'qwen3-coder-plus',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    });
    expect(provider.name).toBe('qwen');

    await collect(provider);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-qwen' });
  });
});
