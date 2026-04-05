/**
 * RagChatPanel — Interactive RAG chat panel for querying the current document.
 *
 * Features:
 *   - Streaming LLM responses via OpenAI-compatible endpoint
 *   - Citations [N] rendered as safe React components (no dangerouslySetInnerHTML)
 *   - Vector search via DocumentIndexer + full-text fallback
 *   - Pressure level integrated into system prompt
 *   - Abort streaming via AbortController
 */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useEditorStore, type RagChatMessage } from './editor-store';
import { streamChatCompletion } from '../../lib/llm-client';
import { loadLLMConfig } from '../../lib/llm-config-store';
import type { DocumentIndexer } from './document-indexer';
import { buildLocalRagContext } from './rag-context';

// ── Citation-safe inline rendering ──────────────────────────────────────────

/**
 * Parse text containing [N] citation markers and **bold** into React nodes.
 * NO dangerouslySetInnerHTML — purely React components.
 */
function renderCitationText(
  text: string,
  onCitationClick?: (index: number) => void,
): ReactNode[] {
  // Split on citation markers [N] and bold **text**
  const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const citationMatch = part.match(/^\[(\d+)\]$/);
    if (citationMatch) {
      const idx = Number(citationMatch[1]);
      return (
        <button
          key={i}
          className="rag-chat__citation-inline"
          onClick={() => onCitationClick?.(idx)}
          title={`Citazione [${idx}]`}
        >
          [{idx}]
        </button>
      );
    }
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      return <strong key={i}>{boldMatch[1]}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Pressure level → prompt modifier ────────────────────────────────────────

const PRESSURE_PROMPTS: Record<number, string> = {
  1: 'Rispondi in modo gentile e incoraggiante, evitando critiche dirette.',
  2: 'Rispondi in modo chiaro e bilanciato, segnalando solo problemi evidenti.',
  3: 'Rispondi in modo analitico, evidenziando sia punti di forza che debolezze.',
  4: 'Rispondi in modo incisivo e diretto, evidenziando ogni problema riscontrato.',
  5: 'Rispondi in modo critico e approfondito, senza risparmiare critiche costruttive.',
};

// ── Component ───────────────────────────────────────────────────────────────

export interface RagChatPanelProps {
  documentId: string;
  indexer: DocumentIndexer | null;
  encryptionKey: CryptoKey;
}

export function RagChatPanel({ documentId, indexer, encryptionKey }: RagChatPanelProps) {
  const messages = useEditorStore((state) => state.ragChatMessages);
  const addMessage = useEditorStore((state) => state.addRagChatMessage);
  const clearMessages = useEditorStore((state) => state.clearRagChatMessages);
  const pressureLevel = useEditorStore((state) => state.pressureLevel);
  const modelStatus = useEditorStore((state) => state.modelStatus);
  const modelProgress = useEditorStore((state) => state.modelDownloadProgress);

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = input.trim();
    if (!query || streaming) return;

    setError(null);

    // Load LLM config
    let config;
    try {
      config = await loadLLMConfig(encryptionKey);
    } catch {
      setError('Impossibile decifrare la configurazione LLM.');
      return;
    }
    if (!config) {
      setError('Configura l\'API LLM nelle impostazioni prima di usare la chat.');
      return;
    }

    // Add user message
    const userMsg: RagChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
      citations: [],
    };
    addMessage(userMsg);
    setInput('');
    setStreaming(true);

    // Placeholder AI message
    const aiMsgId = crypto.randomUUID();
    addMessage({ id: aiMsgId, role: 'ai', content: '', citations: [] });

    try {
      // 1. Retrieve relevant chunks
      let chunks: Array<{ text: string }> = [];
      try {
        if (indexer && indexer.indexSize > 0) {
          chunks = await indexer.search(query, 5, 0.3);
        }
      } catch { /* fallback below */ }

      if (chunks.length === 0) {
        try {
          const fullTextChunks = await buildLocalRagContext(query, encryptionKey, documentId);
          chunks = fullTextChunks.map((text) => ({ text }));
        } catch { /* no context available */ }
      }

      if (chunks.length === 0) {
        updateAiMessage(aiMsgId, 'Il documento non contiene ancora contenuto indicizzato. Attendi l\'indicizzazione automatica o scrivi più testo.');
        return;
      }

      // 2. Build system prompt with citations + pressure
      const contextBlock = chunks
        .map((c, i) => `[${i + 1}] ${c.text}`)
        .join('\n\n');

      const pressureInstruction = PRESSURE_PROMPTS[pressureLevel] ?? PRESSURE_PROMPTS[3];

      const systemPrompt = `Sei un assistente narrativo che aiuta l'utente a esplorare e migliorare il proprio testo.
${pressureInstruction}
Rispondi in modo conciso: massimo 3-4 frasi salvo esplicita richiesta di dettaglio.
Rispondi SOLO basandoti sui brani del documento forniti come contesto.
Cita i brani usando riferimenti numerici [N] quando appropriato.
Se non trovi informazioni rilevanti nel contesto, dillo chiaramente.

CONTESTO DAL DOCUMENTO:
${contextBlock}`;

      // 3. Stream LLM response
      const controller = new AbortController();
      abortRef.current = controller;
      let accumulated = '';

      for await (const token of streamChatCompletion(config, systemPrompt, query, controller.signal)) {
        accumulated += token;
        updateAiMessage(aiMsgId, accumulated);
      }

      // Extract citation texts for interactive pills
      const citations = chunks.map((c) =>
        c.text.slice(0, 80) + (c.text.length > 80 ? '…' : ''),
      );
      updateAiMessage(aiMsgId, accumulated, citations);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const text = (err as Error).message ?? 'Errore sconosciuto';
        updateAiMessage(aiMsgId, `Errore: ${text}`);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function updateAiMessage(id: string, content: string, citations?: string[]) {
    useEditorStore.setState((state) => ({
      ragChatMessages: state.ragChatMessages.map((msg) =>
        msg.id === id
          ? { ...msg, content, ...(citations !== undefined ? { citations } : {}) }
          : msg,
      ),
    }));
  }

  const indexStatus = indexer
    ? indexer.indexSize > 0
      ? 'indexed'
      : indexer.isIndexing
        ? 'indexing'
        : 'idle'
    : 'idle';

  const statusLabel: Record<string, string> = {
    idle: 'Non indicizzato',
    indexing: 'Indicizzazione…',
    indexed: `Indicizzato (${indexer?.indexSize ?? 0})`,
  };

  return (
    <div className="rag-chat">
      <div className="rag-chat__header">
        <div className="rag-chat__header-row">
          <span className="rag-chat__title">RAG Assistant</span>
          <span className={`rag-chat__status rag-chat__status--${indexStatus}`}>
            {statusLabel[indexStatus]}
          </span>
          <button
            className="button button--ghost rag-chat__clear"
            onClick={clearMessages}
            type="button"
          >
            Clear
          </button>
        </div>
        {modelStatus === 'loading' && (
          <div className="rag-chat__progress">
            <span className="muted">Download modello AI… {Math.round(modelProgress * 100)}%</span>
            <div className="rag-chat__progress-bar">
              <div
                className="rag-chat__progress-fill"
                style={{ width: `${Math.round(modelProgress * 100)}%` }}
              />
            </div>
          </div>
        )}
        {modelStatus === 'error' && (
          <p className="error" style={{ fontSize: '0.8rem', margin: 0 }}>
            Errore caricamento modello AI
          </p>
        )}
      </div>

      <div className="rag-chat__messages" aria-live="polite">
        {error && (
          <div className="rag-chat__error">{error}</div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`rag-chat__message rag-chat__message--${msg.role}`}
          >
            <p className="rag-chat__message-role">
              {msg.role === 'user' ? 'Tu' : 'AI'}
            </p>
            <div className="rag-chat__message-content">
              {msg.role === 'ai'
                ? renderCitationText(msg.content)
                : msg.content}
            </div>
            {msg.citations.length > 0 && (
              <div className="rag-chat__citations">
                {msg.citations.map((cite, i) => (
                  <span key={i} className="rag-chat__citation" title={cite}>
                    [{i + 1}] {cite}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="rag-chat__input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
          placeholder={indexStatus === 'indexed' ? 'Chiedi al documento…' : 'Attendi indicizzazione…'}
          className="input"
        />
        {streaming ? (
          <button
            type="button"
            className="button button--danger"
            onClick={() => abortRef.current?.abort()}
            title="Interrompi"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="button"
            disabled={!input.trim()}
          >
            Invia
          </button>
        )}
      </form>
    </div>
  );
}
