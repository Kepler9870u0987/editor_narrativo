import { randomBytes, timingSafeEqual } from 'node:crypto';
import sodium from 'libsodium-wrappers-sumo';

const PASSWORD_HASH_VERSION = 'argon2id-v1';
const PASSWORD_HASH_LENGTH = 32;
const PASSWORD_HASH_SALT_LENGTH = 16;
const PASSWORD_HASH_OPS_LIMIT = 2;
const PASSWORD_HASH_MEMORY_LIMIT = 64 * 1024 * 1024;

let sodiumReady = false;

async function ensureSodium(): Promise<void> {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
}

function createPasswordInput(password: string, pepper: string): Uint8Array {
  return sodium.from_string(`${password}\u0000${pepper}`);
}

export async function hashPassword(
  password: string,
  pepper = '',
): Promise<string> {
  await ensureSodium();
  const salt = randomBytes(PASSWORD_HASH_SALT_LENGTH);
  const passwordInput = createPasswordInput(password, pepper);

  try {
    const hash = sodium.crypto_pwhash(
      PASSWORD_HASH_LENGTH,
      passwordInput,
      salt,
      PASSWORD_HASH_OPS_LIMIT,
      PASSWORD_HASH_MEMORY_LIMIT,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );

    return [
      PASSWORD_HASH_VERSION,
      Buffer.from(salt).toString('base64url'),
      Buffer.from(hash).toString('base64url'),
    ].join(':');
  } finally {
    passwordInput.fill(0);
    salt.fill(0);
  }
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
  pepper = '',
): Promise<boolean> {
  await ensureSodium();
  const [version, saltBase64, expectedHashBase64] = encodedHash.split(':');
  if (
    version !== PASSWORD_HASH_VERSION ||
    !saltBase64 ||
    !expectedHashBase64
  ) {
    return false;
  }

  const salt = Buffer.from(saltBase64, 'base64url');
  const expectedHash = Buffer.from(expectedHashBase64, 'base64url');
  const passwordInput = createPasswordInput(password, pepper);

  try {
    const actualHash = Buffer.from(
      sodium.crypto_pwhash(
        expectedHash.byteLength,
        passwordInput,
        salt,
        PASSWORD_HASH_OPS_LIMIT,
        PASSWORD_HASH_MEMORY_LIMIT,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      ),
    );

    if (actualHash.byteLength !== expectedHash.byteLength) {
      return false;
    }

    return timingSafeEqual(actualHash, expectedHash);
  } finally {
    passwordInput.fill(0);
    salt.fill(0);
    expectedHash.fill(0);
  }
}
