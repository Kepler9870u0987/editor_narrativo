/**
 * Session Buffer — "Detach, Don't Destroy" pattern for WebSocket resilience.
 *
 * When a client disconnects, the LLM streaming response continues.
 * Tokens are accumulated in a RAM buffer with a TTL.
 * On reconnection, the buffer is flushed to the client and streaming resumes.
 */

import { WS_SESSION_TTL_MS } from '@editor-narrativo/shared';
import type { LogicCheckResponse } from '@editor-narrativo/shared';

export interface SessionAttachment {
  onToken: (token: string) => boolean;
  onComplete: (result: LogicCheckResponse) => boolean;
  onError: (message: string) => boolean;
}

export interface AttachSessionResult {
  status: 'attached' | 'missing' | 'forbidden';
}

export interface BufferedSession {
  /** User that owns the session */
  ownerId: string;
  /** Accumulated tokens while the client was disconnected */
  tokens: string[];
  /** UTF-8 bytes currently buffered */
  bufferedBytes: number;
  /** Whether the LLM stream has completed */
  streamCompleted: boolean;
  /** Final result (only if streamCompleted) */
  finalResult?: LogicCheckResponse;
  /** Error (only if stream errored) */
  error?: string;
  /** Timer handle for TTL expiry */
  ttlTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp of creation */
  createdAt: number;
  /** Currently attached client, if any */
  attachment: SessionAttachment | null;
  /** Abort controller for the upstream LLM stream */
  controller: AbortController | null;
}

export interface SessionBufferManagerConfig {
  maxBufferedTokens?: number;
  maxBufferedBytes?: number;
  onAbort?: (
    sessionId: string,
    session: BufferedSession,
    reason: string,
  ) => void;
}

const DEFAULT_MAX_BUFFERED_TOKENS = 2_000;
const DEFAULT_MAX_BUFFERED_BYTES = 256 * 1024;

export class SessionBufferManager {
  private sessions = new Map<string, BufferedSession>();
  private readonly maxBufferedTokens: number;
  private readonly maxBufferedBytes: number;
  private readonly onAbort?: SessionBufferManagerConfig['onAbort'];

  constructor(config: SessionBufferManagerConfig = {}) {
    this.maxBufferedTokens =
      config.maxBufferedTokens ?? DEFAULT_MAX_BUFFERED_TOKENS;
    this.maxBufferedBytes =
      config.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.onAbort = config.onAbort;
  }

  /**
   * Create a new active session for a client stream.
   */
  create(
    sessionId: string,
    ownerId: string,
    controller: AbortController | null,
    attachment: SessionAttachment | null = null,
  ): BufferedSession | null {
    if (this.sessions.has(sessionId)) {
      return null;
    }

    const session: BufferedSession = {
      ownerId,
      tokens: [],
      bufferedBytes: 0,
      streamCompleted: false,
      createdAt: Date.now(),
      ttlTimer: null,
      attachment,
      controller,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  setController(sessionId: string, controller: AbortController): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.controller = controller;
    return true;
  }

  attach(
    sessionId: string,
    ownerId: string,
    attachment: SessionAttachment,
  ): AttachSessionResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: 'missing' };
    }

    if (session.ownerId !== ownerId) {
      return { status: 'forbidden' };
    }

    if (session.ttlTimer) {
      clearTimeout(session.ttlTimer);
      session.ttlTimer = null;
    }

    session.attachment = attachment;

    if (session.tokens.length > 0) {
      const pendingTokens = [...session.tokens];
      session.tokens = [];
      session.bufferedBytes = 0;

      for (let i = 0; i < pendingTokens.length; i++) {
        const token = pendingTokens[i]!;
        if (!attachment.onToken(token)) {
          session.tokens = pendingTokens.slice(i);
          session.bufferedBytes = session.tokens.reduce(
            (sum, item) => sum + this.getTokenByteLength(item),
            0,
          );
          this.detach(sessionId);
          return { status: 'attached' };
        }
      }
    }

    if (session.streamCompleted) {
      if (session.error) {
        if (attachment.onError(session.error)) {
          this.destroy(sessionId);
        } else {
          this.detach(sessionId);
        }
      } else if (session.finalResult) {
        if (attachment.onComplete(session.finalResult)) {
          this.destroy(sessionId);
        } else {
          this.detach(sessionId);
        }
      }
    }

    return { status: 'attached' };
  }

  detach(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.attachment = null;
    if (!session.ttlTimer) {
      session.ttlTimer = setTimeout(() => {
        this.abort(sessionId, 'Session expired while detached');
      }, WS_SESSION_TTL_MS);
    }
    return true;
  }

  /**
   * Append a token to a buffered session.
   */
  appendToken(sessionId: string, token: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.attachment && session.attachment.onToken(token)) {
      return true;
    }

    if (session.attachment) {
      this.detach(sessionId);
    }

    session.tokens.push(token);
    session.bufferedBytes += this.getTokenByteLength(token);

    if (
      session.tokens.length > this.maxBufferedTokens ||
      session.bufferedBytes > this.maxBufferedBytes
    ) {
      this.abort(sessionId, 'Session buffer limit exceeded');
      return false;
    }

    return true;
  }

  /**
   * Mark a session's stream as completed with a final result.
   */
  completeStream(sessionId: string, result: LogicCheckResponse): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.streamCompleted = true;
    session.finalResult = result;

    if (session.attachment) {
      if (session.attachment.onComplete(result)) {
        this.destroy(sessionId);
      } else {
        this.detach(sessionId);
      }
    }

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

    if (session.attachment) {
      if (session.attachment.onError(error)) {
        this.destroy(sessionId);
      } else {
        this.detach(sessionId);
      }
    }

    return true;
  }

  /**
   * Abort an in-flight session and release all resources.
   */
  abort(sessionId: string, reason = 'Session aborted'): BufferedSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.controller) {
      try {
        session.controller.abort(reason);
      } catch {
        // AbortController.abort may ignore duplicate calls depending on runtime.
      }
    }

    this.onAbort?.(sessionId, session, reason);
    this.destroy(sessionId);
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
      if (session.ttlTimer) {
        clearTimeout(session.ttlTimer);
      }
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Destroy all sessions (for server shutdown).
   */
  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.abort(id, 'Server shutting down');
    }
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  private getTokenByteLength(token: string): number {
    return new TextEncoder().encode(token).byteLength;
  }
}
