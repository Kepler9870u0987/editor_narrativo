import * as Y from 'yjs';
import { SecSyncProvider, type SecSyncTransport } from '@editor-narrativo/crdt';
import type {
  DocumentWSServerMessage,
  EncryptedDocumentSnapshot,
  EncryptedDocumentUpdate,
} from '@editor-narrativo/documents-shared';
import type { SecSyncSnapshot, SecSyncUpdate } from '@editor-narrativo/shared';
import { appEnv } from '../../lib/env';
import { editorDb } from '../../lib/storage';
import { toWebSocketUrl } from '../../lib/ws-url';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  base64ToBytes,
  bytesToBase64,
} from '../../lib/base64';
import { documentsApi } from './documents-api';

export type DocumentSyncState = 'idle' | 'syncing' | 'offline' | 'resync_required';

function toEncryptedUpdate(update: SecSyncUpdate): EncryptedDocumentUpdate {
  return {
    documentId: update.documentId,
    updateId: crypto.randomUUID(),
    encryptedData: arrayBufferToBase64(update.encryptedData),
    iv: bytesToBase64(update.iv),
    signature: bytesToBase64(update.signature),
    publicKey: bytesToBase64(update.publicKey),
    clock: update.clock,
    createdAt: new Date().toISOString(),
  };
}

function toEncryptedSnapshot(snapshot: SecSyncSnapshot): EncryptedDocumentSnapshot {
  return {
    documentId: snapshot.documentId,
    snapshotId: snapshot.snapshotId,
    encryptedData: arrayBufferToBase64(snapshot.encryptedData),
    iv: bytesToBase64(snapshot.iv),
    signature: bytesToBase64(snapshot.signature),
    publicKey: bytesToBase64(snapshot.publicKey),
    clock: snapshot.clock,
    createdAt: new Date().toISOString(),
  };
}

function toSecSyncUpdate(update: EncryptedDocumentUpdate): SecSyncUpdate {
  return {
    documentId: update.documentId,
    encryptedData: base64ToArrayBuffer(update.encryptedData),
    iv: base64ToBytes(update.iv),
    signature: base64ToBytes(update.signature),
    publicKey: base64ToBytes(update.publicKey),
    clock: update.clock,
  };
}

function toSecSyncSnapshot(snapshot: EncryptedDocumentSnapshot): SecSyncSnapshot {
  return {
    documentId: snapshot.documentId,
    snapshotId: snapshot.snapshotId,
    encryptedData: base64ToArrayBuffer(snapshot.encryptedData),
    iv: base64ToBytes(snapshot.iv),
    signature: base64ToBytes(snapshot.signature),
    publicKey: base64ToBytes(snapshot.publicKey),
    clock: snapshot.clock,
  };
}

class DocumentsSocketTransport implements SecSyncTransport {
  private socket: WebSocket | null = null;
  private stopped = false;
  private authenticated = false;
  private reconnectTimer: number | null = null;
  private remoteUpdateHandler: ((update: SecSyncUpdate) => void) | null = null;
  private remoteSnapshotHandler: ((snapshot: SecSyncSnapshot) => void) | null = null;

  constructor(
    private readonly documentId: string,
    private readonly accessToken: string,
    private readonly getAfterClock: () => number,
    private readonly onSyncState: (state: DocumentSyncState) => void,
    private readonly onClockAcknowledged: (clock: number) => Promise<void>,
  ) {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  async sendUpdate(update: SecSyncUpdate): Promise<void> {
    const payload = toEncryptedUpdate(update);
    await editorDb.pendingUpdates.put({
      updateId: payload.updateId,
      documentId: payload.documentId,
      payload: JSON.stringify(payload),
      clock: payload.clock,
      createdAt: payload.createdAt,
    });
    this.onSyncState(this.socket && this.authenticated ? 'syncing' : 'offline');
    this.sendJSON({ type: 'PUSH_UPDATE', update: payload });
  }

  async sendSnapshot(snapshot: SecSyncSnapshot): Promise<void> {
    const payload = toEncryptedSnapshot(snapshot);
    await documentsApi.putSnapshot(this.accessToken, this.documentId, payload);
    await this.onClockAcknowledged(payload.clock);
  }

  onRemoteUpdate(handler: (update: SecSyncUpdate) => void): void {
    this.remoteUpdateHandler = handler;
  }

  onRemoteSnapshot(handler: (snapshot: SecSyncSnapshot) => void): void {
    this.remoteSnapshotHandler = handler;
  }

  connect(): void {
    if (this.stopped || this.socket) {
      return;
    }

    this.onSyncState('syncing');
    this.socket = new WebSocket(toWebSocketUrl(`${appEnv.documentsBasePath}/ws/documents`));
    this.socket.addEventListener('open', () => {
      this.sendJSON({ type: 'AUTH', token: this.accessToken });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as DocumentWSServerMessage;
      void this.handleMessage(message);
    });
    this.socket.addEventListener('close', () => {
      this.socket = null;
      this.authenticated = false;
      if (!this.stopped) {
        this.onSyncState('offline');
        this.scheduleReconnect();
      }
    });
    this.socket.addEventListener('error', () => {
      this.onSyncState('offline');
    });
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
    this.authenticated = false;
  }

  private async handleMessage(message: DocumentWSServerMessage): Promise<void> {
    switch (message.type) {
      case 'AUTH_OK':
        this.authenticated = true;
        this.sendJSON({ type: 'SUBSCRIBE_DOCUMENT', documentId: this.documentId });
        this.sendJSON({
          type: 'REQUEST_MISSING_UPDATES',
          documentId: this.documentId,
          afterClock: this.getAfterClock(),
        });
        await this.flushPending();
        this.onSyncState('idle');
        return;
      case 'SNAPSHOT':
        if (message.snapshot) {
          this.remoteSnapshotHandler?.(toSecSyncSnapshot(message.snapshot));
        }
        return;
      case 'MISSING_UPDATES':
        for (const update of message.updates) {
          this.remoteUpdateHandler?.(toSecSyncUpdate(update));
          await this.onClockAcknowledged(update.clock);
        }
        this.onSyncState('idle');
        return;
      case 'REMOTE_UPDATE':
        this.remoteUpdateHandler?.(toSecSyncUpdate(message.update));
        await this.onClockAcknowledged(message.update.clock);
        return;
      case 'UPDATE_ACK':
        await editorDb.pendingUpdates.delete(message.updateId);
        await this.onClockAcknowledged(message.clock);
        this.onSyncState('idle');
        return;
      case 'RESYNC_REQUIRED':
        this.onSyncState('resync_required');
        return;
      case 'ERROR':
        if (message.documentId === this.documentId) {
          this.onSyncState('offline');
        }
        return;
      default:
        return;
    }
  }

  private async flushPending(): Promise<void> {
    const pending = await editorDb.pendingUpdates
      .where('documentId')
      .equals(this.documentId)
      .sortBy('clock');

    for (const entry of pending) {
      const payload = JSON.parse(entry.payload) as EncryptedDocumentUpdate;
      this.sendJSON({ type: 'PUSH_UPDATE', update: payload });
    }
  }

  private sendJSON(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !this.socket && !this.stopped) {
      this.connect();
    }
  };
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

export class DocumentSyncEngine {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText('blocknote-json');
  readonly provider: SecSyncProvider;
  readonly transport: DocumentsSocketTransport;

  constructor(private readonly options: DocumentSyncEngineOptions) {
    if (options.initialSerializedContent) {
      this.text.insert(0, options.initialSerializedContent);
    }

    this.transport = new DocumentsSocketTransport(
      options.documentId,
      options.accessToken,
      () => this.provider.currentClock,
      options.onSyncState,
      options.onClockAcknowledged,
    );
    this.provider = new SecSyncProvider(this.doc, {
      documentId: options.documentId,
      encryptionKey: options.encryptionKey,
      signingSecretKey: options.signingSecretKey,
      signingPublicKey: options.signingPublicKey,
      transport: this.transport,
    });
  }

  async start(): Promise<void> {
    try {
      const remoteSnapshot = await documentsApi
        .getSnapshot(this.options.accessToken, this.options.documentId)
        .catch((error) => (error instanceof Error ? null : null));

      if (remoteSnapshot && remoteSnapshot.clock >= this.options.localClock) {
        await this.provider.receiveSnapshot(toSecSyncSnapshot(remoteSnapshot));
      } else if (this.text.length > 0) {
        await this.provider.createSnapshot();
      }

      const afterClock = this.provider.currentClock;
      const remoteUpdates = await documentsApi
        .getUpdates(this.options.accessToken, this.options.documentId, afterClock)
        .catch(() => null);
      if (remoteUpdates) {
        for (const update of remoteUpdates.updates) {
          await this.provider.receiveUpdate(toSecSyncUpdate(update));
        }
      }
    } finally {
      this.transport.connect();
    }
  }

  observeSerializedContent(handler: (serialized: string) => void): () => void {
    const observer = () => handler(this.text.toString());
    this.text.observe(observer);
    return () => this.text.unobserve(observer);
  }

  replaceSerializedContent(serialized: string): void {
    const current = this.text.toString();
    if (current === serialized) {
      return;
    }
    this.doc.transact(() => {
      if (this.text.length > 0) {
        this.text.delete(0, this.text.length);
      }
      if (serialized) {
        this.text.insert(0, serialized);
      }
    }, 'editor');
  }

  async createSnapshot(): Promise<void> {
    await this.provider.createSnapshot();
  }

  close(): void {
    this.transport.close();
    this.doc.destroy();
  }
}
