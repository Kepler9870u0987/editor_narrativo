import { deriveKEK, generateSigningKeyPair } from '@editor-narrativo/crypto';
self.onmessage = async (event) => {
    try {
        if (event.data.type === 'DERIVE_KEK') {
            const kek = await deriveKEK(event.data.password, event.data.salt);
            const response = {
                requestId: event.data.requestId,
                type: 'KEK_DERIVED',
                kek,
            };
            self.postMessage(response, [kek]);
            return;
        }
        const keyPair = await generateSigningKeyPair();
        const response = {
            requestId: event.data.requestId,
            type: 'SIGNING_KEYPAIR_GENERATED',
            publicKey: keyPair.publicKey,
            secretKey: keyPair.secretKey,
        };
        self.postMessage(response);
    }
    catch (error) {
        const response = {
            requestId: event.data.requestId,
            type: 'ERROR',
            message: error instanceof Error ? error.message : 'Errore del worker crittografico',
        };
        self.postMessage(response);
    }
};
//# sourceMappingURL=crypto-worker.js.map