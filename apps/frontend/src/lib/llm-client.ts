/**
 * LLM Client — Browser-side OpenAI-compatible streaming client.
 *
 * All LLM calls go directly from the browser using the user's API key.
 * The server NEVER sees the API key or plaintext content (zero-knowledge).
 *
 * Supports any OpenAI-compatible endpoint:
 *   - OpenAI, Azure, Together AI, Groq, LM Studio, Ollama, etc.
 */

export interface LLMConfig {
  provider: 'openai-compatible';
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Stream a chat completion from any OpenAI-compatible endpoint.
 * Yields token strings as they arrive via SSE.
 */
export async function* streamChatCompletion(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): AsyncIterableIterator<string> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      max_tokens: 1024,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => response.statusText);
    throw new Error(`LLM API error ${response.status}: ${errorBody}`);
  }

  if (!response.body) {
    throw new Error('LLM response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
          }
        } catch {
          // Malformed SSE line — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming single completion — for testing API connectivity.
 */
export async function testLLMConnection(config: LLMConfig): Promise<string> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: 'Rispondi solo con "ok".' }],
      stream: false,
      max_tokens: 10,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => response.statusText);
    throw new Error(`LLM API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? '';
}
