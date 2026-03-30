import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/page-shell';
import { ApiError } from '../../lib/http';
import { accountApi } from './account-api';

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Richiesta non riuscita';
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await accountApi.register({
        email,
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      setVerificationToken(response.verificationToken ?? null);
      setSuccess('Account creato. Verifica l’email per attivarlo.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      title="Crea il tuo spazio narrativo"
      subtitle="L’account protegge identità e sessioni. Lo sblocco dei dati avviene in un secondo passaggio."
      aside={
        <div className="button-row">
          <Link className="button button--ghost" to="/login">
            Hai già un account?
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
          <label className="label">
            Password
            <input className="input" value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={12} required />
          </label>
          <label className="label">
            Nome visualizzato
            <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} type="text" />
          </label>
          <div className="button-row">
            <button className="button" disabled={submitting} type="submit">
              {submitting ? 'Creazione...' : 'Crea account'}
            </button>
          </div>
        </form>

        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}

        {verificationToken ? (
          <div className="panel stack">
            <p className="muted">
              Token di verifica esposto in sviluppo. In produzione arriverà via email.
            </p>
            <code>{verificationToken}</code>
            <div className="button-row">
              <button
                className="button button--success"
                type="button"
                onClick={() =>
                  navigate(
                    `/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(verificationToken)}`,
                  )
                }
              >
                Verifica subito
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
