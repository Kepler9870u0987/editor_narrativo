/**
 * JWT Authentication utilities.
 * Verifies JWT tokens using HMAC-SHA256 (jose library, no file I/O).
 */

import * as jose from 'jose';

export interface JWTConfig {
  /** HMAC secret for JWT verification (must be at least 32 bytes in production) */
  secret: string;
  /** Expected issuer */
  issuer?: string;
  /** Expected audience */
  audience?: string;
}

export interface JWTPayload {
  sub: string;
  [key: string]: unknown;
}

let encodedSecret: Uint8Array | null = null;
let config: JWTConfig | null = null;

/**
 * Initialize JWT verification with the given config.
 * Must be called before verifyToken.
 */
export function initJWT(cfg: JWTConfig): void {
  config = cfg;
  encodedSecret = new TextEncoder().encode(cfg.secret);
}

/**
 * Verify a JWT token and return the payload.
 * Throws on invalid/expired tokens.
 */
export async function verifyToken(token: string): Promise<JWTPayload> {
  if (!encodedSecret || !config) {
    throw new Error('JWT not initialized. Call initJWT() first.');
  }

  const { payload } = await jose.jwtVerify(token, encodedSecret, {
    issuer: config.issuer,
    audience: config.audience,
  });

  if (!payload.sub) {
    throw new Error('JWT missing required "sub" claim');
  }

  return payload as JWTPayload;
}

/**
 * Create a signed JWT token (for testing / bootstrapping).
 */
export async function createToken(
  payload: JWTPayload,
  expiresIn = '1h',
): Promise<string> {
  if (!encodedSecret || !config) {
    throw new Error('JWT not initialized. Call initJWT() first.');
  }

  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setIssuer(config.issuer ?? 'editor-narrativo')
    .setAudience(config.audience ?? 'editor-narrativo')
    .sign(encodedSecret);
}
