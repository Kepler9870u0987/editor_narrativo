import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionBufferManager } from '../src/session-buffer.js';

describe('SessionBufferManager', () => {
  let manager: SessionBufferManager;

  beforeEach(() => {
    manager = new SessionBufferManager();
  });

  afterEach(() => {
    manager.destroyAll();
  });

  it('creates and retrieves sessions', () => {
    manager.create('session-1');
    expect(manager.has('session-1')).toBe(true);
    expect(manager.activeSessionCount).toBe(1);
  });

  it('appends tokens to a session', () => {
    manager.create('session-1');
    manager.appendToken('session-1', 'Hello');
    manager.appendToken('session-1', ' world');

    const session = manager.flush('session-1');
    expect(session).not.toBeNull();
    expect(session!.tokens).toEqual(['Hello', ' world']);
  });

  it('flush removes the session', () => {
    manager.create('session-1');
    manager.flush('session-1');
    expect(manager.has('session-1')).toBe(false);
  });

  it('returns null for unknown session', () => {
    expect(manager.flush('unknown')).toBeNull();
  });

  it('marks stream as completed', () => {
    manager.create('session-1');
    manager.appendToken('session-1', 'token');
    manager.completeStream('session-1', { hasConflict: false });

    const session = manager.flush('session-1');
    expect(session!.streamCompleted).toBe(true);
    expect(session!.finalResult).toEqual({ hasConflict: false });
  });

  it('marks stream as errored', () => {
    manager.create('session-1');
    manager.errorStream('session-1', 'LLM timeout');

    const session = manager.flush('session-1');
    expect(session!.streamCompleted).toBe(true);
    expect(session!.error).toBe('LLM timeout');
  });

  it('destroyAll cleans up all sessions', () => {
    manager.create('s1');
    manager.create('s2');
    manager.create('s3');
    expect(manager.activeSessionCount).toBe(3);

    manager.destroyAll();
    expect(manager.activeSessionCount).toBe(0);
  });

  it('appendToken returns false for non-existent session', () => {
    expect(manager.appendToken('ghost', 'test')).toBe(false);
  });
});
