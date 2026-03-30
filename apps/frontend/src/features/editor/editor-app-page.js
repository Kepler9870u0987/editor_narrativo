import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { startTransition, useDeferredValue, useEffect, useRef, useState, } from 'react';
import { BlockNoteView, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { appEnv } from '../../lib/env';
import { decryptJsonSnapshot, encryptJsonSnapshot } from '../../lib/keys';
import { editorDb } from '../../lib/storage';
import { complete } from '../logic-check/proxy-api';
import { LogicCheckStreamClient } from '../logic-check/logic-check-stream';
import { useUnlockStore } from '../unlock/unlock-store';
import { accountApi } from '../auth/account-api';
import { useAuthSessionStore } from '../auth/auth-store';
import { blocksToPlainText, collectNarrativeAlerts, collectNarrativeEntities, getMentionMenuItems, getNarrativeSlashMenuItems, narrativeSchema, } from './blocknote-schema';
import { DocumentSyncEngine } from './document-sync';
import { documentsApi } from './documents-api';
import { useEditorStore } from './editor-store';
import { buildLocalRagContext } from './rag-context';
import { useCognitiveSignals } from './use-cognitive-signals';
const EMPTY_DOCUMENT = [
    {
        type: 'paragraph',
        content: 'Inizia a scrivere qui.',
    },
];
async function loadLocalBlocks(documentId, key) {
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
            blocks: await decryptJsonSnapshot(key, snapshot.encryptedBlob),
            localClock: documentMeta?.latestClock ?? 0,
        };
    }
    catch {
        return {
            blocks: EMPTY_DOCUMENT,
            localClock: 0,
        };
    }
}
async function persistLocalSnapshot(document, blocks, key, latestClock, syncState) {
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
function parseSerializedBlocks(serialized) {
    if (!serialized.trim()) {
        return EMPTY_DOCUMENT;
    }
    try {
        const parsed = JSON.parse(serialized);
        return parsed.length > 0 ? parsed : EMPTY_DOCUMENT;
    }
    catch {
        return EMPTY_DOCUMENT;
    }
}
function replaceEditorContents(editor, blocks) {
    const currentIds = editor.document.map((block) => block.id);
    editor.replaceBlocks(currentIds, blocks.length > 0 ? blocks : EMPTY_DOCUMENT);
}
function NarrativeWorkspace({ document, accessToken, }) {
    const unlocked = useUnlockStore((state) => state.unlocked);
    const setSyncStateStore = useEditorStore((state) => state.setSyncState);
    const setLogicCheckResult = useEditorStore((state) => state.setLogicCheckResult);
    const [initialBlocks, setInitialBlocks] = useState(null);
    const [localClock, setLocalClock] = useState(0);
    const [syncState, setSyncState] = useState('idle');
    const [streamText, setStreamText] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [logicBusy, setLogicBusy] = useState(false);
    const [alerts, setAlerts] = useState([]);
    const [entities, setEntities] = useState(collectNarrativeEntities(EMPTY_DOCUMENT));
    const [runtimeError, setRuntimeError] = useState(null);
    const hostRef = useRef(null);
    const syncEngineRef = useRef(null);
    const lastSerializedRef = useRef(JSON.stringify(EMPTY_DOCUMENT));
    const saveTimerRef = useRef(null);
    const streamClientRef = useRef(null);
    const editor = useCreateBlockNote({
        schema: narrativeSchema,
        initialContent: initialBlocks ?? EMPTY_DOCUMENT,
    }, [document.id, initialBlocks]);
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
                setEntities(collectNarrativeEntities(loaded.blocks));
                setAlerts(collectNarrativeAlerts(loaded.blocks));
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
                setEntities(collectNarrativeEntities(blocks));
                setAlerts(collectNarrativeAlerts(blocks));
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
            const blocks = editor.document;
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
                void persistLocalSnapshot(document, blocks, unlocked.subKeys.textEncryptionKey, localClock, syncState);
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
    async function runLogicCheck(streamingMode) {
        const blocks = editor.document;
        const sceneText = blocksToPlainText(blocks);
        const ragContext = await buildLocalRagContext(sceneText, unlocked.subKeys.textEncryptionKey, document.id);
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
        }
        finally {
            if (!streamingMode) {
                setLogicBusy(false);
            }
        }
    }
    const logicResult = useEditorStore((state) => state.logicCheckResult);
    if (!unlocked || !initialBlocks) {
        return _jsx("p", { className: "muted", children: "Apertura documento..." });
    }
    return (_jsxs("div", { className: "editor-layout", children: [_jsxs("aside", { className: "sidebar stack", children: [_jsxs("div", { className: "panel stack", children: [_jsx("span", { className: "pill", children: document.kind }), _jsx("h2", { children: document.title }), _jsxs("p", { className: "muted", children: ["Sync: ", syncState] }), _jsxs("p", { className: "muted", children: ["Hesitation score: ", cognitive.hesitationScore] }), cognitive.suggested ? (_jsx("button", { className: "button button--ghost", onClick: () => void runLogicCheck(false), type: "button", children: "Suggerisci logic check" })) : null] }), _jsxs("div", { className: "panel stack", children: [_jsx("h3", { children: "Entit\u00E0" }), deferredEntities.length === 0 ? _jsx("p", { className: "muted", children: "Nessuna entit\u00E0 estratta." }) : null, deferredEntities.map((entity) => (_jsxs("div", { className: "list-item", children: [_jsx("strong", { children: entity.name }), _jsx("p", { className: "muted", children: entity.type })] }, entity.id)))] })] }), _jsxs("section", { className: "editor-surface", children: [_jsxs("div", { className: "editor-surface__toolbar", children: [_jsxs("div", { className: "button-row", children: [_jsx("span", { className: "pill", children: syncState }), _jsx("button", { className: "button", disabled: logicBusy, onClick: () => void runLogicCheck(false), type: "button", children: "Logic check" }), _jsx("button", { className: "button button--ghost", disabled: logicBusy || !appEnv.enableStreamingLogicCheck, onClick: () => void runLogicCheck(true), type: "button", children: "Streaming" })] }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button button--ghost", onClick: () => void syncEngineRef.current?.createSnapshot(), type: "button", children: "Snapshot remoto" }) })] }), _jsx("div", { className: "editor-surface__content", ref: hostRef, children: _jsxs(BlockNoteView, { editor: editor, theme: "light", children: [_jsx(SuggestionMenuController, { triggerCharacter: "/", getItems: async (query) => filterSlashItems(editor, query) }), _jsx(SuggestionMenuController, { triggerCharacter: "@", getItems: async (query) => getMentionMenuItems(editor, entities, query) })] }) })] }), _jsxs("aside", { className: "inspector stack", children: [_jsxs("div", { className: "panel stack", children: [_jsx("h3", { children: "Alert narrativi" }), alerts.length === 0 ? _jsx("p", { className: "muted", children: "Nessun alert nel documento." }) : null, alerts.map((alert) => (_jsxs("div", { className: "list-item", children: [_jsx("strong", { children: alert.title }), _jsx("p", { className: "muted", children: alert.severity }), _jsx("p", { children: alert.description })] }, alert.id)))] }), _jsxs("div", { className: "panel stack", children: [_jsx("h3", { children: "Logic check" }), logicBusy ? _jsx("p", { className: "muted", children: "Analisi in corso..." }) : null, streaming && streamText ? _jsx("pre", { children: streamText }) : null, logicResult ? _jsx(LogicResultPanel, { result: logicResult }) : _jsx("p", { className: "muted", children: "Nessuna analisi disponibile." })] }), runtimeError ? _jsx("p", { className: "error", children: runtimeError }) : null] })] }));
}
function filterSlashItems(editor, query) {
    return getNarrativeSlashMenuItems(editor).filter((item) => {
        const haystack = `${item.title} ${item.subtext ?? ''} ${(item.aliases ?? []).join(' ')}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
    });
}
function LogicResultPanel({ result }) {
    return (_jsxs("div", { className: "stack", children: [_jsx("p", { className: "muted", children: result.hasConflict ? 'Conflitti rilevati' : 'Nessun conflitto rilevato' }), result.conflicts.map((conflict, index) => (_jsxs("div", { className: "list-item", children: [_jsx("strong", { children: conflict.severity }), _jsx("p", { children: conflict.description })] }, `${conflict.description}-${index}`))), result.evidence_chains.map((chain, index) => (_jsxs("div", { className: "panel", children: [_jsxs("p", { children: [_jsx("strong", { children: "Scene:" }), " ", chain.sceneStatement] }), _jsxs("p", { children: [_jsx("strong", { children: "Bible:" }), " ", chain.bibleExcerpt] }), _jsxs("p", { children: [_jsx("strong", { children: "Contraddizione:" }), " ", chain.contradiction] })] }, `${chain.sceneStatement}-${index}`)))] }));
}
export function EditorAppPage() {
    const accessToken = useAuthSessionStore((state) => state.accessToken);
    const setAnonymous = useAuthSessionStore((state) => state.setAnonymous);
    const lock = useUnlockStore((state) => state.lock);
    const activeDocument = useEditorStore((state) => state.activeDocument);
    const setActiveDocument = useEditorStore((state) => state.setActiveDocument);
    const [documents, setDocuments] = useState([]);
    const [kind, setKind] = useState('manuscript');
    const [title, setTitle] = useState('Nuovo documento');
    const [error, setError] = useState(null);
    async function loadDocuments() {
        if (!accessToken) {
            return;
        }
        try {
            const remote = await documentsApi.list(accessToken);
            await editorDb.transaction('rw', editorDb.documents, async () => {
                for (const doc of remote) {
                    const local = await editorDb.documents.get(doc.id);
                    const merged = {
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
        }
        catch (error) {
            const localDocs = await editorDb.documents.toArray();
            const fallback = localDocs.map((doc) => ({
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
    async function handleCreateDocument(event) {
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
    return (_jsx("div", { className: "page-shell", children: _jsxs("div", { className: "page-shell__main stack", children: [_jsxs("header", { className: "page-shell__header", children: [_jsxs("div", { children: [_jsx("h1", { children: "Editor Narrativo" }), _jsx("p", { children: "Account autenticato, dati locali sbloccati, persistenza cifrata attiva." })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { className: "button button--ghost", onClick: () => void loadDocuments(), type: "button", children: "Aggiorna documenti" }), _jsx("button", { className: "button button--danger", onClick: async () => {
                                        try {
                                            await accountApi.logout(accessToken);
                                        }
                                        finally {
                                            lock();
                                            setAnonymous();
                                        }
                                    }, type: "button", children: "Logout" })] })] }), _jsxs("section", { className: "page-shell__content stack", children: [_jsx("div", { className: "panel stack", children: _jsxs("form", { className: "form-grid", onSubmit: handleCreateDocument, children: [_jsxs("div", { className: "two-column", children: [_jsxs("label", { className: "label", children: ["Titolo", _jsx("input", { className: "input", value: title, onChange: (event) => setTitle(event.target.value) })] }), _jsxs("label", { className: "label", children: ["Tipo", _jsxs("select", { className: "select", value: kind, onChange: (event) => setKind(event.target.value), children: [_jsx("option", { value: "manuscript", children: "Manuscript" }), _jsx("option", { value: "story_bible", children: "Story Bible" }), _jsx("option", { value: "notes", children: "Notes" })] })] })] }), _jsx("div", { className: "button-row", children: _jsx("button", { className: "button", type: "submit", children: "Crea documento" }) })] }) }), _jsx("div", { className: "list", children: documents.map((document) => (_jsxs("button", { className: `list-item${activeDocument?.id === document.id ? ' list-item--active' : ''}`, onClick: () => setActiveDocument(document), type: "button", children: [_jsx("strong", { children: document.title }), _jsx("p", { className: "muted", children: document.kind })] }, document.id))) }), error ? _jsx("p", { className: "error", children: error }) : null, activeDocument ? (_jsx(NarrativeWorkspace, { accessToken: accessToken, document: activeDocument })) : (_jsx("p", { className: "muted", children: "Seleziona o crea un documento per iniziare." }))] })] }) }));
}
//# sourceMappingURL=editor-app-page.js.map