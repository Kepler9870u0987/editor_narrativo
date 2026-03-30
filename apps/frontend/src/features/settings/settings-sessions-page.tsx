import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AccountSessionSummary } from '@editor-narrativo/account-shared';
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
  const [sessions, setSessions] = useState<AccountSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadSessions() {
    if (!accessToken) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSessions(await accountApi.listSessions(accessToken));
    } catch (error) {
      setError(error instanceof ApiError ? error.message : 'Impossibile caricare le sessioni');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, [accessToken]);

  return (
    <PageShell
      title="Sessioni attive"
      subtitle="Puoi revocare singoli device o chiudere tutte le sessioni server-side."
      aside={<SettingsNav />}
    >
      <div className="stack">
        <div className="button-row">
          <button className="button button--ghost" onClick={() => void loadSessions()} type="button">
            Aggiorna
          </button>
          <button
            className="button button--danger"
            disabled={!accessToken}
            onClick={async () => {
              if (!accessToken) {
                return;
              }
              await accountApi.logoutAll(accessToken);
              lock();
              setAnonymous();
              navigate('/login', { replace: true });
            }}
            type="button"
          >
            Logout globale
          </button>
        </div>
        {loading ? <p className="muted">Caricamento sessioni...</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="list">
          {sessions.map((session) => (
            <article className={`list-item${session.isCurrent ? ' list-item--active' : ''}`} key={session.id}>
              <div className="stack">
                <div className="button-row">
                  <span className="pill">{session.isCurrent ? 'Sessione corrente' : 'Altra sessione'}</span>
                  <span className="pill">{session.deviceName ?? 'Device senza nome'}</span>
                </div>
                <p className="muted">{session.userAgent ?? 'User-Agent non disponibile'}</p>
                <p className="muted">Creata: {new Date(session.createdAt).toLocaleString()}</p>
                <p className="muted">Ultima attività: {new Date(session.lastSeenAt).toLocaleString()}</p>
                {!session.revokedAt ? (
                  <div className="button-row">
                    <button
                      className="button button--danger"
                      disabled={!accessToken}
                      onClick={async () => {
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
                      }}
                      type="button"
                    >
                      Revoca sessione
                    </button>
                  </div>
                ) : (
                  <p className="error">Revocata: {session.revocationReason ?? 'Motivo non disponibile'}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
