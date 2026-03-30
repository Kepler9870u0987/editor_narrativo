import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from './account-api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const response = await accountApi.forgotPassword(email);
      setResetToken(response.resetToken ?? null);
      setMessage('Se l’account esiste, il reset è stato avviato.');
    } catch (error) {
      setError(error instanceof ApiError ? error.message : 'Reset non avviato');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      title="Reset password"
      subtitle="Questo flusso cambia l’accesso all’account, non la cifratura locale dei documenti."
      aside={
        <div className="button-row">
          <Link className="button button--ghost" to="/login">
            Torna al login
          </Link>
        </div>
      }
    >
      <div className="stack">
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="label">
            Email
            <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <div className="button-row">
            <button className="button" disabled={submitting} type="submit">
              {submitting ? 'Invio...' : 'Invia reset'}
            </button>
          </div>
        </form>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="success">{message}</p> : null}
        {resetToken ? (
          <div className="panel stack">
            <p className="muted">Token esposto in sviluppo:</p>
            <code>{resetToken}</code>
            <Link className="button button--success" to={`/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(resetToken)}`}>
              Vai al reset
            </Link>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
