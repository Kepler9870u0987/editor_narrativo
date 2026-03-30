import { appEnv } from '../../lib/env';
import { toWebSocketUrl } from '../../lib/ws-url';
export class LogicCheckStreamClient {
    accessToken;
    handlers;
    socket = null;
    authenticated = false;
    sessionId = null;
    pendingPayload = null;
    reconnectTimer = null;
    stopped = false;
    constructor(accessToken, handlers) {
        this.accessToken = accessToken;
        this.handlers = handlers;
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    run(payload) {
        this.pendingPayload = payload;
        if (!this.socket) {
            this.connect();
            return;
        }
        if (this.authenticated && this.sessionId) {
            this.send({
                type: 'LOGIC_CHECK',
                payload: {
                    ...payload,
                    sessionId: this.sessionId,
                },
            });
            return;
        }
        if (this.authenticated) {
            this.send({ type: 'CREATE_SESSION' });
        }
    }
    close() {
        this.stopped = true;
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        if (this.reconnectTimer) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.socket?.close();
        this.socket = null;
    }
    connect() {
        if (this.socket || this.stopped) {
            return;
        }
        this.socket = new WebSocket(toWebSocketUrl(`${appEnv.proxyBasePath}/ws`));
        this.socket.addEventListener('open', () => {
            this.send({ type: 'AUTH', token: this.accessToken });
        });
        this.socket.addEventListener('message', (event) => {
            const message = JSON.parse(String(event.data));
            this.handleMessage(message);
        });
        this.socket.addEventListener('close', () => {
            this.socket = null;
            this.authenticated = false;
            if (!this.stopped && this.sessionId) {
                this.scheduleReconnect();
            }
        });
        this.socket.addEventListener('error', () => {
            this.handlers.onError('Connessione streaming non disponibile');
        });
    }
    handleMessage(message) {
        switch (message.type) {
            case 'AUTH_OK':
                this.authenticated = true;
                if (this.sessionId) {
                    this.send({ type: 'RECONNECT', sessionId: this.sessionId });
                }
                else if (this.pendingPayload) {
                    this.send({ type: 'CREATE_SESSION' });
                }
                return;
            case 'AUTH_FAIL':
                this.handlers.onError(message.reason);
                return;
            case 'SESSION_READY':
                this.sessionId = message.sessionId;
                if (this.pendingPayload) {
                    this.send({
                        type: 'LOGIC_CHECK',
                        payload: {
                            ...this.pendingPayload,
                            sessionId: message.sessionId,
                        },
                    });
                }
                return;
            case 'BUFFER_FLUSH':
                for (const token of message.tokens) {
                    this.handlers.onToken(token);
                }
                return;
            case 'STREAM_TOKEN':
                this.handlers.onToken(message.token);
                return;
            case 'STREAM_END':
                this.handlers.onResult(message.result);
                this.pendingPayload = null;
                return;
            case 'STREAM_ERROR':
                this.handlers.onError(message.message);
                this.pendingPayload = null;
                return;
            default:
                return;
        }
    }
    send(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        this.socket.send(JSON.stringify(message));
    }
    scheduleReconnect() {
        if (this.reconnectTimer) {
            return;
        }
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 1200);
    }
    handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && !this.socket && this.sessionId && !this.stopped) {
            this.connect();
        }
    };
}
//# sourceMappingURL=logic-check-stream.js.map