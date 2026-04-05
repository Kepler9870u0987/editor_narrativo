import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { accountApi } from '../features/auth/account-api';
import { useAuthSessionStore } from '../features/auth/auth-store';
import { useUnlockStore } from '../features/unlock/unlock-store';
import { LoadingScreen } from '../components/loading-screen';
import { LoginPage } from '../features/auth/login-page';
import { RegisterPage } from '../features/auth/register-page';
import { VerifyEmailPage } from '../features/auth/verify-email-page';
import { ForgotPasswordPage } from '../features/auth/forgot-password-page';
import { ResetPasswordPage } from '../features/auth/reset-password-page';
import { UnlockPage } from '../features/unlock/unlock-page';
import { EditorAppPage } from '../features/editor/editor-app-page';
import { SettingsProfilePage } from '../features/settings/settings-profile-page';
import { SettingsSessionsPage } from '../features/settings/settings-sessions-page';
import { SettingsSecurityPage } from '../features/settings/settings-security-page';
import { SettingsLLMPage } from '../features/settings/settings-llm-page';

function SessionBootstrap() {
  const status = useAuthSessionStore((state) => state.status);
  const setAuthenticated = useAuthSessionStore((state) => state.setAuthenticated);
  const setAnonymous = useAuthSessionStore((state) => state.setAnonymous);
  const [bootstrapping, setBootstrapping] = useState(status === 'unknown');

  useEffect(() => {
    if (status !== 'unknown') {
      setBootstrapping(false);
      return;
    }

    accountApi
      .refresh()
      .then((session) => {
        setAuthenticated({
          accessToken: session.accessToken,
          sessionId: session.sessionId,
          user: session.user,
        });
      })
      .catch(() => {
        setAnonymous();
      })
      .finally(() => setBootstrapping(false));
  }, [setAnonymous, setAuthenticated, status]);

  if (bootstrapping) {
    return <LoadingScreen label="Ripristino sessione..." />;
  }

  return null;
}

function RequireAuth() {
  const status = useAuthSessionStore((state) => state.status);
  if (status === 'unknown') {
    return <LoadingScreen label="Verifica sessione..." />;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function RequireUnlock() {
  const unlocked = useUnlockStore((state) => state.unlocked);
  if (!unlocked) {
    return <Navigate to="/unlock" replace />;
  }
  return <Outlet />;
}

export function AppRouter() {
  return (
    <>
      <SessionBootstrap />
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/unlock" element={<UnlockPage />} />
          <Route path="/settings/profile" element={<SettingsProfilePage />} />
          <Route path="/settings/sessions" element={<SettingsSessionsPage />} />
          <Route path="/settings/security" element={<SettingsSecurityPage />} />
          <Route path="/settings/llm" element={<SettingsLLMPage />} />

          <Route element={<RequireUnlock />}>
            <Route path="/app" element={<EditorAppPage />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
