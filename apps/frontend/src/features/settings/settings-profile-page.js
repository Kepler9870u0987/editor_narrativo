import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import { SettingsNav } from './settings-nav';
export function SettingsProfilePage() {
    const accessToken = useAuthSessionStore((state) => state.accessToken);
    const user = useAuthSessionStore((state) => state.user);
    const setAuthenticated = useAuthSessionStore((state) => state.setAuthenticated);
    const sessionId = useAuthSessionStore((state) => state.sessionId);
    const [displayName, setDisplayName] = useState(user?.displayName ?? '');
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setDisplayName(user?.displayName ?? '');
    }, [user?.displayName]);
    async function handleSubmit(event) {
        event.preventDefault();
        if (!accessToken || !user || !sessionId) {
            return;
        }
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const updated = await accountApi.updateProfile(accessToken, { displayName });
            setAuthenticated({ accessToken, user: updated, sessionId });
            setSuccess('Profilo aggiornato');
        }
        catch (error) {
            setError(error instanceof ApiError ? error.message : 'Aggiornamento non riuscito');
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsx(PageShell, { title: "Profilo account", subtitle: "Qui gestisci identit\u00E0 e policy di accesso, non le chiavi locali.", aside: _jsx(SettingsNav, {}), children: _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "panel stack", children: [_jsxs("p", { children: [_jsx("strong", { children: "Email:" }), " ", user?.email] }), _jsxs("p", { children: [_jsx("strong", { children: "Stato:" }), " ", user?.status] }), _jsxs("p", { children: [_jsx("strong", { children: "Email verificata:" }), " ", user?.emailVerifiedAt ? 'Sì' : 'No'] }), _jsxs("p", { children: [_jsx("strong", { children: "MFA:" }), " ", user?.mfaEnabled ? 'Abilitata' : 'Non abilitata'] })] }), _jsxs("form", { className: "form-grid", onSubmit: handleSubmit, children: [_jsxs("label", { className: "label", children: ["Nome visualizzato", _jsx("input", { className: "input", value: displayName, onChange: (event) => setDisplayName(event.target.value) })] }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button", disabled: saving || !accessToken, type: "submit", children: saving ? 'Salvataggio...' : 'Salva profilo' }) })] }), error ? _jsx("p", { className: "error", children: error }) : null, success ? _jsx("p", { className: "success", children: success }) : null] }) }));
}
//# sourceMappingURL=settings-profile-page.js.map