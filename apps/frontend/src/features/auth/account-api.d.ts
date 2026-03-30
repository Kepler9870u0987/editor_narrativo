import type { AccountProfile, AccountSessionSummary, AuthSuccessResponse, BootstrapKeysRequest, ForgotPasswordResponse, LoginRequest, PasskeyLoginFinishRequest, PasskeyLoginStartRequest, PasskeyLoginStartResponse, PasskeyRegisterFinishRequest, PasskeyRegisterStartResponse, RecoveryExportResponse, RegisterRequest, RegisterResponse, ResetPasswordRequest, TotpSetupResponse, TotpVerifyResponse, UpdateProfileRequest, VerifyEmailRequest, WrappedKeyMaterialRecord } from '@editor-narrativo/account-shared';
export declare const accountApi: {
    register(payload: RegisterRequest): Promise<RegisterResponse>;
    verifyEmail(payload: VerifyEmailRequest): Promise<{
        verified: boolean;
        user: AccountProfile;
    }>;
    login(payload: LoginRequest): Promise<AuthSuccessResponse>;
    refresh(): Promise<AuthSuccessResponse>;
    logout(accessToken?: string | null): Promise<{
        loggedOut: boolean;
    }>;
    logoutAll(accessToken: string): Promise<{
        loggedOutAll: boolean;
    }>;
    forgotPassword(email: string): Promise<ForgotPasswordResponse>;
    resetPassword(payload: ResetPasswordRequest): Promise<{
        passwordReset: boolean;
    }>;
    getMe(accessToken: string): Promise<AccountProfile>;
    updateProfile(accessToken: string, patch: UpdateProfileRequest): Promise<AccountProfile>;
    listSessions(accessToken: string): Promise<AccountSessionSummary[]>;
    revokeSession(accessToken: string, sessionId: string): Promise<{
        revoked: boolean;
    }>;
    bootstrapKeys(accessToken: string, payload: BootstrapKeysRequest): Promise<WrappedKeyMaterialRecord>;
    getKeyMaterial(accessToken: string): Promise<WrappedKeyMaterialRecord>;
    rotateUnlock(accessToken: string, payload: BootstrapKeysRequest): Promise<WrappedKeyMaterialRecord>;
    exportRecoveryKit(accessToken: string): Promise<RecoveryExportResponse>;
    importRecoveryKit(accessToken: string, payload: BootstrapKeysRequest): Promise<WrappedKeyMaterialRecord>;
    startTotp(accessToken: string): Promise<TotpSetupResponse>;
    verifyTotp(accessToken: string, code: string): Promise<TotpVerifyResponse>;
    startPasskeyRegistration(accessToken: string): Promise<PasskeyRegisterStartResponse>;
    finishPasskeyRegistration(accessToken: string, payload: PasskeyRegisterFinishRequest): Promise<{
        registered: boolean;
    }>;
    startPasskeyLogin(payload: PasskeyLoginStartRequest): Promise<PasskeyLoginStartResponse>;
    finishPasskeyLogin(payload: PasskeyLoginFinishRequest): Promise<AuthSuccessResponse>;
};
//# sourceMappingURL=account-api.d.ts.map