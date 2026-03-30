import type { LogicCheckRequest, LogicCheckResponse } from '@editor-narrativo/shared';
export interface LogicCheckStreamHandlers {
    onToken(token: string): void;
    onResult(result: LogicCheckResponse): void;
    onError(message: string): void;
}
export declare class LogicCheckStreamClient {
    private readonly accessToken;
    private readonly handlers;
    private socket;
    private authenticated;
    private sessionId;
    private pendingPayload;
    private reconnectTimer;
    private stopped;
    constructor(accessToken: string, handlers: LogicCheckStreamHandlers);
    run(payload: LogicCheckRequest): void;
    close(): void;
    private connect;
    private handleMessage;
    private send;
    private scheduleReconnect;
    private handleVisibilityChange;
}
//# sourceMappingURL=logic-check-stream.d.ts.map