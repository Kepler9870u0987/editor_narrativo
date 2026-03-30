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

export interface JWTService {
  verifyToken(token: string): Promise<JWTPayload>;
  createToken(payload: JWTPayload, expiresIn?: string): Promise<string>;
}

const MIN_SECRET_BYTES = 32;

let defaultService: JWTService | null = null;

function assertValidConfig(cfg: JWTConfig): Uint8Array {
  const encodedSecret = new TextEncoder().encode(cfg.secret);
  if (encodedSecret.byteLength < MIN_SECRET_BYTES) {
    throw new Error(
      `JWT secret must be at least ${MIN_SECRET_BYTES} bytes`,
    );
  }

  return encodedSecret;
}

export function createJWTService(cfg: JWTConfig): JWTService {
  const encodedSecret = assertValidConfig(cfg);

  return {
    async verifyToken(token: string): Promise<JWTPayload> {
      const { payload } = await jose.jwtVerify(token, encodedSecret, {
        issuer: cfg.issuer,
        audience: cfg.audience,
      });

      if (!payload.sub) {
        throw new Error('JWT missing required "sub" claim');
      }

      return payload as JWTPayload;
    },

    async createToken(
      payload: JWTPayload,
      expiresIn = '1h',
    ): Promise<string> {
      return new jose.SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .setIssuer(cfg.issuer ?? 'editor-narrativo')
        .setAudience(cfg.audience ?? 'editor-narrativo')
        .sign(encodedSecret);
    },
  };
}

/**
 * Initialize JWT verification with the given config.
 * Must be called before verifyToken.
 */
export function initJWT(cfg: JWTConfig): void {
  defaultService = createJWTService(cfg);
}

/**
 * Verify a JWT token and return the payload.
 * Throws on invalid/expired tokens.
 */
export async function verifyToken(token: string): Promise<JWTPayload> {
  if (!defaultService) {
    throw new Error('JWT not initialized. Call initJWT() first.');
  }

  return defaultService.verifyToken(token);
}

/**
 * Create a signed JWT token (for testing / bootstrapping).
 */
export async function createToken(
  payload: JWTPayload,
  expiresIn = '1h',
): Promise<string> {
  if (!defaultService) {
    throw new Error('JWT not initialized. Call initJWT() first.');
  }

  return defaultService.createToken(payload, expiresIn);
}
