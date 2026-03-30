import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from './account-api';
export function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [resetToken, setResetToken] = useState(null);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setMessage(null);
        setError(null);
        try {
            const response = await accountApi.forgotPassword(email);
            setResetToken(response.resetToken ?? null);
            setMessage('Se l’account esiste, il reset è stato avviato.');
        }
        catch (error) {
            setError(error instanceof ApiError ? error.message : 'Reset non avviato');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx(PageShell, { title: "Reset password", subtitle: "Questo flusso cambia l\u2019accesso all\u2019account, non la cifratura locale dei documenti.", aside: _jsx("div", { className: "button-row", children: _jsx(Link, { className: "button button--ghost", to: "/login", children: "Torna al login" }) }), children: _jsxs("div", { className: "stack", children: [_jsxs("form", { className: "form-grid", onSubmit: handleSubmit, children: [_jsxs("label", { className: "label", children: ["Email", _jsx("input", { className: "input", value: email, onChange: (event) => setEmail(event.target.value), type: "email", required: true })] }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button", disabled: submitting, type: "submit", children: submitting ? 'Invio...' : 'Invia reset' }) })] }), error ? _jsx("p", { className: "error", children: error }) : null, message ? _jsx("p", { className: "success", children: message }) : null, resetToken ? (_jsxs("div", { className: "panel stack", children: [_jsx("p", { className: "muted", children: "Token esposto in sviluppo:" }), _jsx("code", { children: resetToken }), _jsx(Link, { className: "button button--success", to: `/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(resetToken)}`, children: "Vai al reset" })] })) : null] }) }));
}
//# sourceMappingURL=forgot-password-page.js.map