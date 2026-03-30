import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useNavigate } from 'react-router-dom';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import { useUnlockStore } from '../unlock/unlock-store';
export function SettingsNav() {
    const navigate = useNavigate();
    const accessToken = useAuthSessionStore((state) => state.accessToken);
    const setAnonymous = useAuthSessionStore((state) => state.setAnonymous);
    const lock = useUnlockStore((state) => state.lock);
    return (_jsxs("div", { className: "button-row", children: [_jsx(Link, { className: "button button--ghost", to: "/app", children: "Editor" }), _jsx(Link, { className: "button button--ghost", to: "/settings/profile", children: "Profilo" }), _jsx(Link, { className: "button button--ghost", to: "/settings/sessions", children: "Sessioni" }), _jsx(Link, { className: "button button--ghost", to: "/settings/security", children: "Sicurezza" }), _jsx("button", { className: "button button--danger", onClick: async () => {
                    try {
                        await accountApi.logout(accessToken);
                    }
                    finally {
                        lock();
                        setAnonymous();
                        navigate('/login', { replace: true });
                    }
                }, type: "button", children: "Logout" })] }));
}
//# sourceMappingURL=settings-nav.js.map