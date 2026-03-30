import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import { useUnlockStore } from '../unlock/unlock-store';
import { SettingsNav } from './settings-nav';
export function SettingsSessionsPage() {
    const navigate = useNavigate();
    const accessToken = useAuthSessionStore((state) => state.accessToken);
    const setAnonymous = useAuthSessionStore((state) => state.setAnonymous);
    const lock = useUnlockStore((state) => state.lock);
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    async function loadSessions() {
        if (!accessToken) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setSessions(await accountApi.listSessions(accessToken));
        }
        catch (error) {
            setError(error instanceof ApiError ? error.message : 'Impossibile caricare le sessioni');
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void loadSessions();
    }, [accessToken]);
    return (_jsx(PageShell, { title: "Sessioni attive", subtitle: "Puoi revocare singoli device o chiudere tutte le sessioni server-side.", aside: _jsx(SettingsNav, {}), children: _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "button-row", children: [_jsx("button", { className: "button button--ghost", onClick: () => void loadSessions(), type: "button", children: "Aggiorna" }), _jsx("button", { className: "button button--danger", disabled: !accessToken, onClick: async () => {
                                if (!accessToken) {
                                    return;
                                }
                                await accountApi.logoutAll(accessToken);
                                lock();
                                setAnonymous();
                                navigate('/login', { replace: true });
                            }, type: "button", children: "Logout globale" })] }), loading ? _jsx("p", { className: "muted", children: "Caricamento sessioni..." }) : null, error ? _jsx("p", { className: "error", children: error }) : null, _jsx("div", { className: "list", children: sessions.map((session) => (_jsx("article", { className: `list-item${session.isCurrent ? ' list-item--active' : ''}`, children: _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "button-row", children: [_jsx("span", { className: "pill", children: session.isCurrent ? 'Sessione corrente' : 'Altra sessione' }), _jsx("span", { className: "pill", children: session.deviceName ?? 'Device senza nome' })] }), _jsx("p", { className: "muted", children: session.userAgent ?? 'User-Agent non disponibile' }), _jsxs("p", { className: "muted", children: ["Creata: ", new Date(session.createdAt).toLocaleString()] }), _jsxs("p", { className: "muted", children: ["Ultima attivit\u00E0: ", new Date(session.lastSeenAt).toLocaleString()] }), !session.revokedAt ? (_jsx("div", { className: "button-row", children: _jsx("button", { className: "button button--danger", disabled: !accessToken, onClick: async () => {
                                            if (!accessToken) {
                                                return;
                                            }
                                            await accountApi.revokeSession(accessToken, session.id);
                                            if (session.isCurrent) {
                                                lock();
                                                setAnonymous();
                                                navigate('/login', { replace: true });
                                                return;
                                            }
                                            await loadSessions();
                                        }, type: "button", children: "Revoca sessione" }) })) : (_jsxs("p", { className: "error", children: ["Revocata: ", session.revocationReason ?? 'Motivo non disponibile'] }))] }) }, session.id))) })] }) }));
}
//# sourceMappingURL=settings-sessions-page.js.map