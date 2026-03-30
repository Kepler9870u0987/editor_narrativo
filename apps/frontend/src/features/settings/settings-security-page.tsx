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
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryKit, setRecoveryKit] = useState<string | null>(null);
  const [importKit, setImportKit] = useState('');
  const [newUnlockSecret, setNewUnlockSecret] = useState('');
  const [newUnlockSecretConfirm, setNewUnlockSecretConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => worker.terminate(), [worker]);

  async function withAction(action: () => Promise<void>) {
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Operazione non riuscita',
      );
    }
  }

  return (
    <PageShell
      title="Sicurezza"
      subtitle="Qui separiamo MFA, passkey, recovery kit e rotazione delle chiavi locali."
      aside={<SettingsNav />}
    >
      <div className="stack">
        <div className="panel stack">
          <h2>Autenticazione a due fattori</h2>
          <div className="button-row">
            <button
              className="button"
              disabled={!accessToken}
              onClick={() =>
                void withAction(async () => {
                  if (!accessToken) {
                    return;
                  }
                  const setup = await accountApi.startTotp(accessToken);
                  setTotpSecret(setup.secret);
                  setTotpUri(setup.otpauthUri);
                  setMessage('Segreto TOTP generato. Inserisci un codice dall’app autenticatore.');
                })
              }
              type="button"
            >
              Avvia setup TOTP
            </button>
          </div>
          {totpSecret ? <code>{totpSecret}</code> : null}
          {totpUri ? <p className="muted">{totpUri}</p> : null}
          <div className="button-row">
            <input
              className="input"
              placeholder="Codice TOTP"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
            />
            <button
              className="button button--success"
              disabled={!accessToken || !totpCode.trim()}
              onClick={() =>
                void withAction(async () => {
                  if (!accessToken) {
                    return;
                  }
                  const result = await accountApi.verifyTotp(accessToken, totpCode.trim());
                  setMessage(`TOTP attivato. Recovery codes: ${result.recoveryCodes.join(', ')}`);
                  setTotpCode('');
                })
              }
              type="button"
            >
              Conferma TOTP
            </button>
          </div>
        </div>

        <div className="panel stack">
          <h2>Passkey</h2>
          <p className="muted">Le passkey proteggono il login account. Lo sblocco dei dati resta separato.</p>
          {isWebAuthnSupported() ? (
            <button
              className="button"
              disabled={!accessToken}
              onClick={() =>
                void withAction(async () => {
                  if (!accessToken) {
                    return;
                  }
                  const start = await accountApi.startPasskeyRegistration(accessToken);
                  const credential = await createPasskeyCredential(start);
                  await accountApi.finishPasskeyRegistration(accessToken, { credential });
                  setMessage('Passkey registrata correttamente');
                })
              }
              type="button"
            >
              Registra passkey
            </button>
          ) : (
            <p className="muted">WebAuthn non disponibile in questo browser.</p>
          )}
        </div>

        <div className="panel stack">
          <h2>Recovery kit</h2>
          <div className="button-row">
            <button
              className="button"
              disabled={!accessToken}
              onClick={() =>
                void withAction(async () => {
                  if (!accessToken) {
                    return;
                  }
                  const exported = await accountApi.exportRecoveryKit(accessToken);
                  setRecoveryKit(exported.recoveryKit);
                  setMessage('Recovery kit esportato');
                })
              }
              type="button"
            >
              Esporta recovery kit
            </button>
          </div>
          {recoveryKit ? <textarea className="textarea" readOnly value={recoveryKit} /> : null}
          <label className="label">
            Importa recovery kit
            <textarea className="textarea" value={importKit} onChange={(event) => setImportKit(event.target.value)} />
          </label>
          <button
            className="button button--success"
            disabled={!accessToken || !importKit.trim()}
            onClick={() =>
              void withAction(async () => {
                if (!accessToken) {
                  return;
                }
                const parsed = JSON.parse(importKit) as {
                  wrappedDek: string;
                  argon2Salt: string;
                  wrappedSigningSecretKey: string;
                  signingPublicKey: string;
                  kekVersion: number;
                  recoveryKit?: string;
                };
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
              })
            }
            type="button"
          >
            Importa recovery kit
          </button>
        </div>

        <div className="panel stack">
          <h2>Rotazione unlock secret</h2>
          <p className="muted">
            Questa operazione richiede le chiavi già sbloccate in memoria. Se sei bloccato, vai a{' '}
            <Link to="/unlock">Unlock</Link>.
          </p>
          <div className="two-column">
            <label className="label">
              Nuovo unlock secret
              <input className="input" value={newUnlockSecret} onChange={(event) => setNewUnlockSecret(event.target.value)} type="password" />
            </label>
            <label className="label">
              Conferma
              <input className="input" value={newUnlockSecretConfirm} onChange={(event) => setNewUnlockSecretConfirm(event.target.value)} type="password" />
            </label>
          </div>
          <button
            className="button"
            disabled={!accessToken || !unlocked}
            onClick={() =>
              void withAction(async () => {
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
              })
            }
            type="button"
          >
            Ruota unlock secret
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="success">{message}</p> : null}
      </div>
    </PageShell>
  );
}
