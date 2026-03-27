/** 12 bytes — AES-GCM IV length */
export const AES_GCM_IV_LENGTH = 12;

/** 16 bytes — AES-GCM Auth Tag length */
export const AES_GCM_TAG_LENGTH = 16;

/** 32 bytes — 256-bit key */
export const KEY_LENGTH_BYTES = 32;

/** Argon2id memory limit: 46 MiB (OWASP recommendation) */
export const ARGON2_MEMORY_LIMIT = 46 * 1024 * 1024;

/** Argon2id ops limit */
export const ARGON2_OPS_LIMIT = 1;

/** Argon2id parallelism (WASM browser limit) */
export const ARGON2_PARALLELISM = 1;

/** HKDF info strings for sub-key derivation */
export const HKDF_INFO = {
  TEXT_ENCRYPTION: 'text-encryption',
  VECTOR_ENCRYPTION: 'vector-encryption',
  CRDT_ENCRYPTION: 'crdt-encryption',
} as const;

/** Default HNSW parameters */
export const HNSW_DEFAULTS = {
  SPACE: 'cosine' as const,
  DIM: 768,
  MAX_ELEMENTS: 100_000,
  M: 16,
  EF_CONSTRUCTION: 200,
};

/** WebSocket session buffer TTL: 5 minutes */
export const WS_SESSION_TTL_MS = 5 * 60 * 1000;

/** WebSocket heartbeat interval: 30 seconds */
export const WS_HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** Crypto worker timeout: 30 seconds */
export const CRYPTO_WORKER_TIMEOUT_MS = 30 * 1000;

/** IndexedDB persist debounce: 30 seconds */
export const IDBFS_PERSIST_DEBOUNCE_MS = 30 * 1000;
