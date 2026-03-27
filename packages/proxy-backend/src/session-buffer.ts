/**
 * Session Buffer — "Detach, Don't Destroy" pattern for WebSocket resilience.
 *
 * When a client disconnects, the LLM streaming response continues.
 * Tokens are accumulated in a RAM buffer with a TTL.
 * On reconnection, the buffer is flushed to the client and streaming resumes.
 */

import { WS_SESSION_TTL_MS } from '@editor-narrativo/shared';

export interface BufferedSession {
  /** Accumulated tokens while the client was disconnected */
  tokens: string[];
  /** Whether the LLM stream has completed */
  streamCompleted: boolean;
  /** Final result (only if streamCompleted) */
  finalResult?: unknown;
  /** Error (only if stream errored) */
  error?: string;
  /** Timer handle for TTL expiry */
  ttlTimer: ReturnType<typeof setTimeout>;
  /** Timestamp of creation */
  createdAt: number;
}

export class SessionBufferManager {
  private sessions = new Map<string, BufferedSession>();

  /**
   * Create a new session buffer for a disconnected client.
   */
  create(sessionId: string): BufferedSession {
    // Clean up existing session if any
    this.destroy(sessionId);

    const session: BufferedSession = {
      tokens: [],
      streamCompleted: false,
      createdAt: Date.now(),
      ttlTimer: setTimeout(() => {
        this.destroy(sessionId);
      }, WS_SESSION_TTL_MS),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Append a token to a buffered session.
   */
  appendToken(sessionId: string, token: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.tokens.push(token);
    return true;
  }

  /**
   * Mark a session's stream as completed with a final result.
   */
  completeStream(sessionId: string, result: unknown): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.streamCompleted = true;
    session.finalResult = result;
    return true;
  }

  /**
   * Mark a session's stream as errored.
   */
  errorStream(sessionId: string, error: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.streamCompleted = true;
    session.error = error;
    return true;
  }

  /**
   * Flush the buffer on reconnection. Returns all accumulated tokens
   * and removes the session from the buffer.
   */
  flush(sessionId: string): BufferedSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    clearTimeout(session.ttlTimer);
    this.sessions.delete(sessionId);
    return session;
  }

  /**
   * Check if a session exists and is still valid.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Destroy a session buffer (TTL expiry or explicit cleanup).
   */
  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      clearTimeout(session.ttlTimer);
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Destroy all sessions (for server shutdown).
   */
  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }
}
