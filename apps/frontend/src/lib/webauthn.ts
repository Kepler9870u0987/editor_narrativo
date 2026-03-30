import type {
  PasskeyLoginFinishRequest,
  PasskeyLoginStartResponse,
  PasskeyRegisterFinishRequest,
  PasskeyRegisterStartResponse,
} from '@editor-narrativo/account-shared';
import { base64UrlToBytes, bytesToBase64Url } from './base64';

function ensureWebAuthnAvailable(): void {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('WebAuthn non disponibile in questo browser');
  }
}

function toArrayBuffer(value: string): ArrayBuffer {
  const bytes = base64UrlToBytes(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fromArrayBuffer(value: ArrayBuffer): string {
  return bytesToBase64Url(new Uint8Array(value));
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export async function createPasskeyCredential(
  options: PasskeyRegisterStartResponse,
): Promise<PasskeyRegisterFinishRequest['credential']> {
  ensureWebAuthnAvailable();

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: toArrayBuffer(options.challenge),
      rp: options.rp,
      user: {
        id: toArrayBuffer(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation,
      authenticatorSelection: options.authenticatorSelection,
      excludeCredentials: options.excludeCredentials.map((descriptor) => ({
        id: toArrayBuffer(descriptor.id),
        type: descriptor.type,
      })),
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Registrazione passkey annullata');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: fromArrayBuffer(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: fromArrayBuffer(response.clientDataJSON),
      attestationObject: fromArrayBuffer(response.attestationObject),
      ...(typeof response.getTransports === 'function'
        ? { transports: response.getTransports() }
        : {}),
    },
  };
}

export async function getPasskeyAssertion(
  email: string,
  options: PasskeyLoginStartResponse,
  deviceName?: string,
): Promise<PasskeyLoginFinishRequest> {
  ensureWebAuthnAvailable();

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification,
      allowCredentials: options.allowCredentials.map((descriptor) => ({
        id: toArrayBuffer(descriptor.id),
        type: descriptor.type,
      })),
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Autenticazione passkey annullata');
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    email,
    ...(deviceName ? { deviceName } : {}),
    credential: {
      id: credential.id,
      rawId: fromArrayBuffer(credential.rawId),
      type: 'public-key',
      response: {
        clientDataJSON: fromArrayBuffer(response.clientDataJSON),
        authenticatorData: fromArrayBuffer(response.authenticatorData),
        signature: fromArrayBuffer(response.signature),
        ...(response.userHandle
          ? { userHandle: fromArrayBuffer(response.userHandle) }
          : {}),
      },
    },
  };
}
