import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { createCryptoWorkerClient } from '../../lib/crypto-worker';
import {
  createBootstrapKeyMaterial,
  unlockWrappedKeyMaterial,
} from '../../lib/keys';
import { ApiError } from '../../lib/http';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import { useUnlockStore } from './unlock-store';

type UnlockMode = 'loading' | 'unlock' | 'bootstrap';

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
  const workerRef = useRef<ReturnType<typeof createCryptoWorkerClient> | null>(null);
  function getWorker() {
    if (!workerRef.current) {
      workerRef.current = createCryptoWorkerClient();
    }
    return workerRef.current;
  }
  const [mode, setMode] = useState<UnlockMode>('loading');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [unlockSecretConfirm, setUnlockSecretConfirm] = useState('');
  const [recoveryKit, setRecoveryKit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

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

  async function finishUnlock(secret: string) {
    if (!material) {
      throw new Error('Materiale cifrato non disponibile');
    }
    setUnlocking();
    const unlocked = await unlockWrappedKeyMaterial(material, secret, getWorker());
    setUnlocked(unlocked);
    navigate('/app', { replace: true });
  }

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!material) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await finishUnlock(unlockSecret);
    } catch (error) {
      lock();
      setError(error instanceof Error ? error.message : 'Unlock non riuscito');
    } finally {
      setBusy(false);
    }
  }

  async function handleBootstrap(event: FormEvent<HTMLFormElement>) {
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
      const payload = await createBootstrapKeyMaterial(unlockSecret, getWorker());
      const storedMaterial = await accountApi.bootstrapKeys(accessToken, payload);
      setMaterial(storedMaterial);
      await finishUnlock(unlockSecret);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Bootstrap non riuscito');
    } finally {
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
      const parsed = JSON.parse(recoveryKit) as {
        wrappedDek: string;
        argon2Salt: string;
        wrappedSigningSecretKey: string;
        signingPublicKey: string;
        kekVersion: number;
        recoveryKit?: string;
      };
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
    } catch (error) {
      setError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Import recovery kit non riuscito');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      title="Unlock locale"
      subtitle="L’account di {user?.email} è attivo. Ora sblocchiamo solo in memoria la DEK e la chiave di firma."
      aside={
        <div className="button-row">
          <button
            className="button button--ghost"
            onClick={async () => {
              try {
                await accountApi.logout(accessToken);
              } finally {
                lock();
                setAnonymous();
                navigate('/login', { replace: true });
              }
            }}
            type="button"
          >
            Torna al login
          </button>
        </div>
      }
    >
      <div className="stack">
        {mode === 'loading' ? <p className="muted">Caricamento del materiale cifrato...</p> : null}

        {mode === 'unlock' ? (
          <form className="form-grid" onSubmit={handleUnlock}>
            <label className="label">
              Unlock secret
              <input className="input" value={unlockSecret} onChange={(event) => setUnlockSecret(event.target.value)} type="password" required />
            </label>
            <div className="button-row">
              <button className="button" disabled={busy || !material} type="submit">
                {busy ? 'Sblocco...' : 'Sblocca dati'}
              </button>
            </div>
          </form>
        ) : null}

        {mode === 'bootstrap' ? (
          <form className="form-grid" onSubmit={handleBootstrap}>
            <p className="muted">
              Questo account non ha ancora materiale cifrato. Creiamo ora la DEK locale, la chiave di firma e il recovery kit.
            </p>
            <label className="label">
              Unlock secret
              <input className="input" value={unlockSecret} onChange={(event) => setUnlockSecret(event.target.value)} type="password" minLength={12} required />
            </label>
            <label className="label">
              Conferma unlock secret
              <input className="input" value={unlockSecretConfirm} onChange={(event) => setUnlockSecretConfirm(event.target.value)} type="password" minLength={12} required />
            </label>
            <div className="button-row">
              <button className="button button--success" disabled={busy} type="submit">
                {busy ? 'Bootstrap...' : 'Bootstrap chiavi locali'}
              </button>
            </div>
          </form>
        ) : null}

        <div className="panel stack">
          <h2>Recovery kit</h2>
          <p className="muted">
            Se hai già un kit esportato puoi reimportarlo senza rigenerare le chiavi del documento.
          </p>
          <textarea className="textarea" value={recoveryKit} onChange={(event) => setRecoveryKit(event.target.value)} />
          <div className="button-row">
            <button className="button button--ghost" disabled={busy || !recoveryKit.trim()} onClick={() => void handleImportRecoveryKit()} type="button">
              Importa recovery kit
            </button>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="success">{message}</p> : null}
      </div>
    </PageShell>
  );
}
