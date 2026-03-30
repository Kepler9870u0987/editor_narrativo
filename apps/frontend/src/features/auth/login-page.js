import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { getPasskeyAssertion, isWebAuthnSupported } from '../../lib/webauthn';
import { accountApi } from './account-api';
import { useAuthSessionStore } from './auth-store';
import { useUnlockStore } from '../unlock/unlock-store';
export function LoginPage() {
    const navigate = useNavigate();
    const status = useAuthSessionStore((state) => state.status);
    const setAuthenticated = useAuthSessionStore((state) => state.setAuthenticated);
    const lock = useUnlockStore((state) => state.lock);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [deviceName, setDeviceName] = useState('Browser principale');
    const [totpCode, setTotpCode] = useState('');
    const [recoveryCode, setRecoveryCode] = useState('');
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [passkeyLoading, setPasskeyLoading] = useState(false);
    useEffect(() => {
        if (status === 'authenticated') {
            navigate('/unlock', { replace: true });
        }
    }, [navigate, status]);
    async function handleLogin(event) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const session = await accountApi.login({
                email,
                password,
                ...(deviceName.trim() ? { deviceName: deviceName.trim() } : {}),
                ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
                ...(recoveryCode.trim() ? { recoveryCode: recoveryCode.trim() } : {}),
            });
            lock();
            setAuthenticated({
                accessToken: session.accessToken,
                sessionId: session.sessionId,
                user: session.user,
            });
            navigate('/unlock', { replace: true });
        }
        catch (error) {
            setError(error instanceof ApiError ? error.message : 'Login non riuscito');
        }
        finally {
            setSubmitting(false);
        }
    }
    async function handlePasskeyLogin() {
        if (!email.trim()) {
            setError('Inserisci l’email prima di usare la passkey');
            return;
        }
        setPasskeyLoading(true);
        setError(null);
        try {
            const start = await accountApi.startPasskeyLogin({ email });
            const payload = await getPasskeyAssertion(email, start, deviceName.trim() || undefined);
            const session = await accountApi.finishPasskeyLogin(payload);
            lock();
            setAuthenticated({
                accessToken: session.accessToken,
                sessionId: session.sessionId,
                user: session.user,
            });
            navigate('/unlock', { replace: true });
        }
        catch (error) {
            setError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Login passkey non riuscito');
        }
        finally {
            setPasskeyLoading(false);
        }
    }
    return (_jsx(PageShell, { title: "Accedi all\u2019account", subtitle: "Dopo il login sbloccherai localmente la DEK e la chiave di firma del dispositivo.", aside: _jsxs("div", { className: "button-row", children: [_jsx(Link, { className: "button button--ghost", to: "/register", children: "Crea account" }), _jsx(Link, { className: "button button--ghost", to: "/forgot-password", children: "Password dimenticata" })] }), children: _jsxs("div", { className: "stack", children: [_jsxs("form", { className: "form-grid", onSubmit: handleLogin, children: [_jsxs("label", { className: "label", children: ["Email", _jsx("input", { className: "input", value: email, onChange: (event) => setEmail(event.target.value), type: "email", required: true })] }), _jsxs("label", { className: "label", children: ["Password", _jsx("input", { className: "input", value: password, onChange: (event) => setPassword(event.target.value), type: "password", required: true })] }), _jsxs("label", { className: "label", children: ["Nome dispositivo", _jsx("input", { className: "input", value: deviceName, onChange: (event) => setDeviceName(event.target.value), type: "text" })] }), _jsxs("div", { className: "two-column", children: [_jsxs("label", { className: "label", children: ["TOTP opzionale", _jsx("input", { className: "input", value: totpCode, onChange: (event) => setTotpCode(event.target.value), inputMode: "numeric" })] }), _jsxs("label", { className: "label", children: ["Recovery code opzionale", _jsx("input", { className: "input", value: recoveryCode, onChange: (event) => setRecoveryCode(event.target.value) })] })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { className: "button", disabled: submitting, type: "submit", children: submitting ? 'Accesso...' : 'Accedi' }), isWebAuthnSupported() ? (_jsx("button", { className: "button button--ghost", disabled: passkeyLoading, onClick: handlePasskeyLogin, type: "button", children: passkeyLoading ? 'Attendo passkey...' : 'Accedi con passkey' })) : null] })] }), error ? _jsx("p", { className: "error", children: error }) : null] }) }));
}
//# sourceMappingURL=login-page.js.map