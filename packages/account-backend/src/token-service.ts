import * as jose from 'jose';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  email?: string;
  scope?: string[];
}

export interface AccessTokenPayload extends jose.JWTPayload {
  sub: string;
  sid: string;
  email?: string;
  scope?: string[];
}

export interface AccessTokenServiceConfig {
  issuer: string;
  audience: string;
  accessTokenTtlSeconds?: number;
  privateJwk?: JsonWebKey;
  publicJwk?: JsonWebKey;
  keyId?: string;
}

export interface AccessTokenService {
  issueToken(claims: AccessTokenClaims): Promise<string>;
  verifyToken(token: string): Promise<AccessTokenPayload>;
  getJWKS(): jose.JSONWebKeySet;
}

export async function createAccessTokenService(
  config: AccessTokenServiceConfig,
): Promise<AccessTokenService> {
  const accessTokenTtlSeconds = config.accessTokenTtlSeconds ?? 900;

  let privateKey: CryptoKey | Uint8Array;
  let publicJwk: JsonWebKey;

  if (config.privateJwk && config.publicJwk) {
    privateKey = await jose.importJWK(config.privateJwk, 'EdDSA');
    publicJwk = { ...config.publicJwk };
  } else {
    const generated = await jose.generateKeyPair('EdDSA');
    privateKey = generated.privateKey;
    publicJwk = await jose.exportJWK(generated.publicKey);
  }

  const kid = config.keyId ?? crypto.randomUUID();
  const jwks: jose.JSONWebKeySet = {
    keys: [{ ...publicJwk, kid, use: 'sig', alg: 'EdDSA' }],
  };
  const keySet = jose.createLocalJWKSet(jwks);

  return {
    async issueToken(claims: AccessTokenClaims): Promise<string> {
      return new jose.SignJWT({
        sid: claims.sid,
        email: claims.email,
        scope: claims.scope,
      })
        .setProtectedHeader({ alg: 'EdDSA', kid })
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setSubject(claims.sub)
        .setJti(crypto.randomUUID())
        .setIssuedAt()
        .setExpirationTime(`${accessTokenTtlSeconds}s`)
        .sign(privateKey);
    },

    async verifyToken(token: string): Promise<AccessTokenPayload> {
      const { payload } = await jose.jwtVerify(token, keySet, {
        issuer: config.issuer,
        audience: config.audience,
      });

      if (!payload.sub || typeof payload.sid !== 'string') {
        throw new Error('JWT missing required claims');
      }

      return payload as AccessTokenPayload;
    },

    getJWKS(): jose.JSONWebKeySet {
      return jwks;
    },
  };
}
