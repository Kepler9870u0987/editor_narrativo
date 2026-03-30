import type { LogicCheckRequest, LogicCheckResponse } from '@editor-narrativo/shared';
import { appEnv } from '../../lib/env';
import { apiFetch } from '../../lib/http';

export const proxyApi = {
  complete(accessToken: string, payload: LogicCheckRequest) {
    return apiFetch<LogicCheckResponse>(`${appEnv.proxyBasePath}/api/llm/complete`, {
      method: 'POST',
      accessToken,
      body: payload,
    });
  },
};
