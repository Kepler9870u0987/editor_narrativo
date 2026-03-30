import { create } from 'zustand';
export const useAuthSessionStore = create((set) => ({
    status: 'unknown',
    accessToken: null,
    sessionId: null,
    user: null,
    setAuthenticated: ({ accessToken, sessionId, user }) => {
        set({
            status: 'authenticated',
            accessToken,
            sessionId,
            user,
        });
    },
    setAnonymous: () => {
        set({
            status: 'anonymous',
            accessToken: null,
            sessionId: null,
            user: null,
        });
    },
}));
//# sourceMappingURL=auth-store.js.map