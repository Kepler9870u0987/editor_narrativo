/**
 * LLM Config Store — Encrypted persistence of LLM configuration in IndexedDB.
 *
 * The API key and other config are encrypted with AES-GCM using a sub-key
 * derived from the user's DEK. NEVER stored in plaintext (zero-knowledge).
 */

import { encrypt, decrypt, serializePayload, deserializePayload } from '@editor-narrativo/crypto';
import { editorDb } from './storage';
import type { LLMConfig } from './llm-client';

/**
 * Encrypt and persist the LLM configuration.
 */
export async function saveLLMConfig(
  config: LLMConfig,
  encryptionKey: CryptoKey,
): Promise<void> {
  const plaintext = new TextEncoder().encode(JSON.stringify(config));
  const encrypted = await encrypt(encryptionKey, plaintext);
  const blob = serializePayload(encrypted);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(blob)));

  await editorDb.llmConfig.put({
    id: 'default',
    encryptedBlob: base64,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Load and decrypt the LLM configuration. Returns null if not configured.
 */
export async function loadLLMConfig(
  encryptionKey: CryptoKey,
): Promise<LLMConfig | null> {
  const record = await editorDb.llmConfig.get('default');
  if (!record) return null;

  const raw = Uint8Array.from(atob(record.encryptedBlob), (c) => c.charCodeAt(0));
  const payload = deserializePayload(raw);
  const plaintext = await decrypt(encryptionKey, payload.ciphertext, payload.iv);
  return JSON.parse(new TextDecoder().decode(plaintext)) as LLMConfig;
}

/**
 * Delete the stored LLM configuration.
 */
export async function clearLLMConfig(): Promise<void> {
  await editorDb.llmConfig.delete('default');
}
