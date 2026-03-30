import { describe, expect, it, vi } from 'vitest';
import {
  OpenAICompatibleProvider,
  consumeSSEEvents,
  parseSSEEventData,
} from '../src/llm-provider.js';

describe('SSE parsing helpers', () => {
  it('splits complete events while keeping partial remainder', () => {
    const result = consumeSSEEvents(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
    );

    expect(result.events).toHaveLength(1);
    expect(result.remainder).toContain('"lo"');
  });

  it('extracts event data payload', () => {
    expect(parseSSEEventData('event: message\ndata: {"ok":true}')).toBe('{"ok":true}');
  });
});

describe('OpenAICompatibleProvider', () => {
  it('reconstructs SSE events split across chunks', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      '\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(stream, { status: 200 }));

    const provider = new OpenAICompatibleProvider({
      apiKey: 'test',
      baseUrl: 'https://example.com',
      model: 'test-model',
    });

    const tokens: string[] = [];
    const result = await new Promise<string>((resolve, reject) => {
      provider.streamCompletion(
        [{ role: 'user', content: 'ciao' }],
        {
          onToken: (token) => {
            tokens.push(token);
          },
          onComplete: resolve,
          onError: reject,
        },
      );
    });

    expect(tokens).toEqual(['Hel', 'lo']);
    expect(result).toBe('Hello');
    fetchSpy.mockRestore();
  });
});
