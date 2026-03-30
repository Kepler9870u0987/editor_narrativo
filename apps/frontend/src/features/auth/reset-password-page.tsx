import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from './account-api';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const defaults = useMemo(
    () => ({
      email: params.get('email') ?? '',
      token: params.get('token') ?? '',
    }),
    [params],
  );
  const [email, setEmail] = useState(defaults.email);
  const [token, setToken] = useState(defaults.token);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await accountApi.resetPassword({ email, token, newPassword });
      setSuccess('Password aggiornata. Le sessioni esistenti verranno invalidate.');
    } catch (error) {
      setError(error instanceof ApiError ? error.message : 'Reset non riuscito');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      title="Imposta una nuova password"
      subtitle="La password protegge l’accesso all’account. Lo sblocco dati resta separato."
      aside={
        <div className="button-row">
          <Link className="button button--ghost" to="/login">
            Torna al login
          </Link>
        </div>
      }
    >
      <form className="form-grid" onSubmit={handleSubmit}>
        <label className="label">
          Email
          <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label className="label">
          Token
          <input className="input" value={token} onChange={(event) => setToken(event.target.value)} required />
        </label>
        <label className="label">
          Nuova password
          <input className="input" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" minLength={12} required />
        </label>
        <div className="button-row">
          <button className="button" disabled={submitting} type="submit">
            {submitting ? 'Aggiornamento...' : 'Aggiorna password'}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
      </form>
    </PageShell>
  );
}
