import { useEffect, useState, type FormEvent } from 'react';
import { PageShell } from '../../components/page-shell';
import { useUnlockStore } from '../unlock/unlock-store';
import { SettingsNav } from './settings-nav';
import { saveLLMConfig, loadLLMConfig, clearLLMConfig } from '../../lib/llm-config-store';
import { testLLMConnection, type LLMConfig } from '../../lib/llm-client';

export function SettingsLLMPage() {
  const unlocked = useUnlockStore((state) => state.unlocked);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!unlocked) return;
    loadLLMConfig(unlocked.subKeys.textEncryptionKey)
      .then((config) => {
        if (config) {
          setBaseUrl(config.baseUrl);
          setApiKey(config.apiKey);
          setModel(config.model);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [unlocked]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlocked || !baseUrl.trim() || !apiKey.trim() || !model.trim()) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const config: LLMConfig = {
        provider: 'openai-compatible',
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      };
      await saveLLMConfig(config, unlocked.subKeys.textEncryptionKey);
      setSuccess('Configurazione LLM salvata (cifrata)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) return;

    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const config: LLMConfig = {
        provider: 'openai-compatible',
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      };
      const reply = await testLLMConnection(config);
      setSuccess(`Connessione riuscita. Risposta: "${reply}"`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test connessione non riuscito');
    } finally {
      setTesting(false);
    }
  }

  async function handleClear() {
    setError(null);
    setSuccess(null);
    await clearLLMConfig();
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setSuccess('Configurazione LLM rimossa');
  }

  if (!unlocked) {
    return (
      <PageShell title="Configurazione LLM" aside={<SettingsNav />}>
        <p className="muted">Sblocca il vault per gestire la configurazione LLM.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Configurazione LLM"
      subtitle="API key e config sono cifrate con AES-GCM e salvate localmente."
      aside={<SettingsNav />}
    >
      <div className="stack">
        {!loaded ? (
          <p className="muted">Caricamento configurazione...</p>
        ) : (
          <form className="form-grid" onSubmit={handleSave}>
            <label className="label">
              Base URL
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com"
              />
            </label>
            <label className="label">
              API Key
              <div className="button-row">
                <input
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                />
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? 'Nascondi' : 'Mostra'}
                </button>
              </div>
            </label>
            <label className="label">
              Modello
              <input
                className="input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
              />
            </label>
            <div className="button-row">
              <button
                className="button"
                type="submit"
                disabled={saving || !baseUrl.trim() || !apiKey.trim() || !model.trim()}
              >
                {saving ? 'Salvataggio...' : 'Salva configurazione'}
              </button>
              <button
                className="button button--ghost"
                type="button"
                disabled={testing || !baseUrl.trim() || !apiKey.trim() || !model.trim()}
                onClick={handleTest}
              >
                {testing ? 'Test in corso...' : 'Test connessione'}
              </button>
              <button
                className="button button--danger"
                type="button"
                onClick={handleClear}
              >
                Rimuovi
              </button>
            </div>
          </form>
        )}
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
      </div>
    </PageShell>
  );
}
