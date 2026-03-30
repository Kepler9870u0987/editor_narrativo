import type { AccountProfile } from '@editor-narrativo/account-shared';
export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated';
interface AuthSessionState {
    status: AuthStatus;
    accessToken: string | null;
    sessionId: string | null;
    user: AccountProfile | null;
    setAuthenticated(payload: {
        accessToken: string;
        sessionId: string;
        user: AccountProfile;
    }): void;
    setAnonymous(): void;
}
export declare const useAuthSessionStore: import("zustand").UseBoundStore<import("zustand").StoreApi<AuthSessionState>>;
export {};
//# sourceMappingURL=auth-store.d.ts.map