import { describe, it, expect } from 'vitest';
import {
  AES_GCM_IV_LENGTH,
  KEY_LENGTH_BYTES,
  ARGON2_MEMORY_LIMIT,
  HKDF_INFO,
  HNSW_DEFAULTS,
  WS_SESSION_TTL_MS,
} from '../src/index.js';

describe('shared/constants', () => {
  it('AES-GCM IV is 12 bytes', () => {
    expect(AES_GCM_IV_LENGTH).toBe(12);
  });

  it('Key length is 32 bytes (256 bit)', () => {
    expect(KEY_LENGTH_BYTES).toBe(32);
  });

  it('Argon2 memory limit is 46 MiB', () => {
    expect(ARGON2_MEMORY_LIMIT).toBe(46 * 1024 * 1024);
  });

  it('HKDF info strings are distinct', () => {
    const values = Object.values(HKDF_INFO);
    expect(new Set(values).size).toBe(values.length);
  });

  it('HNSW defaults have correct space', () => {
    expect(HNSW_DEFAULTS.SPACE).toBe('cosine');
    expect(HNSW_DEFAULTS.M).toBeGreaterThanOrEqual(12);
    expect(HNSW_DEFAULTS.M).toBeLessThanOrEqual(48);
  });

  it('WS session TTL is 5 minutes', () => {
    expect(WS_SESSION_TTL_MS).toBe(300_000);
  });
});
