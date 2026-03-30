import { create } from 'zustand';
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

export const useAuthSessionStore = create<AuthSessionState>((set) => ({
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
