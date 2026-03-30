import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
        return _jsx(LoadingScreen, { label: "Ripristino sessione..." });
    }
    return null;
}
function RequireAuth() {
    const status = useAuthSessionStore((state) => state.status);
    if (status === 'unknown') {
        return _jsx(LoadingScreen, { label: "Verifica sessione..." });
    }
    if (status !== 'authenticated') {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return _jsx(Outlet, {});
}
function RequireUnlock() {
    const unlocked = useUnlockStore((state) => state.unlocked);
    if (!unlocked) {
        return _jsx(Navigate, { to: "/unlock", replace: true });
    }
    return _jsx(Outlet, {});
}
export function AppRouter() {
    return (_jsxs(_Fragment, { children: [_jsx(SessionBootstrap, {}), _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "/app", replace: true }) }), _jsx(Route, { path: "/register", element: _jsx(RegisterPage, {}) }), _jsx(Route, { path: "/verify-email", element: _jsx(VerifyEmailPage, {}) }), _jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/forgot-password", element: _jsx(ForgotPasswordPage, {}) }), _jsx(Route, { path: "/reset-password", element: _jsx(ResetPasswordPage, {}) }), _jsxs(Route, { element: _jsx(RequireAuth, {}), children: [_jsx(Route, { path: "/unlock", element: _jsx(UnlockPage, {}) }), _jsx(Route, { path: "/settings/profile", element: _jsx(SettingsProfilePage, {}) }), _jsx(Route, { path: "/settings/sessions", element: _jsx(SettingsSessionsPage, {}) }), _jsx(Route, { path: "/settings/security", element: _jsx(SettingsSecurityPage, {}) }), _jsx(Route, { element: _jsx(RequireUnlock, {}), children: _jsx(Route, { path: "/app", element: _jsx(EditorAppPage, {}) }) })] })] })] }));
}
//# sourceMappingURL=router.js.map