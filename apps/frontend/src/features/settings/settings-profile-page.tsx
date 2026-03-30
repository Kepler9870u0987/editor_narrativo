import { useEffect, useState, type FormEvent } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
  }, [user?.displayName]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
    } catch (error) {
      setError(error instanceof ApiError ? error.message : 'Aggiornamento non riuscito');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title="Profilo account"
      subtitle="Qui gestisci identità e policy di accesso, non le chiavi locali."
      aside={<SettingsNav />}
    >
      <div className="stack">
        <div className="panel stack">
          <p><strong>Email:</strong> {user?.email}</p>
          <p><strong>Stato:</strong> {user?.status}</p>
          <p><strong>Email verificata:</strong> {user?.emailVerifiedAt ? 'Sì' : 'No'}</p>
          <p><strong>MFA:</strong> {user?.mfaEnabled ? 'Abilitata' : 'Non abilitata'}</p>
        </div>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="label">
            Nome visualizzato
            <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <div className="button-row">
            <button className="button" disabled={saving || !accessToken} type="submit">
              {saving ? 'Salvataggio...' : 'Salva profilo'}
            </button>
          </div>
        </form>
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
      </div>
    </PageShell>
  );
}
