import { createHash, randomBytes } from 'node:crypto';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

interface DecodedClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export interface RegistrationCredentialInput {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
}

export interface AuthenticationCredentialInput {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
}

export interface ParsedRegistrationResult {
  credentialId: string;
  publicKeyJwk: JsonWebKey;
  signCount: number;
  transports: string[];
}

export interface ParsedAuthenticationResult {
  signCount: number;
}

type CborValue =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>;

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function ensureOrigin(origin: string, expectedOrigin: string): void {
  if (origin !== expectedOrigin) {
    throw new Error('Unexpected WebAuthn origin');
  }
}

function ensureRpIdHash(authenticatorData: Uint8Array, rpId: string): void {
  const expected = sha256(textEncoder.encode(rpId));
  const actual = authenticatorData.subarray(0, 32);
  if (!bytesEqual(actual, expected)) {
    throw new Error('Unexpected rpId hash');
  }
}

function ensureUserVerified(flags: number): void {
  if ((flags & FLAG_USER_PRESENT) === 0) {
    throw new Error('User presence flag missing');
  }
  if ((flags & FLAG_USER_VERIFIED) === 0) {
    throw new Error('User verification flag missing');
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset]! << 8) | data[offset + 1]!;
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    (data[offset]! * 0x1000000) +
    ((data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!)
  );
}

function decodeLength(data: Uint8Array, offset: number, additionalInfo: number): { value: number; offset: number } {
  if (additionalInfo < 24) {
    return { value: additionalInfo, offset };
  }
  if (additionalInfo === 24) {
    return { value: data[offset]!, offset: offset + 1 };
  }
  if (additionalInfo === 25) {
    return { value: readUint16(data, offset), offset: offset + 2 };
  }
  if (additionalInfo === 26) {
    return { value: readUint32(data, offset), offset: offset + 4 };
  }
  throw new Error('Unsupported CBOR length encoding');
}

function decodeCborValue(data: Uint8Array, startOffset = 0): { value: CborValue; offset: number } {
  const initialByte = data[startOffset];
  if (initialByte === undefined) {
    throw new Error('Unexpected end of CBOR payload');
  }

  const majorType = initialByte >> 5;
  const additionalInfo = initialByte & 0x1f;
  let offset = startOffset + 1;

  if (majorType === 0) {
    const length = decodeLength(data, offset, additionalInfo);
    return { value: length.value, offset: length.offset };
  }

  if (majorType === 1) {
    const length = decodeLength(data, offset, additionalInfo);
    return { value: -1 - length.value, offset: length.offset };
  }

  if (majorType === 2 || majorType === 3) {
    const length = decodeLength(data, offset, additionalInfo);
    offset = length.offset;
    const slice = data.subarray(offset, offset + length.value);
    if (slice.length !== length.value) {
      throw new Error('Unexpected end of CBOR payload');
    }
    return {
      value: majorType === 2 ? new Uint8Array(slice) : textDecoder.decode(slice),
      offset: offset + length.value,
    };
  }

  if (majorType === 4) {
    const length = decodeLength(data, offset, additionalInfo);
    offset = length.offset;
    const items: CborValue[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const decoded = decodeCborValue(data, offset);
      items.push(decoded.value);
      offset = decoded.offset;
    }
    return { value: items, offset };
  }

  if (majorType === 5) {
    const length = decodeLength(data, offset, additionalInfo);
    offset = length.offset;
    const entries = new Map<CborValue, CborValue>();
    for (let index = 0; index < length.value; index += 1) {
      const key = decodeCborValue(data, offset);
      const value = decodeCborValue(data, key.offset);
      entries.set(key.value, value.value);
      offset = value.offset;
    }
    return { value: entries, offset };
  }

  if (majorType === 7) {
    if (additionalInfo === 20) {
      return { value: false, offset };
    }
    if (additionalInfo === 21) {
      return { value: true, offset };
    }
    if (additionalInfo === 22) {
      return { value: null, offset };
    }
  }

  throw new Error('Unsupported CBOR value');
}

export function decodeCbor(data: Uint8Array): CborValue {
  const decoded = decodeCborValue(data);
  if (decoded.offset !== data.length) {
    throw new Error('Unexpected trailing CBOR data');
  }
  return decoded.value;
}

function encodeUnsigned(value: number, majorType: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('CBOR only supports non-negative integers here');
  }
  if (value < 24) {
    return Uint8Array.of((majorType << 5) | value);
  }
  if (value < 0x100) {
    return Uint8Array.of((majorType << 5) | 24, value);
  }
  if (value < 0x10000) {
    return Uint8Array.of((majorType << 5) | 25, value >> 8, value & 0xff);
  }
  return Uint8Array.of(
    (majorType << 5) | 26,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

export function encodeCbor(value: CborValue): Uint8Array {
  if (value instanceof Uint8Array) {
    return concatBytes([encodeUnsigned(value.length, 2), value]);
  }
  if (typeof value === 'string') {
    const bytes = textEncoder.encode(value);
    return concatBytes([encodeUnsigned(bytes.length, 3), bytes]);
  }
  if (typeof value === 'number') {
    return value >= 0 ? encodeUnsigned(value, 0) : encodeUnsigned(-1 - value, 1);
  }
  if (typeof value === 'boolean') {
    return Uint8Array.of(value ? 0xf5 : 0xf4);
  }
  if (value === null) {
    return Uint8Array.of(0xf6);
  }
  if (Array.isArray(value)) {
    return concatBytes([encodeUnsigned(value.length, 4), ...value.map((item) => encodeCbor(item))]);
  }
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)]);
    return concatBytes([encodeUnsigned(value.size, 5), ...entries]);
  }
  throw new Error('Unsupported CBOR value for encoding');
}

export function base64urlEncode(data: Uint8Array): string {
  return Buffer.from(data).toString('base64url');
}

export function base64urlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

export function utf8ToBase64url(value: string): string {
  return base64urlEncode(textEncoder.encode(value));
}

export function generateWebAuthnChallenge(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function parseClientData(clientDataJSON: Uint8Array): DecodedClientData {
  const parsed = JSON.parse(textDecoder.decode(clientDataJSON)) as DecodedClientData;
  if (
    typeof parsed.type !== 'string' ||
    typeof parsed.challenge !== 'string' ||
    typeof parsed.origin !== 'string'
  ) {
    throw new Error('Invalid clientDataJSON');
  }
  if (parsed.crossOrigin === true) {
    throw new Error('Cross-origin WebAuthn requests are not allowed');
  }
  return parsed;
}

function parseAuthenticatorData(authenticatorData: Uint8Array): {
  flags: number;
  signCount: number;
  credentialId?: Uint8Array;
  cosePublicKey?: Uint8Array;
} {
  if (authenticatorData.length < 37) {
    throw new Error('Authenticator data is too short');
  }

  const flags = authenticatorData[32]!;
  const signCount = readUint32(authenticatorData, 33);
  const result: {
    flags: number;
    signCount: number;
    credentialId?: Uint8Array;
    cosePublicKey?: Uint8Array;
  } = { flags, signCount };

  if ((flags & FLAG_ATTESTED_CREDENTIAL_DATA) !== 0) {
    if (authenticatorData.length < 55) {
      throw new Error('Authenticator attestation data is too short');
    }
    const credentialLength = readUint16(authenticatorData, 53);
    const credentialStart = 55;
    const credentialEnd = credentialStart + credentialLength;
    if (authenticatorData.length < credentialEnd) {
      throw new Error('Credential id exceeds authenticator data size');
    }
    result.credentialId = authenticatorData.subarray(credentialStart, credentialEnd);
    result.cosePublicKey = authenticatorData.subarray(credentialEnd);
  }

  return result;
}

function getMapValue<T extends CborValue>(map: Map<CborValue, CborValue>, key: number): T {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Missing COSE key member ${key}`);
  }
  return value as T;
}

function coseEc2ToJwk(cosePublicKey: Uint8Array): JsonWebKey {
  const decoded = decodeCbor(cosePublicKey);
  if (!(decoded instanceof Map)) {
    throw new Error('Invalid COSE public key');
  }

  const keyType = getMapValue<number>(decoded, 1);
  const algorithm = getMapValue<number>(decoded, 3);
  const curve = getMapValue<number>(decoded, -1);
  const x = getMapValue<Uint8Array>(decoded, -2);
  const y = getMapValue<Uint8Array>(decoded, -3);

  if (keyType !== 2 || algorithm !== -7 || curve !== 1) {
    throw new Error('Only ES256 / P-256 passkeys are supported');
  }

  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64urlEncode(x),
    y: base64urlEncode(y),
    alg: 'ES256',
    key_ops: ['verify'],
    ext: true,
  };
}

async function importVerifyKey(publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

export function verifyRegistrationResponse(input: {
  credential: RegistrationCredentialInput;
  challenge: string;
  rpId: string;
  origin: string;
}): ParsedRegistrationResult {
  const { credential, challenge, rpId, origin } = input;
  if (credential.type !== 'public-key') {
    throw new Error('Unsupported credential type');
  }

  const clientDataJSON = base64urlDecode(credential.response.clientDataJSON);
  const clientData = parseClientData(clientDataJSON);
  if (clientData.type !== 'webauthn.create') {
    throw new Error('Unexpected WebAuthn ceremony type');
  }
  if (clientData.challenge !== challenge) {
    throw new Error('Unexpected WebAuthn challenge');
  }
  ensureOrigin(clientData.origin, origin);

  const attestationObject = decodeCbor(base64urlDecode(credential.response.attestationObject));
  if (!(attestationObject instanceof Map)) {
    throw new Error('Invalid attestation object');
  }
  const format = attestationObject.get('fmt');
  if (format !== 'none') {
    throw new Error('Only none attestation is supported');
  }
  const authData = attestationObject.get('authData');
  if (!(authData instanceof Uint8Array)) {
    throw new Error('Invalid attestation authData');
  }

  ensureRpIdHash(authData, rpId);
  const parsed = parseAuthenticatorData(authData);
  ensureUserVerified(parsed.flags);
  if (!parsed.credentialId || !parsed.cosePublicKey) {
    throw new Error('Missing attested credential data');
  }

  const credentialId = base64urlEncode(parsed.credentialId);
  if (credential.id !== credentialId || credential.rawId !== credentialId) {
    throw new Error('Credential id mismatch');
  }

  return {
    credentialId,
    publicKeyJwk: coseEc2ToJwk(parsed.cosePublicKey),
    signCount: parsed.signCount,
    transports: Array.isArray(credential.response.transports)
      ? credential.response.transports.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export async function verifyAuthenticationResponse(input: {
  credential: AuthenticationCredentialInput;
  challenge: string;
  rpId: string;
  origin: string;
  publicKeyJwk: JsonWebKey;
  expectedCredentialId: string;
  currentSignCount: number;
}): Promise<ParsedAuthenticationResult> {
  const { credential, challenge, rpId, origin, publicKeyJwk, expectedCredentialId, currentSignCount } = input;
  if (credential.type !== 'public-key') {
    throw new Error('Unsupported credential type');
  }
  if (credential.id !== expectedCredentialId || credential.rawId !== expectedCredentialId) {
    throw new Error('Credential id mismatch');
  }

  const clientDataJSON = base64urlDecode(credential.response.clientDataJSON);
  const clientData = parseClientData(clientDataJSON);
  if (clientData.type !== 'webauthn.get') {
    throw new Error('Unexpected WebAuthn ceremony type');
  }
  if (clientData.challenge !== challenge) {
    throw new Error('Unexpected WebAuthn challenge');
  }
  ensureOrigin(clientData.origin, origin);

  const authenticatorData = base64urlDecode(credential.response.authenticatorData);
  ensureRpIdHash(authenticatorData, rpId);
  const parsed = parseAuthenticatorData(authenticatorData);
  ensureUserVerified(parsed.flags);

  const clientDataHash = sha256(clientDataJSON);
  const signedPayload = concatBytes([authenticatorData, clientDataHash]);
  const signature = base64urlDecode(credential.response.signature);
  const verifyKey = await importVerifyKey(publicKeyJwk);
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    toArrayBuffer(signature),
    toArrayBuffer(signedPayload),
  );

  if (!verified) {
    throw new Error('Invalid passkey signature');
  }

  if (currentSignCount > 0 && parsed.signCount > 0 && parsed.signCount <= currentSignCount) {
    throw new Error('Passkey sign counter did not advance');
  }

  return {
    signCount: parsed.signCount,
  };
}
