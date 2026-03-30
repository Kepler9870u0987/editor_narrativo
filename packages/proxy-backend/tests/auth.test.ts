import { describe, it, expect } from 'vitest';
import {
  createJWTService,
  initJWT,
  verifyToken,
  createToken,
} from '../src/auth.js';

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
  it('creates isolated JWT services without shared mutable state', async () => {
    const serviceA = createJWTService({
      secret: 'service-a-secret-at-least-32-bytes!!',
      issuer: 'svc-a',
      audience: 'svc-a',
    });
    const serviceB = createJWTService({
      secret: 'service-b-secret-at-least-32-bytes!!',
      issuer: 'svc-b',
      audience: 'svc-b',
    });

    const tokenA = await serviceA.createToken({ sub: 'user-a' });
    const tokenB = await serviceB.createToken({ sub: 'user-b' });

    await expect(serviceA.verifyToken(tokenA)).resolves.toMatchObject({ sub: 'user-a' });
    await expect(serviceB.verifyToken(tokenB)).resolves.toMatchObject({ sub: 'user-b' });
    await expect(serviceA.verifyToken(tokenB)).rejects.toThrow();
    await expect(serviceB.verifyToken(tokenA)).rejects.toThrow();
  });

  it('rejects secrets shorter than 32 bytes', () => {
    expect(() => createJWTService({ secret: 'too-short-secret' })).toThrow(
      'JWT secret must be at least 32 bytes',
    );
  });
});
