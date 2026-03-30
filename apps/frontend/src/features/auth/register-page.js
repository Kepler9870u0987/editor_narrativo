import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from './account-api';
function getErrorMessage(error) {
    return error instanceof ApiError ? error.message : 'Richiesta non riuscita';
}
export function RegisterPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [verificationToken, setVerificationToken] = useState(null);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setSuccess(null);
        try {
            const response = await accountApi.register({
                email,
                password,
                ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
            });
            setVerificationToken(response.verificationToken ?? null);
            setSuccess('Account creato. Verifica l’email per attivarlo.');
        }
        catch (err) {
            setError(getErrorMessage(err));
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx(PageShell, { title: "Crea il tuo spazio narrativo", subtitle: "L\u2019account protegge identit\u00E0 e sessioni. Lo sblocco dei dati avviene in un secondo passaggio.", aside: _jsx("div", { className: "button-row", children: _jsx(Link, { className: "button button--ghost", to: "/login", children: "Hai gi\u00E0 un account?" }) }), children: _jsxs("div", { className: "stack", children: [_jsxs("form", { className: "form-grid", onSubmit: handleSubmit, children: [_jsxs("label", { className: "label", children: ["Email", _jsx("input", { className: "input", value: email, onChange: (event) => setEmail(event.target.value), type: "email", required: true })] }), _jsxs("label", { className: "label", children: ["Password", _jsx("input", { className: "input", value: password, onChange: (event) => setPassword(event.target.value), type: "password", minLength: 12, required: true })] }), _jsxs("label", { className: "label", children: ["Nome visualizzato", _jsx("input", { className: "input", value: displayName, onChange: (event) => setDisplayName(event.target.value), type: "text" })] }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button", disabled: submitting, type: "submit", children: submitting ? 'Creazione...' : 'Crea account' }) })] }), error ? _jsx("p", { className: "error", children: error }) : null, success ? _jsx("p", { className: "success", children: success }) : null, verificationToken ? (_jsxs("div", { className: "panel stack", children: [_jsx("p", { className: "muted", children: "Token di verifica esposto in sviluppo. In produzione arriver\u00E0 via email." }), _jsx("code", { children: verificationToken }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button button--success", type: "button", onClick: () => navigate(`/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(verificationToken)}`), children: "Verifica subito" }) })] })) : null] }) }));
}
//# sourceMappingURL=register-page.js.map