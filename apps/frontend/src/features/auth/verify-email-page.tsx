import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from './account-api';

export function VerifyEmailPage() {
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await accountApi.verifyEmail({ email, token });
      setSuccess('Email verificata. Ora puoi fare login e poi sbloccare i dati locali.');
    } catch (error) {
      setError(error instanceof ApiError ? error.message : 'Verifica non riuscita');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      title="Verifica la tua email"
      subtitle="Attiviamo l’account prima di consentire il bootstrap zero-knowledge."
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
          Token di verifica
          <input className="input" value={token} onChange={(event) => setToken(event.target.value)} required />
        </label>
        <div className="button-row">
          <button className="button" disabled={submitting} type="submit">
            {submitting ? 'Verifica...' : 'Verifica email'}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
      </form>
    </PageShell>
  );
}
