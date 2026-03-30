import type { PasskeyLoginFinishRequest, PasskeyLoginStartResponse, PasskeyRegisterFinishRequest, PasskeyRegisterStartResponse } from '@editor-narrativo/account-shared';
export declare function isWebAuthnSupported(): boolean;
export declare function createPasskeyCredential(options: PasskeyRegisterStartResponse): Promise<PasskeyRegisterFinishRequest['credential']>;
export declare function getPasskeyAssertion(email: string, options: PasskeyLoginStartResponse, deviceName?: string): Promise<PasskeyLoginFinishRequest>;
//# sourceMappingURL=webauthn.d.ts.map