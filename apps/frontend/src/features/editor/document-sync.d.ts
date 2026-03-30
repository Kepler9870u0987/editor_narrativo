import * as Y from 'yjs';
import { SecSyncProvider, type SecSyncTransport } from '@editor-narrativo/crdt';
import type { SecSyncSnapshot, SecSyncUpdate } from '@editor-narrativo/shared';
export type DocumentSyncState = 'idle' | 'syncing' | 'offline' | 'resync_required';
declare class DocumentsSocketTransport implements SecSyncTransport {
    private readonly documentId;
    private readonly accessToken;
    private readonly getAfterClock;
    private readonly onSyncState;
    private readonly onClockAcknowledged;
    private socket;
    private stopped;
    private authenticated;
    private reconnectTimer;
    private remoteUpdateHandler;
    private remoteSnapshotHandler;
    constructor(documentId: string, accessToken: string, getAfterClock: () => number, onSyncState: (state: DocumentSyncState) => void, onClockAcknowledged: (clock: number) => Promise<void>);
    sendUpdate(update: SecSyncUpdate): Promise<void>;
    sendSnapshot(snapshot: SecSyncSnapshot): Promise<void>;
    onRemoteUpdate(handler: (update: SecSyncUpdate) => void): void;
    onRemoteSnapshot(handler: (snapshot: SecSyncSnapshot) => void): void;
    connect(): void;
    close(): void;
    private handleMessage;
    private flushPending;
    private sendJSON;
    private scheduleReconnect;
    private handleVisibilityChange;
}
export interface DocumentSyncEngineOptions {
    documentId: string;
    accessToken: string;
    encryptionKey: CryptoKey;
    signingSecretKey: Uint8Array;
    signingPublicKey: Uint8Array;
    initialSerializedContent: string;
    localClock: number;
    onSyncState: (state: DocumentSyncState) => void;
    onClockAcknowledged: (clock: number) => Promise<void>;
}
export declare class DocumentSyncEngine {
    private readonly options;
    readonly doc: Y.Doc;
    readonly text: Y.Text;
    readonly provider: SecSyncProvider;
    readonly transport: DocumentsSocketTransport;
    constructor(options: DocumentSyncEngineOptions);
    start(): Promise<void>;
    observeSerializedContent(handler: (serialized: string) => void): () => void;
    replaceSerializedContent(serialized: string): void;
    createSnapshot(): Promise<void>;
    close(): void;
}
export {};
//# sourceMappingURL=document-sync.d.ts.map