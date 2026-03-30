import type {
  LogicCheckRequest,
  WSClientMessage,
  WSLogicCheckRequest,
} from '@editor-narrativo/shared';

const MAX_SCENE_LENGTH = 50_000;
const MAX_RAG_CONTEXT_ITEMS = 20;
const MAX_RAG_CONTEXT_ITEM_LENGTH = 10_000;
const MAX_SESSION_ID_LENGTH = 128;
const MAX_TOKEN_LENGTH = 8_192;
const SESSION_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isValidSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    SESSION_ID_PATTERN.test(value)
  );
}

interface ParseLogicCheckRequestOptions {
  requireSessionId?: boolean;
}

export function parseLogicCheckRequest(
  value: unknown,
  options: ParseLogicCheckRequestOptions = {},
): LogicCheckRequest | null {
  if (!isRecord(value)) return null;

  const { sceneText, ragContext, sessionId } = value;
  if (typeof sceneText !== 'string' || sceneText.length === 0) return null;
  if (sceneText.length > MAX_SCENE_LENGTH) return null;
  if (!Array.isArray(ragContext) || ragContext.length > MAX_RAG_CONTEXT_ITEMS) {
    return null;
  }
  if (!ragContext.every(
    (item) => typeof item === 'string' && item.length <= MAX_RAG_CONTEXT_ITEM_LENGTH,
  )) {
    return null;
  }

  if (options.requireSessionId) {
    if (!isValidSessionId(sessionId)) return null;
    return {
      sceneText,
      ragContext,
      sessionId,
    };
  }

  if (sessionId !== undefined && !isValidSessionId(sessionId)) {
    return null;
  }

  return {
    sceneText,
    ragContext,
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
  };
}

function parseWSLogicCheckRequest(value: unknown): WSLogicCheckRequest | null {
  const parsed = parseLogicCheckRequest(value, { requireSessionId: true });
  if (!parsed?.sessionId) {
    return null;
  }

  return parsed as WSLogicCheckRequest;
}

export function parseWSClientMessage(value: unknown): WSClientMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  switch (value.type) {
    case 'AUTH':
      if (
        typeof value.token !== 'string' ||
        value.token.length === 0 ||
        value.token.length > MAX_TOKEN_LENGTH
      ) {
        return null;
      }
      return { type: 'AUTH', token: value.token };

    case 'CREATE_SESSION':
      return { type: 'CREATE_SESSION' };

    case 'RECONNECT':
      if (!isValidSessionId(value.sessionId)) {
        return null;
      }
      return { type: 'RECONNECT', sessionId: value.sessionId };

    case 'LOGIC_CHECK': {
      const payload = parseWSLogicCheckRequest(value.payload);
      if (!payload) return null;
      return { type: 'LOGIC_CHECK', payload };
    }

    default:
      return null;
  }
}

export const requestValidationLimits = {
  maxSceneLength: MAX_SCENE_LENGTH,
  maxRagContextItems: MAX_RAG_CONTEXT_ITEMS,
  maxRagContextItemLength: MAX_RAG_CONTEXT_ITEM_LENGTH,
  maxSessionIdLength: MAX_SESSION_ID_LENGTH,
  maxTokenLength: MAX_TOKEN_LENGTH,
} as const;
