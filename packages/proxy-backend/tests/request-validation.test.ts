import { describe, expect, it } from 'vitest';
import {
  parseLogicCheckRequest,
  parseWSClientMessage,
} from '../src/request-validation.js';

describe('request validation', () => {
  it('accepts valid logic check payloads', () => {
    expect(parseLogicCheckRequest({
      sceneText: 'Marco entra nella stanza.',
      ragContext: ['Passaggio 1', 'Passaggio 2'],
      sessionId: 'session-123',
    })).toEqual({
      sceneText: 'Marco entra nella stanza.',
      ragContext: ['Passaggio 1', 'Passaggio 2'],
      sessionId: 'session-123',
    });
  });

  it('accepts REST payloads without session id', () => {
    expect(parseLogicCheckRequest({
      sceneText: 'Marco entra nella stanza.',
      ragContext: ['Passaggio 1'],
    })).toEqual({
      sceneText: 'Marco entra nella stanza.',
      ragContext: ['Passaggio 1'],
    });
  });

  it('rejects invalid session ids', () => {
    expect(parseLogicCheckRequest({
      sceneText: 'Test',
      ragContext: [],
      sessionId: '../evil',
    })).toBeNull();
  });

  it('rejects malformed websocket messages', () => {
    expect(parseWSClientMessage({ type: 'AUTH', token: 123 })).toBeNull();
    expect(parseWSClientMessage({ type: 'RECONNECT', sessionId: '' })).toBeNull();
    expect(parseWSClientMessage({ type: 'LOGIC_CHECK', payload: { foo: 'bar' } })).toBeNull();
  });

  it('accepts valid websocket messages', () => {
    expect(parseWSClientMessage({
      type: 'CREATE_SESSION',
    })).toEqual({
      type: 'CREATE_SESSION',
    });

    expect(parseWSClientMessage({
      type: 'AUTH',
      token: 'jwt-token',
    })).toEqual({
      type: 'AUTH',
      token: 'jwt-token',
    });

    expect(parseWSClientMessage({
      type: 'RECONNECT',
      sessionId: 'session-1',
    })).toEqual({
      type: 'RECONNECT',
      sessionId: 'session-1',
    });

    expect(parseWSClientMessage({
      type: 'LOGIC_CHECK',
      payload: {
        sceneText: 'Test',
        ragContext: [],
        sessionId: 'session-1',
      },
    })).toEqual({
      type: 'LOGIC_CHECK',
      payload: {
        sceneText: 'Test',
        ragContext: [],
        sessionId: 'session-1',
      },
    });
  });
});
