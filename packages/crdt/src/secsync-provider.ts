/**
 * SecSyncProvider — Encrypt-Before-Sync middleware for Yjs.
 *
 * Intercepts Yjs document updates, encrypts them with AES-256-GCM,
 * signs with Ed25519, and passes them to a transport layer.
 * Incoming updates are verified (signature) and decrypted before being applied.
 */

import * as Y from 'yjs';
import { encrypt, decrypt, signPayload, verifySignature } from '@editor-narrativo/crypto';
import type { SecSyncUpdate, SecSyncSnapshot } from '@editor-narrativo/shared';
import { AES_GCM_IV_LENGTH } from '@editor-narrativo/shared';
import { LamportClock } from './lamport-clock.js';

export interface SecSyncTransport {
  /** Send an encrypted, signed update to the server */
  sendUpdate(update: SecSyncUpdate): Promise<void>;
  /** Send an encrypted, signed snapshot to the server */
  sendSnapshot(snapshot: SecSyncSnapshot): Promise<void>;
  /** Register handler for incoming remote updates */
  onRemoteUpdate(handler: (update: SecSyncUpdate) => void): void;
  /** Register handler for loading the latest snapshot */
  onRemoteSnapshot(handler: (snapshot: SecSyncSnapshot) => void): void;
}

export interface SecSyncProviderConfig {
  documentId: string;
  encryptionKey: CryptoKey;
  signingSecretKey: Uint8Array;
  signingPublicKey: Uint8Array;
  transport: SecSyncTransport;
}

export class SecSyncProvider {
  private doc: Y.Doc;
  private config: SecSyncProviderConfig;
  private clock: LamportClock;
  private isApplyingRemote = false;
  private remoteClocks = new Map<string, number>();

  constructor(doc: Y.Doc, config: SecSyncProviderConfig) {
    this.doc = doc;
    this.config = config;
    this.clock = new LamportClock();
    this.setupUpdateListener();
    this.setupRemoteHandlers();
  }

  private setupUpdateListener(): void {
    this.doc.on('update', async (update: Uint8Array, origin: unknown) => {
      // Don't re-encrypt updates that came from remote (avoid infinite loop)
      if (this.isApplyingRemote || origin === this) return;

      try {
        await this.encryptAndSend(update);
      } catch (err) {
        console.error('[SecSync] Failed to encrypt and send update:', err);
      }
    });
  }

  private setupRemoteHandlers(): void {
    this.config.transport.onRemoteUpdate(async (update) => {
      try {
        await this.receiveUpdate(update);
      } catch (err) {
        console.error('[SecSync] Failed to process remote update:', err);
      }
    });

    this.config.transport.onRemoteSnapshot(async (snapshot) => {
      try {
        await this.receiveSnapshot(snapshot);
      } catch (err) {
        console.error('[SecSync] Failed to process remote snapshot:', err);
      }
    });
  }

  /**
   * Encrypt a local Yjs update, sign it, and send it via transport.
   */
  private async encryptAndSend(update: Uint8Array): Promise<void> {
    const clockValue = this.clock.tick();

    // Encrypt with AES-256-GCM
    const { ciphertext, iv } = await encrypt(this.config.encryptionKey, update as Uint8Array<ArrayBuffer>);

    // Build the payload to be signed (includes metadata for tamper protection)
    const signatureInput = this.buildSignatureInput(
      this.config.documentId,
      new Uint8Array(ciphertext),
      iv,
      clockValue,
    );

    const signature = await signPayload(
      this.config.signingSecretKey,
      signatureInput,
    );

    const secUpdate: SecSyncUpdate = {
      documentId: this.config.documentId,
      encryptedData: ciphertext,
      iv,
      signature,
      publicKey: this.config.signingPublicKey,
      clock: clockValue,
    };

    await this.config.transport.sendUpdate(secUpdate);
  }

  /**
   * Verify, decrypt, and apply a remote update.
   */
  async receiveUpdate(update: SecSyncUpdate): Promise<void> {
    if (update.documentId !== this.config.documentId) {
      throw new Error(
        `[SecSync] Document mismatch: got ${update.documentId}, expected ${this.config.documentId}`,
      );
    }

    const signerId = this.getSignerId(update.publicKey);
    const lastSeenClock = this.remoteClocks.get(signerId) ?? 0;
    if (update.clock <= lastSeenClock) {
      throw new Error(
        `[SecSync] Out-of-sequence update: got clock ${update.clock}, expected > ${lastSeenClock}`,
      );
    }

    // Verify Ed25519 signature
    const signatureInput = this.buildSignatureInput(
      update.documentId,
      new Uint8Array(update.encryptedData),
      update.iv,
      update.clock,
    );

    const isValid = await verifySignature(
      update.publicKey,
      signatureInput,
      update.signature,
    );

    if (!isValid) {
      throw new Error('[SecSync] Invalid signature on incoming update');
    }

    // Decrypt
    const plainUpdate = await decrypt(
      this.config.encryptionKey,
      update.encryptedData,
      update.iv,
    );

    // Apply to Y.Doc
    this.isApplyingRemote = true;
    try {
      Y.applyUpdate(this.doc, new Uint8Array(plainUpdate), this);
      this.remoteClocks.set(signerId, update.clock);
      this.clock.merge(update.clock);
    } finally {
      this.isApplyingRemote = false;
    }
  }

  /**
   * Create and send an encrypted snapshot of the current document state.
   */
  async createSnapshot(): Promise<SecSyncSnapshot> {
    const stateUpdate = Y.encodeStateAsUpdate(this.doc);
    const clockValue = this.clock.tick();

    const { ciphertext, iv } = await encrypt(
      this.config.encryptionKey,
      stateUpdate as Uint8Array<ArrayBuffer>,
    );

    const snapshotId = crypto.randomUUID();

    const signatureInput = this.buildSignatureInput(
      this.config.documentId,
      new Uint8Array(ciphertext),
      iv,
      clockValue,
    );

    const signature = await signPayload(
      this.config.signingSecretKey,
      signatureInput,
    );

    const snapshot: SecSyncSnapshot = {
      documentId: this.config.documentId,
      snapshotId,
      encryptedData: ciphertext,
      iv,
      signature,
      publicKey: this.config.signingPublicKey,
      clock: clockValue,
    };

    await this.config.transport.sendSnapshot(snapshot);
    return snapshot;
  }

  /**
   * Load and apply a remote snapshot.
   */
  async receiveSnapshot(snapshot: SecSyncSnapshot): Promise<void> {
    if (snapshot.documentId !== this.config.documentId) {
      throw new Error(
        `[SecSync] Document mismatch: got ${snapshot.documentId}, expected ${this.config.documentId}`,
      );
    }

    const signatureInput = this.buildSignatureInput(
      snapshot.documentId,
      new Uint8Array(snapshot.encryptedData),
      snapshot.iv,
      snapshot.clock,
    );

    const isValid = await verifySignature(
      snapshot.publicKey,
      signatureInput,
      snapshot.signature,
    );

    if (!isValid) {
      throw new Error('[SecSync] Invalid signature on incoming snapshot');
    }

    const plainState = await decrypt(
      this.config.encryptionKey,
      snapshot.encryptedData,
      snapshot.iv,
    );

    this.isApplyingRemote = true;
    try {
      Y.applyUpdate(this.doc, new Uint8Array(plainState), this);
      this.remoteClocks.set(this.getSignerId(snapshot.publicKey), snapshot.clock);
      this.clock.merge(snapshot.clock);
    } finally {
      this.isApplyingRemote = false;
    }
  }

  /**
   * Build the byte buffer that gets signed.
   * Includes metadata (documentId, clock) so those fields are tamper-proof
   * even though they travel in cleartext.
   */
  private buildSignatureInput(
    documentId: string,
    ciphertext: Uint8Array,
    iv: Uint8Array,
    clock: number,
  ): Uint8Array {
    const encoder = new TextEncoder();
    const docIdBytes = encoder.encode(documentId);
    const clockBytes = new Uint8Array(8);
    new DataView(clockBytes.buffer).setBigUint64(0, BigInt(clock), false);

    const total =
      docIdBytes.byteLength +
      iv.byteLength +
      ciphertext.byteLength +
      clockBytes.byteLength;

    const buf = new Uint8Array(total);
    let offset = 0;

    buf.set(docIdBytes, offset);
    offset += docIdBytes.byteLength;

    buf.set(iv, offset);
    offset += iv.byteLength;

    buf.set(ciphertext, offset);
    offset += ciphertext.byteLength;

    buf.set(clockBytes, offset);

    return buf;
  }

  private getSignerId(publicKey: Uint8Array): string {
    return Array.from(publicKey)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  get currentClock(): number {
    return this.clock.value;
  }
}
