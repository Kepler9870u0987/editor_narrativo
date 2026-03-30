import { appEnv } from '../../lib/env';
import { apiFetch } from '../../lib/http';
export const proxyApi = {
    complete(accessToken, payload) {
        return apiFetch(`${appEnv.proxyBasePath}/api/llm/complete`, {
            method: 'POST',
            accessToken,
            body: payload,
        });
    },
};
//# sourceMappingURL=proxy-api.js.map