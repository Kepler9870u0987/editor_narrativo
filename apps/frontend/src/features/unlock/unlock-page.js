import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { createCryptoWorkerClient } from '../../lib/crypto-worker';
import { createBootstrapKeyMaterial, unlockWrappedKeyMaterial, } from '../../lib/keys';
import { ApiError } from '../../lib/http';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import { useUnlockStore } from './unlock-store';
export function UnlockPage() {
    const navigate = useNavigate();
    const accessToken = useAuthSessionStore((state) => state.accessToken);
    const user = useAuthSessionStore((state) => state.user);
    const setAnonymous = useAuthSessionStore((state) => state.setAnonymous);
    const material = useUnlockStore((state) => state.material);
    const setMaterial = useUnlockStore((state) => state.setMaterial);
    const setUnlocking = useUnlockStore((state) => state.setUnlocking);
    const setUnlocked = useUnlockStore((state) => state.setUnlocked);
    const lock = useUnlockStore((state) => state.lock);
    const worker = useMemo(() => createCryptoWorkerClient(), []);
    const [mode, setMode] = useState('loading');
    const [unlockSecret, setUnlockSecret] = useState('');
    const [unlockSecretConfirm, setUnlockSecretConfirm] = useState('');
    const [recoveryKit, setRecoveryKit] = useState('');
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => () => worker.terminate(), [worker]);
    useEffect(() => {
        if (!accessToken) {
            return;
        }
        let cancelled = false;
        setMode('loading');
        setError(null);
        accountApi
            .getKeyMaterial(accessToken)
            .then((storedMaterial) => {
            if (cancelled) {
                return;
            }
            setMaterial(storedMaterial);
            setMode('unlock');
        })
            .catch((error) => {
            if (cancelled) {
                return;
            }
            if (error instanceof ApiError && error.status === 404) {
                setMaterial(null);
                setMode('bootstrap');
                return;
            }
            setError(error instanceof ApiError ? error.message : 'Impossibile caricare il materiale cifrato');
        });
        return () => {
            cancelled = true;
        };
    }, [accessToken, setMaterial]);
    async function finishUnlock(secret) {
        if (!material) {
            throw new Error('Materiale cifrato non disponibile');
        }
        setUnlocking();
        const unlocked = await unlockWrappedKeyMaterial(material, secret, worker);
        setUnlocked(unlocked);
        navigate('/app', { replace: true });
    }
    async function handleUnlock(event) {
        event.preventDefault();
        if (!material) {
            return;
        }
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            await finishUnlock(unlockSecret);
        }
        catch (error) {
            lock();
            setError(error instanceof Error ? error.message : 'Unlock non riuscito');
        }
        finally {
            setBusy(false);
        }
    }
    async function handleBootstrap(event) {
        event.preventDefault();
        if (!accessToken) {
            return;
        }
        if (unlockSecret.length < 12 || unlockSecret !== unlockSecretConfirm) {
            setError('L’unlock secret deve essere di almeno 12 caratteri e coincidere con la conferma');
            return;
        }
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            const payload = await createBootstrapKeyMaterial(unlockSecret, worker);
            const storedMaterial = await accountApi.bootstrapKeys(accessToken, payload);
            setMaterial(storedMaterial);
            await finishUnlock(unlockSecret);
        }
        catch (error) {
            setError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Bootstrap non riuscito');
        }
        finally {
            setBusy(false);
        }
    }
    async function handleImportRecoveryKit() {
        if (!accessToken || !recoveryKit.trim()) {
            return;
        }
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            const parsed = JSON.parse(recoveryKit);
            const storedMaterial = await accountApi.importRecoveryKit(accessToken, {
                wrappedDek: parsed.wrappedDek,
                argon2Salt: parsed.argon2Salt,
                wrappedSigningSecretKey: parsed.wrappedSigningSecretKey,
                signingPublicKey: parsed.signingPublicKey,
                kekVersion: parsed.kekVersion,
                recoveryKit: parsed.recoveryKit ?? JSON.stringify(parsed),
            });
            setMaterial(storedMaterial);
            setMode('unlock');
            setMessage('Recovery kit importato. Ora puoi usare il tuo unlock secret.');
        }
        catch (error) {
            setError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Import recovery kit non riuscito');
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx(PageShell, { title: "Unlock locale", subtitle: "L\u2019account di {user?.email} \u00E8 attivo. Ora sblocchiamo solo in memoria la DEK e la chiave di firma.", aside: _jsx("div", { className: "button-row", children: _jsx("button", { className: "button button--ghost", onClick: async () => {
                    try {
                        await accountApi.logout(accessToken);
                    }
                    finally {
                        lock();
                        setAnonymous();
                        navigate('/login', { replace: true });
                    }
                }, type: "button", children: "Torna al login" }) }), children: _jsxs("div", { className: "stack", children: [mode === 'loading' ? _jsx("p", { className: "muted", children: "Caricamento del materiale cifrato..." }) : null, mode === 'unlock' ? (_jsxs("form", { className: "form-grid", onSubmit: handleUnlock, children: [_jsxs("label", { className: "label", children: ["Unlock secret", _jsx("input", { className: "input", value: unlockSecret, onChange: (event) => setUnlockSecret(event.target.value), type: "password", required: true })] }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button", disabled: busy || !material, type: "submit", children: busy ? 'Sblocco...' : 'Sblocca dati' }) })] })) : null, mode === 'bootstrap' ? (_jsxs("form", { className: "form-grid", onSubmit: handleBootstrap, children: [_jsx("p", { className: "muted", children: "Questo account non ha ancora materiale cifrato. Creiamo ora la DEK locale, la chiave di firma e il recovery kit." }), _jsxs("label", { className: "label", children: ["Unlock secret", _jsx("input", { className: "input", value: unlockSecret, onChange: (event) => setUnlockSecret(event.target.value), type: "password", minLength: 12, required: true })] }), _jsxs("label", { className: "label", children: ["Conferma unlock secret", _jsx("input", { className: "input", value: unlockSecretConfirm, onChange: (event) => setUnlockSecretConfirm(event.target.value), type: "password", minLength: 12, required: true })] }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button button--success", disabled: busy, type: "submit", children: busy ? 'Bootstrap...' : 'Bootstrap chiavi locali' }) })] })) : null, _jsxs("div", { className: "panel stack", children: [_jsx("h2", { children: "Recovery kit" }), _jsx("p", { className: "muted", children: "Se hai gi\u00E0 un kit esportato puoi reimportarlo senza rigenerare le chiavi del documento." }), _jsx("textarea", { className: "textarea", value: recoveryKit, onChange: (event) => setRecoveryKit(event.target.value) }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button button--ghost", disabled: busy || !recoveryKit.trim(), onClick: () => void handleImportRecoveryKit(), type: "button", children: "Importa recovery kit" }) })] }), error ? _jsx("p", { className: "error", children: error }) : null, message ? _jsx("p", { className: "success", children: message }) : null] }) }));
}
//# sourceMappingURL=unlock-page.js.map