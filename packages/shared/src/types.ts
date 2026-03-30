// ─── Crypto Types ───────────────────────────────────────────────

export interface EncryptedPayload {
  /** Ciphertext (AES-256-GCM output) */
  ciphertext: ArrayBuffer;
  /** 12-byte Initialization Vector — must be unique per encrypt call */
  iv: Uint8Array;
}

export interface SerializedEncryptedPayload {
  /** Base64-encoded IV || Ciphertext */
  data: string;
}

export interface WrappedKey {
  /** AES-KW wrapped DEK */
  wrappedDek: ArrayBuffer;
  /** Salt used for Argon2id KEK derivation */
  salt: Uint8Array;
}

export interface DerivedSubKeys {
  textEncryptionKey: CryptoKey;
  vectorEncryptionKey: CryptoKey;
  crdtEncryptionKey: CryptoKey;
}

export interface SigningKeyPair {
  publicKey: Uint8Array;
  /** Private key — must be wrapped with KEK before persistence */
  secretKey: Uint8Array;
}

// ─── Crypto Worker Messages ────────────────────────────────────

export type CryptoWorkerRequest =
  | { requestId: number; type: 'DERIVE_KEK'; password: string; salt: Uint8Array }
  | { requestId: number; type: 'GENERATE_SIGNING_KEYPAIR' };

export type CryptoWorkerResponse =
  | { requestId: number; type: 'KEK_DERIVED'; kek: ArrayBuffer }
  | { requestId: number; type: 'SIGNING_KEYPAIR_GENERATED'; publicKey: Uint8Array; secretKey: Uint8Array }
  | { requestId: number; type: 'ERROR'; message: string };

// ─── CRDT / SecSync Types ──────────────────────────────────────

export interface SecSyncUpdate {
  documentId: string;
  encryptedData: ArrayBuffer;
  iv: Uint8Array;
  signature: Uint8Array;
  publicKey: Uint8Array;
  clock: number;
}

export interface SecSyncSnapshot {
  documentId: string;
  snapshotId: string;
  encryptedData: ArrayBuffer;
  iv: Uint8Array;
  signature: Uint8Array;
  publicKey: Uint8Array;
  clock: number;
}

// ─── RAG / Worker Pool Types ───────────────────────────────────

export type RAGWorkerRequest =
  | { type: 'EMBED_TEXT'; texts: string[] }
  | { type: 'SEARCH_SIMILAR'; vector: Float32Array; k: number }
  | { type: 'ADD_VECTOR'; id: number; vector: Float32Array }
  | { type: 'INIT_INDEX'; config: HNSWConfig }
  | { type: 'PERSIST_INDEX' }
  | { type: 'LOAD_INDEX' };

export type RAGWorkerResponse =
  | { type: 'EMBED_RESULT'; vectors: Float32Array[] }
  | { type: 'SEARCH_RESULT'; ids: number[]; distances: number[] }
  | { type: 'VECTOR_ADDED'; id: number }
  | { type: 'INDEX_READY' }
  | { type: 'INDEX_PERSISTED' }
  | { type: 'INDEX_LOADED' }
  | { type: 'ERROR'; message: string };

export interface HNSWConfig {
  space: 'cosine' | 'l2' | 'ip';
  dim: number;
  maxElements: number;
  M: number;
  efConstruction: number;
}

// ─── Entity Types ──────────────────────────────────────────────

export interface NarrativeEntity {
  id: string;
  name: string;
  type: 'character' | 'place' | 'item';
  metadata?: Record<string, unknown>;
}

// ─── LLM Proxy Types ──────────────────────────────────────────

export interface LogicCheckRequest {
  /** The current scene text to analyze */
  sceneText: string;
  /** RAG context passages from the Story Bible */
  ragContext: string[];
  /** Session ID for WebSocket reconnection */
  sessionId?: string;
}

export interface WSLogicCheckRequest extends LogicCheckRequest {
  sessionId: string;
}

export interface LogicCheckResponse {
  hasConflict: boolean;
  conflicts: LogicConflict[];
  evidence_chains: EvidenceChain[];
}

export interface LogicConflict {
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface EvidenceChain {
  sceneStatement: string;
  bibleExcerpt: string;
  contradiction: string;
}

// ─── PII Masking ───────────────────────────────────────────────

export interface PIIMask {
  token: string;
  original: string;
}

// ─── WebSocket Protocol ────────────────────────────────────────

export type WSClientMessage =
  | { type: 'AUTH'; token: string }
  | { type: 'CREATE_SESSION' }
  | { type: 'LOGIC_CHECK'; payload: WSLogicCheckRequest }
  | { type: 'RECONNECT'; sessionId: string };

export type WSServerMessage =
  | { type: 'AUTH_OK' }
  | { type: 'AUTH_FAIL'; reason: string }
  | { type: 'SESSION_READY'; sessionId: string }
  | { type: 'STREAM_TOKEN'; token: string; sessionId: string }
  | { type: 'STREAM_END'; sessionId: string; result: LogicCheckResponse }
  | { type: 'STREAM_ERROR'; sessionId: string; message: string }
  | { type: 'BUFFER_FLUSH'; tokens: string[]; sessionId: string };
