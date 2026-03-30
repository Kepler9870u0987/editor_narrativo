import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionBufferManager } from '../src/session-buffer.js';

describe('SessionBufferManager', () => {
  let manager: SessionBufferManager;

  beforeEach(() => {
    manager = new SessionBufferManager();
  });

  afterEach(() => {
    manager.destroyAll();
  });

  it('creates owned sessions', () => {
    const created = manager.create('session-1', 'user-1', new AbortController());
    expect(created).not.toBeNull();
    expect(manager.has('session-1')).toBe(true);
    expect(manager.activeSessionCount).toBe(1);
  });

  it('buffers tokens while detached and flushes them on attach', () => {
    const controller = new AbortController();
    manager.create('session-1', 'user-1', controller);
    manager.appendToken('session-1', 'Hello');
    manager.appendToken('session-1', ' world');

    const received: string[] = [];
    const result = manager.attach('session-1', 'user-1', {
      onToken: (token) => {
        received.push(token);
        return true;
      },
      onComplete: () => true,
      onError: () => true,
    });

    expect(result.status).toBe('attached');
    expect(received).toEqual(['Hello', ' world']);
  });

  it('rejects attach attempts from a different owner', () => {
    manager.create('session-1', 'user-1', new AbortController());

    const result = manager.attach('session-1', 'user-2', {
      onToken: () => true,
      onComplete: () => true,
      onError: () => true,
    });

    expect(result.status).toBe('forbidden');
  });

  it('keeps an active stream attached after reconnect', () => {
    manager.create('session-1', 'user-1', new AbortController());
    manager.detach('session-1');

    const tokens: string[] = [];
    manager.attach('session-1', 'user-1', {
      onToken: (token) => {
        tokens.push(token);
        return true;
      },
      onComplete: () => true,
      onError: () => true,
    });

    manager.appendToken('session-1', 'live');
    expect(tokens).toEqual(['live']);
  });

  it('delivers final result immediately when a completed session reconnects', () => {
    manager.create('session-1', 'user-1', new AbortController());
    manager.detach('session-1');
    manager.completeStream('session-1', {
      hasConflict: false,
      conflicts: [],
      evidence_chains: [],
    });

    const onComplete = vi.fn(() => true);
    const result = manager.attach('session-1', 'user-1', {
      onToken: () => true,
      onComplete,
      onError: () => true,
    });

    expect(result.status).toBe('attached');
    expect(onComplete).toHaveBeenCalledOnce();
    expect(manager.has('session-1')).toBe(false);
  });

  it('aborts upstream work when the session is aborted', () => {
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, 'abort');
    manager.create('session-1', 'user-1', controller);

    manager.abort('session-1', 'manual abort');

    expect(abortSpy).toHaveBeenCalledWith('manual abort');
    expect(manager.has('session-1')).toBe(false);
  });

  it('appendToken returns false for non-existent session', () => {
    expect(manager.appendToken('ghost', 'test')).toBe(false);
  });

  it('aborts sessions that exceed buffer limits', () => {
    const onAbort = vi.fn();
    const limitedManager = new SessionBufferManager({
      maxBufferedTokens: 1,
      maxBufferedBytes: 10,
      onAbort,
    });

    limitedManager.create('session-1', 'user-1', new AbortController());
    expect(limitedManager.appendToken('session-1', '12345')).toBe(true);
    expect(limitedManager.appendToken('session-1', '67890')).toBe(false);
    expect(onAbort).toHaveBeenCalled();
    expect(limitedManager.has('session-1')).toBe(false);
  });
});
