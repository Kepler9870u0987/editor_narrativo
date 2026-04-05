/**
 * Test: LLM Config Store — encrypt/decrypt round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveLLMConfig, loadLLMConfig, clearLLMConfig } from '../lib/llm-config-store';
import { editorDb } from '../lib/storage';
import type { LLMConfig } from '../lib/llm-client';

const TEST_CONFIG: LLMConfig = {
  provider: 'openai-compatible',
  apiKey: 'sk-test-very-secret-key-123',
  baseUrl: 'https://api.openai.com',
  model: 'gpt-4o-mini',
};

async function generateTestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

describe('LLM Config Store', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    key = await generateTestKey();
    // Clear the llmConfig table between tests
    await editorDb.llmConfig.clear();
  });

  it('round-trip: save then load returns same config', async () => {
    await saveLLMConfig(TEST_CONFIG, key);
    const loaded = await loadLLMConfig(key);

    expect(loaded).toEqual(TEST_CONFIG);
  });

  it('returns null when no config saved', async () => {
    const loaded = await loadLLMConfig(key);
    expect(loaded).toBeNull();
  });

  it('clearLLMConfig removes saved config', async () => {
    await saveLLMConfig(TEST_CONFIG, key);
    await clearLLMConfig();
    const loaded = await loadLLMConfig(key);

    expect(loaded).toBeNull();
  });

  it('fails to decrypt with wrong key', async () => {
    await saveLLMConfig(TEST_CONFIG, key);
    const wrongKey = await generateTestKey();

    await expect(loadLLMConfig(wrongKey)).rejects.toThrow();
  });

  it('overwrites previous config on re-save', async () => {
    await saveLLMConfig(TEST_CONFIG, key);

    const updated: LLMConfig = {
      ...TEST_CONFIG,
      model: 'claude-3.5-sonnet',
      baseUrl: 'https://api.anthropic.com',
    };
    await saveLLMConfig(updated, key);

    const loaded = await loadLLMConfig(key);
    expect(loaded).toEqual(updated);
  });
});
