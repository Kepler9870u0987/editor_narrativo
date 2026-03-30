import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
  SecSyncProvider,
  type SecSyncTransport,
} from '../src/secsync-provider.js';
import {
  generateDEK,
  deriveSubKeys,
  generateSigningKeyPair,
} from '@editor-narrativo/crypto';

function createMockTransport(): SecSyncTransport & {
  updateHandlers: Array<(u: any) => void>;
  snapshotHandlers: Array<(s: any) => void>;
  sentUpdates: any[];
  sentSnapshots: any[];
} {
  const t = {
    updateHandlers: [] as Array<(u: any) => void>,
    snapshotHandlers: [] as Array<(s: any) => void>,
    sentUpdates: [] as any[],
    sentSnapshots: [] as any[],
    sendUpdate: vi.fn(async (u: any) => { t.sentUpdates.push(u); }),
    sendSnapshot: vi.fn(async (s: any) => { t.sentSnapshots.push(s); }),
    onRemoteUpdate: (handler: (u: any) => void) => { t.updateHandlers.push(handler); },
    onRemoteSnapshot: (handler: (s: any) => void) => { t.snapshotHandlers.push(handler); },
  };
  return t;
}

async function createTestProvider() {
  const doc = new Y.Doc();
  const dek = await generateDEK();
  const subKeys = await deriveSubKeys(dek);
  const signingKP = await generateSigningKeyPair();
  const transport = createMockTransport();

  const provider = new SecSyncProvider(doc, {
    documentId: 'test-doc-1',
    encryptionKey: subKeys.crdtEncryptionKey,
    signingSecretKey: signingKP.secretKey,
    signingPublicKey: signingKP.publicKey,
    transport,
  });

  return { doc, provider, transport, subKeys, signingKP };
}

describe('SecSyncProvider', () => {
  it('encrypts and sends updates on local doc change', async () => {
    const { doc, transport } = await createTestProvider();

    const text = doc.getText('content');
    text.insert(0, 'Hello');

    // Wait for async encrypt + send
    await new Promise((r) => setTimeout(r, 50));

    expect(transport.sentUpdates.length).toBe(1);
    const update = transport.sentUpdates[0]!;
    expect(update.documentId).toBe('test-doc-1');
    expect(update.encryptedData).toBeInstanceOf(ArrayBuffer);
    expect(update.iv.byteLength).toBe(12);
    expect(update.signature.byteLength).toBe(64);
    expect(update.clock).toBe(1);
  });

  it('creates and verifies snapshots', async () => {
    const { doc, provider, transport } = await createTestProvider();

    const text = doc.getText('content');
    text.insert(0, 'Snapshot test');
    await new Promise((r) => setTimeout(r, 50));

    const snapshot = await provider.createSnapshot();
    expect(snapshot.documentId).toBe('test-doc-1');
    expect(snapshot.snapshotId).toBeTruthy();
    expect(snapshot.encryptedData).toBeInstanceOf(ArrayBuffer);
    expect(snapshot.signature.byteLength).toBe(64);
  });

  it('receives and applies remote updates', async () => {
    // Setup two providers with shared keys (simulating two clients)
    const dek = await generateDEK();
    const subKeys = await deriveSubKeys(dek);
    const kpA = await generateSigningKeyPair();
    const kpB = await generateSigningKeyPair();

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const transportA = createMockTransport();
    const transportB = createMockTransport();

    const providerA = new SecSyncProvider(docA, {
      documentId: 'shared-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpA.secretKey,
      signingPublicKey: kpA.publicKey,
      transport: transportA,
    });

    const providerB = new SecSyncProvider(docB, {
      documentId: 'shared-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpB.secretKey,
      signingPublicKey: kpB.publicKey,
      transport: transportB,
    });

    // Client A makes a change
    docA.getText('content').insert(0, 'From A');
    await new Promise((r) => setTimeout(r, 50));

    // Simulate server relaying to B
    const update = transportA.sentUpdates[0]!;
    await providerB.receiveUpdate(update);

    expect(docB.getText('content').toString()).toBe('From A');
  });

  it('rejects update with invalid signature', async () => {
    // Sender produces an update; a separate receiver tries to apply it with tampered sig
    const dek = await generateDEK();
    const subKeys = await deriveSubKeys(dek);
    const kpSender = await generateSigningKeyPair();
    const kpReceiver = await generateSigningKeyPair();

    const senderDoc = new Y.Doc();
    const receiverDoc = new Y.Doc();
    const senderTransport = createMockTransport();
    const receiverTransport = createMockTransport();

    new SecSyncProvider(senderDoc, {
      documentId: 'test-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpSender.secretKey,
      signingPublicKey: kpSender.publicKey,
      transport: senderTransport,
    });

    const receiver = new SecSyncProvider(receiverDoc, {
      documentId: 'test-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpReceiver.secretKey,
      signingPublicKey: kpReceiver.publicKey,
      transport: receiverTransport,
    });

    senderDoc.getText('content').insert(0, 'test');
    await new Promise((r) => setTimeout(r, 50));

    const update = { ...senderTransport.sentUpdates[0]! };
    // Tamper the signature
    update.signature = new Uint8Array(64);

    await expect(receiver.receiveUpdate(update)).rejects.toThrow('Invalid signature');
  });

  it('rejects out-of-sequence updates', async () => {
    // Sender produces an update; receiver applies it once, then rejects the same clock
    const dek = await generateDEK();
    const subKeys = await deriveSubKeys(dek);
    const kpSender = await generateSigningKeyPair();
    const kpReceiver = await generateSigningKeyPair();

    const senderDoc = new Y.Doc();
    const receiverDoc = new Y.Doc();
    const senderTransport = createMockTransport();
    const receiverTransport = createMockTransport();

    new SecSyncProvider(senderDoc, {
      documentId: 'test-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpSender.secretKey,
      signingPublicKey: kpSender.publicKey,
      transport: senderTransport,
    });

    const receiver = new SecSyncProvider(receiverDoc, {
      documentId: 'test-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpReceiver.secretKey,
      signingPublicKey: kpReceiver.publicKey,
      transport: receiverTransport,
    });

    senderDoc.getText('content').insert(0, 'first');
    await new Promise((r) => setTimeout(r, 50));

    const update = senderTransport.sentUpdates[0]!;
    // Apply it once (valid)
    await receiver.receiveUpdate(update);

    // Trying to apply same clock again → reject
    await expect(receiver.receiveUpdate(update)).rejects.toThrow('Out-of-sequence');
  });
  it('accepts same clock values from different peers', async () => {
    const dek = await generateDEK();
    const subKeys = await deriveSubKeys(dek);
    const kpA = await generateSigningKeyPair();
    const kpB = await generateSigningKeyPair();
    const kpReceiver = await generateSigningKeyPair();

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const receiverDoc = new Y.Doc();
    const transportA = createMockTransport();
    const transportB = createMockTransport();
    const receiverTransport = createMockTransport();

    new SecSyncProvider(docA, {
      documentId: 'shared-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpA.secretKey,
      signingPublicKey: kpA.publicKey,
      transport: transportA,
    });

    new SecSyncProvider(docB, {
      documentId: 'shared-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpB.secretKey,
      signingPublicKey: kpB.publicKey,
      transport: transportB,
    });

    const receiver = new SecSyncProvider(receiverDoc, {
      documentId: 'shared-doc',
      encryptionKey: subKeys.crdtEncryptionKey,
      signingSecretKey: kpReceiver.secretKey,
      signingPublicKey: kpReceiver.publicKey,
      transport: receiverTransport,
    });

    docA.getText('content').insert(0, 'A');
    docB.getText('content').insert(0, 'B');
    await new Promise((r) => setTimeout(r, 50));

    const updateA = transportA.sentUpdates[0]!;
    const updateB = transportB.sentUpdates[0]!;
    expect(updateA.clock).toBe(1);
    expect(updateB.clock).toBe(1);

    await expect(receiver.receiveUpdate(updateA)).resolves.toBeUndefined();
    await expect(receiver.receiveUpdate(updateB)).resolves.toBeUndefined();
  });

  it('rejects updates for a different document id', async () => {
    const { doc, transport, provider } = await createTestProvider();

    doc.getText('content').insert(0, 'wrong-doc');
    await new Promise((r) => setTimeout(r, 50));

    const update = {
      ...transport.sentUpdates[0]!,
      documentId: 'other-doc',
    };

    await expect(provider.receiveUpdate(update)).rejects.toThrow('Document mismatch');
  });
});
