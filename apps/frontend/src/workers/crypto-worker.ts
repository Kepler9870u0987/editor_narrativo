import { deriveKEK, generateSigningKeyPair } from '@editor-narrativo/crypto';
import type { CryptoWorkerRequest, CryptoWorkerResponse } from '@editor-narrativo/shared';

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  try {
    if (event.data.type === 'DERIVE_KEK') {
      const kek = await deriveKEK(event.data.password, event.data.salt);
      const response: CryptoWorkerResponse = {
        requestId: event.data.requestId,
        type: 'KEK_DERIVED',
        kek,
      };
      self.postMessage(response, [kek]);
      return;
    }

    const keyPair = await generateSigningKeyPair();
    const response: CryptoWorkerResponse = {
      requestId: event.data.requestId,
      type: 'SIGNING_KEYPAIR_GENERATED',
      publicKey: keyPair.publicKey,
      secretKey: keyPair.secretKey,
    };
    self.postMessage(response);
  } catch (error) {
    const response: CryptoWorkerResponse = {
      requestId: event.data.requestId,
      type: 'ERROR',
      message: error instanceof Error ? error.message : 'Errore del worker crittografico',
    };
    self.postMessage(response);
  }
};
