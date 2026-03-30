/**
 * LLM Provider Client — Abstraction over external LLM APIs (OpenAI, DeepSeek).
 *
 * Stateless: no data is logged or persisted. ZDR compliant.
 * Supports streaming responses.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMStreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

export interface LLMProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function consumeSSEEvents(buffer: string): {
  events: string[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const remainder = parts.pop() ?? '';

  return {
    events: parts,
    remainder,
  };
}

export function parseSSEEventData(eventBlock: string): string | null {
  const dataLines = eventBlock
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join('\n').trim();
}

/**
 * Abstract LLM provider interface for ZDR-compliant proxy forwarding.
 */
export interface LLMProvider {
  /**
   * Stream a completion from the LLM. Calls onToken for each token,
   * onComplete with the full response, or onError on failure.
   *
   * Returns an AbortController to cancel the stream.
   */
  streamCompletion(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
  ): AbortController;
}

/**
 * OpenAI-compatible LLM provider (works with OpenAI, DeepSeek, Azure, etc.)
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  streamCompletion(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
  ): AbortController {
    const controller = new AbortController();

    this.doStream(messages, callbacks, controller.signal).catch((err) => {
      if (!controller.signal.aborted) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return controller;
  }

  private async doStream(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: true,
        response_format: { type: 'json_object' },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('LLM API returned no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let pending = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        const { events, remainder } = consumeSSEEvents(pending);
        pending = remainder;

        for (const eventBlock of events) {
          const data = parseSSEEventData(eventBlock);
          if (!data || data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              fullResponse += token;
              callbacks.onToken(token);
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }

      const tail = parseSSEEventData(pending);
      if (tail && tail !== '[DONE]') {
        try {
          const parsed = JSON.parse(tail) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullResponse += token;
            callbacks.onToken(token);
          }
        } catch {
          // Ignore incomplete trailing event.
        }
      }
    } finally {
      reader.releaseLock();
    }

    callbacks.onComplete(fullResponse);
  }
}
