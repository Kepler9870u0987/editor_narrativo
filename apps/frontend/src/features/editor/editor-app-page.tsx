import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { BlockNoteView, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import type { DocumentKind, DocumentSummary } from '@editor-narrativo/documents-shared';
import type { LogicCheckResponse } from '@editor-narrativo/shared';
import { appEnv } from '../../lib/env';
import { decryptJsonSnapshot, encryptJsonSnapshot } from '../../lib/keys';
import { editorDb, type LocalDocumentRecord } from '../../lib/storage';
import { complete } from '../logic-check/proxy-api';
import { LogicCheckStreamClient } from '../logic-check/logic-check-stream';
import { useUnlockStore } from '../unlock/unlock-store';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import {
  blocksToPlainText,
  collectNarrativeAlerts,
  collectNarrativeEntities,
  getMentionMenuItems,
  getNarrativeSlashMenuItems,
  narrativeSchema,
  type NarrativeBlockLike,
  type NarrativePartialBlock,
} from './blocknote-schema';
import { DocumentSyncEngine, type DocumentSyncState } from './document-sync';
import { documentsApi } from './documents-api';
import { useEditorStore } from './editor-store';
import { buildLocalRagContext } from './rag-context';
import { useCognitiveSignals } from './use-cognitive-signals';

const EMPTY_DOCUMENT: NarrativePartialBlock[] = [
  {
    type: 'paragraph',
    content: 'Inizia a scrivere qui.',
  },
];

async function loadLocalBlocks(
  documentId: string,
  key: CryptoKey,
): Promise<{ blocks: NarrativePartialBlock[]; localClock: number }> {
  const [snapshot, documentMeta] = await Promise.all([
    editorDb.snapshots.get(documentId),
    editorDb.documents.get(documentId),
  ]);

  if (!snapshot) {
    return {
      blocks: EMPTY_DOCUMENT,
      localClock: documentMeta?.latestClock ?? 0,
    };
  }

  try {
    return {
      blocks: await decryptJsonSnapshot<NarrativePartialBlock[]>(key, snapshot.encryptedBlob),
      localClock: documentMeta?.latestClock ?? 0,
    };
  } catch {
    return {
      blocks: EMPTY_DOCUMENT,
      localClock: 0,
    };
  }
}

async function persistLocalSnapshot(
  document: DocumentSummary,
  blocks: NarrativeBlockLike[],
  key: CryptoKey,
  latestClock: number,
  syncState: DocumentSyncState,
): Promise<void> {
  const now = new Date().toISOString();
  const encryptedBlob = await encryptJsonSnapshot(key, blocks);
  await editorDb.transaction('rw', editorDb.documents, editorDb.snapshots, async () => {
    await editorDb.snapshots.put({
      documentId: document.id,
      encryptedBlob,
      updatedAt: now,
    });
    await editorDb.documents.put({
      id: document.id,
      title: document.title,
      kind: document.kind,
      updatedAt: document.updatedAt,
      lastOpenedAt: now,
      archivedAt: document.archivedAt,
      latestClock,
      syncState,
    });
  });
}

function parseSerializedBlocks(serialized: string): NarrativePartialBlock[] {
  if (!serialized.trim()) {
    return EMPTY_DOCUMENT;
  }
  try {
    const parsed = JSON.parse(serialized) as NarrativePartialBlock[];
    return parsed.length > 0 ? parsed : EMPTY_DOCUMENT;
  } catch {
    return EMPTY_DOCUMENT;
  }
}

function replaceEditorContents(
  editor: ReturnType<typeof useCreateBlockNote<typeof narrativeSchema.blockSchema, typeof narrativeSchema.inlineContentSchema, typeof narrativeSchema.styleSchema>>,
  blocks: NarrativePartialBlock[],
): void {
  const currentIds = editor.document.map((block) => block.id);
  editor.replaceBlocks(currentIds, blocks.length > 0 ? blocks : EMPTY_DOCUMENT);
}

function NarrativeWorkspace({
  document,
  accessToken,
}: {
  document: DocumentSummary;
  accessToken: string;
}) {
  const unlocked = useUnlockStore((state) => state.unlocked);
  const setSyncStateStore = useEditorStore((state) => state.setSyncState);
  const setLogicCheckResult = useEditorStore((state) => state.setLogicCheckResult);
  const [initialBlocks, setInitialBlocks] = useState<NarrativePartialBlock[] | null>(null);
  const [localClock, setLocalClock] = useState(0);
  const [syncState, setSyncState] = useState<DocumentSyncState>('idle');
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [logicBusy, setLogicBusy] = useState(false);
  const [alerts, setAlerts] = useState<Array<{ id: string; title: string; severity: string; description: string }>>([]);
  const [entities, setEntities] = useState(collectNarrativeEntities(EMPTY_DOCUMENT));
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const syncEngineRef = useRef<DocumentSyncEngine | null>(null);
  const lastSerializedRef = useRef(JSON.stringify(EMPTY_DOCUMENT));
  const saveTimerRef = useRef<number | null>(null);
  const streamClientRef = useRef<LogicCheckStreamClient | null>(null);
  const editor = useCreateBlockNote(
    {
      schema: narrativeSchema,
      initialContent: initialBlocks ?? EMPTY_DOCUMENT,
    },
    [document.id, initialBlocks],
  );
  const cognitive = useCognitiveSignals(appEnv.enableCognitiveAssist, hostRef.current);
  const deferredEntities = useDeferredValue(entities);

  useEffect(() => {
    if (!unlocked) {
      return;
    }
    let cancelled = false;
    setInitialBlocks(null);
    setRuntimeError(null);

    loadLocalBlocks(document.id, unlocked.subKeys.textEncryptionKey)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setInitialBlocks(loaded.blocks);
        setLocalClock(loaded.localClock);
        lastSerializedRef.current = JSON.stringify(loaded.blocks);
        startTransition(() => {
          setEntities(collectNarrativeEntities(loaded.blocks as NarrativeBlockLike[]));
          setAlerts(collectNarrativeAlerts(loaded.blocks as NarrativeBlockLike[]));
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setRuntimeError(error instanceof Error ? error.message : 'Caricamento documento non riuscito');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [document.id, unlocked]);

  useEffect(() => {
    setSyncStateStore(syncState);
  }, [setSyncStateStore, syncState]);

  useEffect(() => {
    if (!unlocked || !initialBlocks) {
      return;
    }

    const syncEngine = new DocumentSyncEngine({
      documentId: document.id,
      accessToken,
      encryptionKey: unlocked.subKeys.crdtEncryptionKey,
      signingSecretKey: unlocked.signingSecretKey,
      signingPublicKey: unlocked.signingPublicKey,
      initialSerializedContent: lastSerializedRef.current,
      localClock,
      onSyncState: (state) => setSyncState(state),
      onClockAcknowledged: async (clock) => {
        setLocalClock((previous) => Math.max(previous, clock));
        const local = await editorDb.documents.get(document.id);
        if (local) {
          await editorDb.documents.put({ ...local, latestClock: Math.max(local.latestClock, clock) });
        }
      },
    });
    syncEngineRef.current = syncEngine;

    const stopObserving = syncEngine.observeSerializedContent((serialized) => {
      if (!serialized || serialized === lastSerializedRef.current) {
        return;
      }
      const blocks = parseSerializedBlocks(serialized);
      lastSerializedRef.current = JSON.stringify(blocks);
      replaceEditorContents(editor, blocks);
      startTransition(() => {
        setEntities(collectNarrativeEntities(blocks as NarrativeBlockLike[]));
        setAlerts(collectNarrativeAlerts(blocks as NarrativeBlockLike[]));
      });
    });

    void syncEngine.start().catch((error) => {
      setRuntimeError(error instanceof Error ? error.message : 'Sync remota non disponibile');
      setSyncState('offline');
    });

    return () => {
      stopObserving();
      syncEngine.close();
      syncEngineRef.current = null;
    };
  }, [accessToken, document.id, editor, initialBlocks, localClock, unlocked]);

  useEffect(() => {
    const unsubscribe = editor.onChange(() => {
      const blocks = editor.document as unknown as NarrativeBlockLike[];
      const serialized = JSON.stringify(blocks);
      if (serialized === lastSerializedRef.current) {
        return;
      }

      lastSerializedRef.current = serialized;
      startTransition(() => {
        setEntities(collectNarrativeEntities(blocks));
        setAlerts(collectNarrativeAlerts(blocks));
      });
      syncEngineRef.current?.replaceSerializedContent(serialized);

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        void persistLocalSnapshot(
          document,
          blocks,
          unlocked!.subKeys.textEncryptionKey,
          localClock,
          syncState,
        );
        void syncEngineRef.current?.createSnapshot().catch(() => undefined);
      }, 900);
    });

    return () => {
      unsubscribe?.();
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [document, editor, localClock, syncState, unlocked]);

  useEffect(() => {
    return () => {
      streamClientRef.current?.close();
      streamClientRef.current = null;
    };
  }, []);

  async function runLogicCheck(streamingMode: boolean) {
    const blocks = editor.document as unknown as NarrativeBlockLike[];
    const sceneText = blocksToPlainText(blocks);
    const ragContext = await buildLocalRagContext(
      sceneText,
      unlocked!.subKeys.textEncryptionKey,
      document.id,
    );

    setLogicBusy(true);
    setStreamText('');
    setRuntimeError(null);
    try {
      if (streamingMode && appEnv.enableStreamingLogicCheck) {
        setStreaming(true);
        streamClientRef.current?.close();
        streamClientRef.current = new LogicCheckStreamClient(accessToken, {
          onToken: (token) => {
            setStreamText((previous) => previous + token);
          },
          onResult: (result) => {
            setLogicCheckResult(result);
            setStreaming(false);
            setLogicBusy(false);
          },
          onError: (message) => {
            setRuntimeError(message);
            setStreaming(false);
            setLogicBusy(false);
          },
        });
        streamClientRef.current.run({ sceneText, ragContext });
        return;
      }

      const result = await complete(accessToken, { sceneText, ragContext });
      setLogicCheckResult(result);
    } finally {
      if (!streamingMode) {
        setLogicBusy(false);
      }
    }
  }

  const logicResult = useEditorStore((state) => state.logicCheckResult);

  if (!unlocked || !initialBlocks) {
    return <p className="muted">Apertura documento...</p>;
  }

  return (
    <div className="editor-layout">
      <aside className="sidebar stack">
        <div className="panel stack">
          <span className="pill">{document.kind}</span>
          <h2>{document.title}</h2>
          <p className="muted">Sync: {syncState}</p>
          <p className="muted">Hesitation score: {cognitive.hesitationScore}</p>
          {cognitive.suggested ? (
            <button className="button button--ghost" onClick={() => void runLogicCheck(false)} type="button">
              Suggerisci logic check
            </button>
          ) : null}
        </div>
        <div className="panel stack">
          <h3>Entità</h3>
          {deferredEntities.length === 0 ? <p className="muted">Nessuna entità estratta.</p> : null}
          {deferredEntities.map((entity) => (
            <div key={entity.id} className="list-item">
              <strong>{entity.name}</strong>
              <p className="muted">{entity.type}</p>
            </div>
          ))}
        </div>
      </aside>

      <section className="editor-surface">
        <div className="editor-surface__toolbar">
          <div className="button-row">
            <span className="pill">{syncState}</span>
            <button className="button" disabled={logicBusy} onClick={() => void runLogicCheck(false)} type="button">
              Logic check
            </button>
            <button
              className="button button--ghost"
              disabled={logicBusy || !appEnv.enableStreamingLogicCheck}
              onClick={() => void runLogicCheck(true)}
              type="button"
            >
              Streaming
            </button>
          </div>
          <div className="button-row">
            <button className="button button--ghost" onClick={() => void syncEngineRef.current?.createSnapshot()} type="button">
              Snapshot remoto
            </button>
          </div>
        </div>
        <div className="editor-surface__content" ref={hostRef}>
          <BlockNoteView editor={editor} theme="light">
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) => filterSlashItems(editor, query)}
            />
            <SuggestionMenuController
              triggerCharacter="@"
              getItems={async (query) => getMentionMenuItems(editor, entities, query)}
            />
          </BlockNoteView>
        </div>
      </section>

      <aside className="inspector stack">
        <div className="panel stack">
          <h3>Alert narrativi</h3>
          {alerts.length === 0 ? <p className="muted">Nessun alert nel documento.</p> : null}
          {alerts.map((alert) => (
            <div className="list-item" key={alert.id}>
              <strong>{alert.title}</strong>
              <p className="muted">{alert.severity}</p>
              <p>{alert.description}</p>
            </div>
          ))}
        </div>
        <div className="panel stack">
          <h3>Logic check</h3>
          {logicBusy ? <p className="muted">Analisi in corso...</p> : null}
          {streaming && streamText ? <pre>{streamText}</pre> : null}
          {logicResult ? <LogicResultPanel result={logicResult} /> : <p className="muted">Nessuna analisi disponibile.</p>}
        </div>
        {runtimeError ? <p className="error">{runtimeError}</p> : null}
      </aside>
    </div>
  );
}

function filterSlashItems(editor: NarrativeWorkspaceEditor, query: string) {
  return getNarrativeSlashMenuItems(editor).filter((item) => {
    const haystack = `${item.title} ${item.subtext ?? ''} ${(item.aliases ?? []).join(' ')}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
}

type NarrativeWorkspaceEditor = ReturnType<typeof useCreateBlockNote<typeof narrativeSchema.blockSchema, typeof narrativeSchema.inlineContentSchema, typeof narrativeSchema.styleSchema>>;

function LogicResultPanel({ result }: { result: LogicCheckResponse }) {
  return (
    <div className="stack">
      <p className="muted">{result.hasConflict ? 'Conflitti rilevati' : 'Nessun conflitto rilevato'}</p>
      {result.conflicts.map((conflict, index) => (
        <div className="list-item" key={`${conflict.description}-${index}`}>
          <strong>{conflict.severity}</strong>
          <p>{conflict.description}</p>
        </div>
      ))}
      {result.evidence_chains.map((chain, index) => (
        <div className="panel" key={`${chain.sceneStatement}-${index}`}>
          <p><strong>Scene:</strong> {chain.sceneStatement}</p>
          <p><strong>Bible:</strong> {chain.bibleExcerpt}</p>
          <p><strong>Contraddizione:</strong> {chain.contradiction}</p>
        </div>
      ))}
    </div>
  );
}

export function EditorAppPage() {
  const accessToken = useAuthSessionStore((state) => state.accessToken);
  const setAnonymous = useAuthSessionStore((state) => state.setAnonymous);
  const lock = useUnlockStore((state) => state.lock);
  const activeDocument = useEditorStore((state) => state.activeDocument);
  const setActiveDocument = useEditorStore((state) => state.setActiveDocument);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [kind, setKind] = useState<DocumentKind>('manuscript');
  const [title, setTitle] = useState('Nuovo documento');
  const [error, setError] = useState<string | null>(null);

  async function loadDocuments() {
    if (!accessToken) {
      return;
    }
    try {
      const remote = await documentsApi.list(accessToken);
      await editorDb.transaction('rw', editorDb.documents, async () => {
        for (const doc of remote) {
          const local = await editorDb.documents.get(doc.id);
          const merged: LocalDocumentRecord = {
            id: doc.id,
            title: doc.title,
            kind: doc.kind,
            updatedAt: doc.updatedAt,
            lastOpenedAt: local?.lastOpenedAt ?? new Date().toISOString(),
            archivedAt: doc.archivedAt,
            latestClock: Math.max(local?.latestClock ?? 0, doc.latestClock),
            syncState: local?.syncState ?? 'idle',
          };
          await editorDb.documents.put(merged);
        }
      });
      setDocuments(remote.filter((doc) => !doc.archivedAt));
      if (!activeDocument && remote.length > 0) {
        setActiveDocument(remote[0] ?? null);
      }
      setError(null);
    } catch (error) {
      const localDocs = await editorDb.documents.toArray();
      const fallback: DocumentSummary[] = localDocs.map((doc) => ({
        id: doc.id,
        ownerUserId: 'local-cache',
        title: doc.title,
        kind: doc.kind,
        createdAt: doc.updatedAt,
        updatedAt: doc.updatedAt,
        archivedAt: doc.archivedAt,
        latestClock: doc.latestClock,
        hasSnapshot: true,
      }));
      setDocuments(fallback.filter((doc) => !doc.archivedAt));
      setError(error instanceof Error ? error.message : 'Impossibile caricare i documenti remoti');
    }
  }

  useEffect(() => {
    void loadDocuments();
  }, [accessToken]);

  async function handleCreateDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    const created = await documentsApi.create(accessToken, {
      title,
      kind,
    });
    await editorDb.documents.put({
      id: created.id,
      title: created.title,
      kind: created.kind,
      updatedAt: created.updatedAt,
      lastOpenedAt: new Date().toISOString(),
      archivedAt: created.archivedAt,
      latestClock: created.latestClock,
      syncState: 'idle',
    });
    setTitle('Nuovo documento');
    setActiveDocument(created);
    await loadDocuments();
  }

  return (
    <div className="page-shell">
      <div className="page-shell__main stack">
        <header className="page-shell__header">
          <div>
            <h1>Editor Narrativo</h1>
            <p>Account autenticato, dati locali sbloccati, persistenza cifrata attiva.</p>
          </div>
          <div className="button-row">
            <button className="button button--ghost" onClick={() => void loadDocuments()} type="button">
              Aggiorna documenti
            </button>
            <button
              className="button button--danger"
              onClick={async () => {
                try {
                  await accountApi.logout(accessToken);
                } finally {
                  lock();
                  setAnonymous();
                }
              }}
              type="button"
            >
              Logout
            </button>
          </div>
        </header>

        <section className="page-shell__content stack">
          <div className="panel stack">
            <form className="form-grid" onSubmit={handleCreateDocument}>
              <div className="two-column">
                <label className="label">
                  Titolo
                  <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="label">
                  Tipo
                  <select className="select" value={kind} onChange={(event) => setKind(event.target.value as DocumentKind)}>
                    <option value="manuscript">Manuscript</option>
                    <option value="story_bible">Story Bible</option>
                    <option value="notes">Notes</option>
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button className="button" type="submit">
                  Crea documento
                </button>
              </div>
            </form>
          </div>

          <div className="list">
            {documents.map((document) => (
              <button
                key={document.id}
                className={`list-item${activeDocument?.id === document.id ? ' list-item--active' : ''}`}
                onClick={() => setActiveDocument(document)}
                type="button"
              >
                <strong>{document.title}</strong>
                <p className="muted">{document.kind}</p>
              </button>
            ))}
          </div>

          {error ? <p className="error">{error}</p> : null}

          {activeDocument ? (
            <NarrativeWorkspace accessToken={accessToken!} document={activeDocument} />
          ) : (
            <p className="muted">Seleziona o crea un documento per iniziare.</p>
          )}
        </section>
      </div>
    </div>
  );
}
