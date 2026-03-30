import type {
  LogicCheckRequest,
  LogicCheckResponse,
  WSClientMessage,
  WSServerMessage,
} from '@editor-narrativo/shared';
import { appEnv } from '../../lib/env';
import { toWebSocketUrl } from '../../lib/ws-url';

export interface LogicCheckStreamHandlers {
  onToken(token: string): void;
  onResult(result: LogicCheckResponse): void;
  onError(message: string): void;
}

export class LogicCheckStreamClient {
  private socket: WebSocket | null = null;
  private authenticated = false;
  private sessionId: string | null = null;
  private pendingPayload: LogicCheckRequest | null = null;
  private reconnectTimer: number | null = null;
  private stopped = false;

  constructor(
    private readonly accessToken: string,
    private readonly handlers: LogicCheckStreamHandlers,
  ) {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  run(payload: LogicCheckRequest): void {
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

  close(): void {
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.socket || this.stopped) {
      return;
    }

    this.socket = new WebSocket(toWebSocketUrl(`${appEnv.proxyBasePath}/ws`));
    this.socket.addEventListener('open', () => {
      this.send({ type: 'AUTH', token: this.accessToken });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as WSServerMessage;
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

  private handleMessage(message: WSServerMessage): void {
    switch (message.type) {
      case 'AUTH_OK':
        this.authenticated = true;
        if (this.sessionId) {
          this.send({ type: 'RECONNECT', sessionId: this.sessionId });
        } else if (this.pendingPayload) {
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

  private send(message: WSClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1200);
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !this.socket && this.sessionId && !this.stopped) {
      this.connect();
    }
  };
}
