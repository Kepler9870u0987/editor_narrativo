import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from './account-api';
export function VerifyEmailPage() {
    const [params] = useSearchParams();
    const defaults = useMemo(() => ({
        email: params.get('email') ?? '',
        token: params.get('token') ?? '',
    }), [params]);
    const [email, setEmail] = useState(defaults.email);
    const [token, setToken] = useState(defaults.token);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setSuccess(null);
        try {
            await accountApi.verifyEmail({ email, token });
            setSuccess('Email verificata. Ora puoi fare login e poi sbloccare i dati locali.');
        }
        catch (error) {
            setError(error instanceof ApiError ? error.message : 'Verifica non riuscita');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx(PageShell, { title: "Verifica la tua email", subtitle: "Attiviamo l\u2019account prima di consentire il bootstrap zero-knowledge.", aside: _jsx("div", { className: "button-row", children: _jsx(Link, { className: "button button--ghost", to: "/login", children: "Torna al login" }) }), children: _jsxs("form", { className: "form-grid", onSubmit: handleSubmit, children: [_jsxs("label", { className: "label", children: ["Email", _jsx("input", { className: "input", value: email, onChange: (event) => setEmail(event.target.value), type: "email", required: true })] }), _jsxs("label", { className: "label", children: ["Token di verifica", _jsx("input", { className: "input", value: token, onChange: (event) => setToken(event.target.value), required: true })] }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button", disabled: submitting, type: "submit", children: submitting ? 'Verifica...' : 'Verifica email' }) }), error ? _jsx("p", { className: "error", children: error }) : null, success ? _jsx("p", { className: "success", children: success }) : null] }) }));
}
//# sourceMappingURL=verify-email-page.js.map