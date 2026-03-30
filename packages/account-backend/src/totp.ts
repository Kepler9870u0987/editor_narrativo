import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

function base32Encode(input: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]!;
  }

  return output;
}

function base32Decode(input: string): Uint8Array {
  const normalized = input.replace(/=+$/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 secret');
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

function leftPad(value: number): string {
  return value.toString().padStart(TOTP_DIGITS, '0');
}

function generateHotp(secret: string, counter: number): string {
  const secretBytes = Buffer.from(base32Decode(secret));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  const digest = createHmac('sha1', secretBytes).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return leftPad(binary % 10 ** TOTP_DIGITS);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function buildTotpOtpAuthUri(
  issuer: string,
  email: string,
  secret: string,
): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const issuerParam = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuerParam}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

export function verifyTotpCode(
  secret: string,
  code: string,
  now = Date.now(),
  window = 1,
): boolean {
  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  const currentCounter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -window; offset <= window; offset++) {
    const candidate = generateHotp(secret, currentCounter + offset);
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
      return true;
    }
  }

  return false;
}

export function generateTotpCode(secret: string, now = Date.now()): string {
  const currentCounter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  return generateHotp(secret, currentCounter);
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    `${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}`.toUpperCase(),
  );
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}
