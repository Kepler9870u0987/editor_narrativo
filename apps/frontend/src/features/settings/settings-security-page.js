import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { createCryptoWorkerClient } from '../../lib/crypto-worker';
import { rewrapUnlockedKeyMaterial } from '../../lib/keys';
import { ApiError } from '../../lib/http';
import { createPasskeyCredential, isWebAuthnSupported } from '../../lib/webauthn';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import { useUnlockStore } from '../unlock/unlock-store';
import { SettingsNav } from './settings-nav';
export function SettingsSecurityPage() {
    const accessToken = useAuthSessionStore((state) => state.accessToken);
    const unlocked = useUnlockStore((state) => state.unlocked);
    const setMaterial = useUnlockStore((state) => state.setMaterial);
    const worker = useMemo(() => createCryptoWorkerClient(), []);
    const [totpSecret, setTotpSecret] = useState(null);
    const [totpUri, setTotpUri] = useState(null);
    const [totpCode, setTotpCode] = useState('');
    const [recoveryKit, setRecoveryKit] = useState(null);
    const [importKit, setImportKit] = useState('');
    const [newUnlockSecret, setNewUnlockSecret] = useState('');
    const [newUnlockSecretConfirm, setNewUnlockSecretConfirm] = useState('');
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => () => worker.terminate(), [worker]);
    async function withAction(action) {
        setError(null);
        setMessage(null);
        try {
            await action();
        }
        catch (error) {
            setError(error instanceof ApiError
                ? error.message
                : error instanceof Error
                    ? error.message
                    : 'Operazione non riuscita');
        }
    }
    return (_jsx(PageShell, { title: "Sicurezza", subtitle: "Qui separiamo MFA, passkey, recovery kit e rotazione delle chiavi locali.", aside: _jsx(SettingsNav, {}), children: _jsxs("div", { className: "stack", children: [_jsxs("div", { className: "panel stack", children: [_jsx("h2", { children: "Autenticazione a due fattori" }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button", disabled: !accessToken, onClick: () => void withAction(async () => {
                                    if (!accessToken) {
                                        return;
                                    }
                                    const setup = await accountApi.startTotp(accessToken);
                                    setTotpSecret(setup.secret);
                                    setTotpUri(setup.otpauthUri);
                                    setMessage('Segreto TOTP generato. Inserisci un codice dall’app autenticatore.');
                                }), type: "button", children: "Avvia setup TOTP" }) }), totpSecret ? _jsx("code", { children: totpSecret }) : null, totpUri ? _jsx("p", { className: "muted", children: totpUri }) : null, _jsxs("div", { className: "button-row", children: [_jsx("input", { className: "input", placeholder: "Codice TOTP", value: totpCode, onChange: (event) => setTotpCode(event.target.value) }), _jsx("button", { className: "button button--success", disabled: !accessToken || !totpCode.trim(), onClick: () => void withAction(async () => {
                                        if (!accessToken) {
                                            return;
                                        }
                                        const result = await accountApi.verifyTotp(accessToken, totpCode.trim());
                                        setMessage(`TOTP attivato. Recovery codes: ${result.recoveryCodes.join(', ')}`);
                                        setTotpCode('');
                                    }), type: "button", children: "Conferma TOTP" })] })] }), _jsxs("div", { className: "panel stack", children: [_jsx("h2", { children: "Passkey" }), _jsx("p", { className: "muted", children: "Le passkey proteggono il login account. Lo sblocco dei dati resta separato." }), isWebAuthnSupported() ? (_jsx("button", { className: "button", disabled: !accessToken, onClick: () => void withAction(async () => {
                                if (!accessToken) {
                                    return;
                                }
                                const start = await accountApi.startPasskeyRegistration(accessToken);
                                const credential = await createPasskeyCredential(start);
                                await accountApi.finishPasskeyRegistration(accessToken, { credential });
                                setMessage('Passkey registrata correttamente');
                            }), type: "button", children: "Registra passkey" })) : (_jsx("p", { className: "muted", children: "WebAuthn non disponibile in questo browser." }))] }), _jsxs("div", { className: "panel stack", children: [_jsx("h2", { children: "Recovery kit" }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button", disabled: !accessToken, onClick: () => void withAction(async () => {
                                    if (!accessToken) {
                                        return;
                                    }
                                    const exported = await accountApi.exportRecoveryKit(accessToken);
                                    setRecoveryKit(exported.recoveryKit);
                                    setMessage('Recovery kit esportato');
                                }), type: "button", children: "Esporta recovery kit" }) }), recoveryKit ? _jsx("textarea", { className: "textarea", readOnly: true, value: recoveryKit }) : null, _jsxs("label", { className: "label", children: ["Importa recovery kit", _jsx("textarea", { className: "textarea", value: importKit, onChange: (event) => setImportKit(event.target.value) })] }), _jsx("button", { className: "button button--success", disabled: !accessToken || !importKit.trim(), onClick: () => void withAction(async () => {
                                if (!accessToken) {
                                    return;
                                }
                                const parsed = JSON.parse(importKit);
                                const material = await accountApi.importRecoveryKit(accessToken, {
                                    wrappedDek: parsed.wrappedDek,
                                    argon2Salt: parsed.argon2Salt,
                                    wrappedSigningSecretKey: parsed.wrappedSigningSecretKey,
                                    signingPublicKey: parsed.signingPublicKey,
                                    kekVersion: parsed.kekVersion,
                                    recoveryKit: parsed.recoveryKit ?? JSON.stringify(parsed),
                                });
                                setMaterial(material);
                                setMessage('Recovery kit importato. Ora puoi andare su unlock per sbloccare i dati.');
                            }), type: "button", children: "Importa recovery kit" })] }), _jsxs("div", { className: "panel stack", children: [_jsx("h2", { children: "Rotazione unlock secret" }), _jsxs("p", { className: "muted", children: ["Questa operazione richiede le chiavi gi\u00E0 sbloccate in memoria. Se sei bloccato, vai a", ' ', _jsx(Link, { to: "/unlock", children: "Unlock" }), "."] }), _jsxs("div", { className: "two-column", children: [_jsxs("label", { className: "label", children: ["Nuovo unlock secret", _jsx("input", { className: "input", value: newUnlockSecret, onChange: (event) => setNewUnlockSecret(event.target.value), type: "password" })] }), _jsxs("label", { className: "label", children: ["Conferma", _jsx("input", { className: "input", value: newUnlockSecretConfirm, onChange: (event) => setNewUnlockSecretConfirm(event.target.value), type: "password" })] })] }), _jsx("button", { className: "button", disabled: !accessToken || !unlocked, onClick: () => void withAction(async () => {
                                if (!accessToken || !unlocked) {
                                    throw new Error('Sblocca prima i dati locali');
                                }
                                if (newUnlockSecret.length < 12 || newUnlockSecret !== newUnlockSecretConfirm) {
                                    throw new Error('Il nuovo unlock secret non è valido o non coincide');
                                }
                                const payload = await rewrapUnlockedKeyMaterial(unlocked, newUnlockSecret, worker);
                                const material = await accountApi.rotateUnlock(accessToken, payload);
                                setMaterial(material);
                                setNewUnlockSecret('');
                                setNewUnlockSecretConfirm('');
                                setMessage('Unlock secret ruotato correttamente');
                            }), type: "button", children: "Ruota unlock secret" })] }), error ? _jsx("p", { className: "error", children: error }) : null, message ? _jsx("p", { className: "success", children: message }) : null] }) }));
}
//# sourceMappingURL=settings-security-page.js.map