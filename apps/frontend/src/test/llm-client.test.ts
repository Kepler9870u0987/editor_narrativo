/**
 * Test: LLM Client — SSE streaming parser and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChatCompletion, testLLMConnection, type LLMConfig } from '../lib/llm-client';

const TEST_CONFIG: LLMConfig = {
  provider: 'openai-compatible',
  apiKey: 'test-key-123',
  baseUrl: 'https://api.example.com',
  model: 'test-model',
};

function makeSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

describe('LLM Client', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('streamChatCompletion', () => {
    it('parses SSE tokens correctly', async () => {
      const sseLines = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" World"}}]}',
        'data: [DONE]',
      ];

      fetchSpy.mockResolvedValue({
        ok: true,
        body: makeSSEStream(sseLines),
      });

      const tokens: string[] = [];
      for await (const token of streamChatCompletion(TEST_CONFIG, 'sys', 'user')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['Hello', ' World']);
    });

    it('sends correct request format', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        body: makeSSEStream(['data: [DONE]']),
      });

      const tokens: string[] = [];
      for await (const token of streamChatCompletion(TEST_CONFIG, 'system prompt', 'user query')) {
        tokens.push(token);
      }

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key-123',
          },
        }),
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user query' },
      ]);
      expect(body.stream).toBe(true);
    });

    it('throws on non-ok response', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const tokens: string[] = [];
      await expect(async () => {
        for await (const token of streamChatCompletion(TEST_CONFIG, 'sys', 'user')) {
          tokens.push(token);
        }
      }).rejects.toThrow('LLM API error 401: Unauthorized');
    });

    it('throws when body is null', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        body: null,
      });

      await expect(async () => {
        for await (const _ of streamChatCompletion(TEST_CONFIG, 'sys', 'user')) {
          // consume
        }
      }).rejects.toThrow('LLM response has no body');
    });

    it('skips malformed SSE lines', async () => {
      const sseLines = [
        'data: {"choices":[{"delta":{"content":"A"}}]}',
        'data: INVALID_JSON',
        'data: {"choices":[{"delta":{"content":"B"}}]}',
        'data: [DONE]',
      ];

      fetchSpy.mockResolvedValue({
        ok: true,
        body: makeSSEStream(sseLines),
      });

      const tokens: string[] = [];
      for await (const token of streamChatCompletion(TEST_CONFIG, 'sys', 'user')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['A', 'B']);
    });

    it('strips trailing slash from baseUrl', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        body: makeSSEStream(['data: [DONE]']),
      });

      const config = { ...TEST_CONFIG, baseUrl: 'https://api.example.com/' };
      for await (const _ of streamChatCompletion(config, 'sys', 'user')) {
        // consume
      }

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/chat/completions',
        expect.anything(),
      );
    });
  });

  describe('testLLMConnection', () => {
    it('returns response content on success', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
        }),
      });

      const result = await testLLMConnection(TEST_CONFIG);
      expect(result).toBe('ok');
    });

    it('throws on API error', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(testLLMConnection(TEST_CONFIG)).rejects.toThrow('LLM API error 500');
    });

    it('sends non-streaming request', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      await testLLMConnection(TEST_CONFIG);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.stream).toBe(false);
      expect(body.max_tokens).toBe(10);
    });
  });
});
