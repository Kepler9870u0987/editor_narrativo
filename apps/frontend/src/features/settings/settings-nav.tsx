import { Link, useNavigate } from 'react-router-dom';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import { useUnlockStore } from '../unlock/unlock-store';

export function SettingsNav() {
  const navigate = useNavigate();
  const accessToken = useAuthSessionStore((state) => state.accessToken);
  const setAnonymous = useAuthSessionStore((state) => state.setAnonymous);
  const lock = useUnlockStore((state) => state.lock);

  return (
    <div className="button-row">
      <Link className="button button--ghost" to="/app">
        Editor
      </Link>
      <Link className="button button--ghost" to="/settings/profile">
        Profilo
      </Link>
      <Link className="button button--ghost" to="/settings/sessions">
        Sessioni
      </Link>
      <Link className="button button--ghost" to="/settings/security">
        Sicurezza
      </Link>
      <button
        className="button button--danger"
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
        Logout
      </button>
    </div>
  );
}
