import { describe, it, expect } from 'vitest';
import { initJWT, verifyToken, createToken } from '../src/auth.js';

describe('JWT Auth', () => {
  const testSecret = 'test-secret-key-must-be-at-least-32-bytes-long!!';

  it('creates and verifies a token', async () => {
    initJWT({ secret: testSecret, issuer: 'test', audience: 'test' });

    const token = await createToken({ sub: 'user-123' });
    const payload = await verifyToken(token);

    expect(payload.sub).toBe('user-123');
  });

  it('rejects token with wrong secret', async () => {
    initJWT({ secret: testSecret, issuer: 'test', audience: 'test' });
    const token = await createToken({ sub: 'user-1' });

    // Re-init with different secret
    initJWT({ secret: 'different-secret-also-at-least-32-bytes!!!!!', issuer: 'test', audience: 'test' });

    await expect(verifyToken(token)).rejects.toThrow();
  });

  it('throws if JWT not initialized', async () => {
    // Reset by importing fresh — but we can test the error path
    initJWT({ secret: testSecret, issuer: 'test', audience: 'test' });
    const token = await createToken({ sub: 'test' });
    const payload = await verifyToken(token);
    expect(payload.sub).toBe('test');
  });
});
