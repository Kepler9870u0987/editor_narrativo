# Piano di Implementazione — Editor Narrativo AI-Augmented

> Generato il 27/03/2026 — Stato aggiornato al termine della Fase 1–5 (backend).

Legenda stati: ✅ Completato | 🔲 Da fare

---

## Fase 0 — Scaffolding & Infrastruttura Monorepo ✅

| # | Task | Stato |
|---|------|-------|
| 0.1 | Inizializzazione monorepo pnpm + workspace.yaml | ✅ |
| 0.2 | Configurazione TypeScript base (ES2022, strict, bundler resolution) | ✅ |
| 0.3 | Setup Vitest come test runner per tutti i package | ✅ |
| 0.4 | Configurazione .gitignore, script build/test/lint root | ✅ |

---

## Fase 1 — Package `shared` (Tipi e Costanti condivise) ✅

| # | Task | Subtask | Stato |
|---|------|---------|-------|
| 1.1 | Definizione tipi condivisi | | ✅ |
| | | 1.1.1 `EncryptedPayload` (ciphertext + iv) | ✅ |
| | | 1.1.2 `WrappedKey` (wrapped DEK per AES-KW) | ✅ |
| | | 1.1.3 `DerivedSubKeys` (text, vector, crdt encryption keys) | ✅ |
| | | 1.1.4 `SecSyncUpdate` / `SecSyncSnapshot` (protocollo CRDT) | ✅ |
| | | 1.1.5 `CRDTMetadata` (documentId, clock, publicKey) | ✅ |
| | | 1.1.6 `RAGSearchResult` / `LogicCheckResult` / `Conflict` | ✅ |
| | | 1.1.7 `EvidenceChain` (citazioni per il logic check) | ✅ |
| | | 1.1.8 `PIIMaskMap` (mappa token effimeri ↔ PII) | ✅ |
| | | 1.1.9 `CryptoWorkerRequest` / `CryptoWorkerResponse` (discriminated union) | ✅ |
| | | 1.1.10 `WorkerMessage` (comunicazione generica Web Worker) | ✅ |
| 1.2 | Definizione costanti di produzione | | ✅ |
| | | 1.2.1 Costanti AES-GCM (IV 12B, Tag 16B, Key 32B) | ✅ |
| | | 1.2.2 Parametri Argon2id (46 MiB, opsLimit 1, parallelism 1) | ✅ |
| | | 1.2.3 HKDF info strings ("text-encryption", "vector-encryption", "crdt-encryption") | ✅ |
| | | 1.2.4 Ed25519 constants | ✅ |
| | | 1.2.5 HNSW defaults (cosine, M:16, efConstruction:200) | ✅ |
| | | 1.2.6 WS_SESSION_TTL_MS (300000), CRYPTO_WORKER_TIMEOUT_MS (30000) | ✅ |
| 1.3 | Test unitari costanti | | ✅ |

**Test: 6/6 ✅**

---

## Fase 2 — Package `crypto` (Layer Crittografico Client-Side) ✅

| # | Task | Subtask | Stato |
|---|------|---------|-------|
| 2.1 | AES-256-GCM encrypt/decrypt | | ✅ |
| | | 2.1.1 `encrypt(key, data)` → EncryptedPayload con IV fresh 12B | ✅ |
| | | 2.1.2 `decrypt(key, ciphertext, iv)` → plaintext | ✅ |
| | | 2.1.3 `serializePayload` / `deserializePayload` (formato IV‖Ciphertext) | ✅ |
| | | 2.1.4 Test roundtrip, IV unicità, chiave errata | ✅ |
| 2.2 | Key Management (HKDF + AES-KW) | | ✅ |
| | | 2.2.1 `generateDEK()` — chiave casuale 256-bit | ✅ |
| | | 2.2.2 `importKEK(rawKey)` — import Web Crypto | ✅ |
| | | 2.2.3 `wrapDEK(kek, dek)` / `unwrapDEK(kek, wrappedDek)` via AES-KW | ✅ |
| | | 2.2.4 `deriveSubKeys(dek)` via HKDF-SHA256 → 3 subkeys | ✅ |
| 2.3 | Ed25519 (libsodium) | | ✅ |
| | | 2.3.1 `generateSigningKeyPair()` | ✅ |
| | | 2.3.2 `signPayload(secretKey, payload)` | ✅ |
| | | 2.3.3 `verifySignature(publicKey, payload, signature)` | ✅ |
| | | 2.3.4 Test sign/verify, tampered payload, wrong key | ✅ |
| 2.4 | Argon2id (libsodium WASM) | | ✅ |
| | | 2.4.1 `initSodium()` — init lazy libsodium | ✅ |
| | | 2.4.2 `deriveKEK(password, salt)` — Argon2id con params OWASP | ✅ |
| | | 2.4.3 `generateSalt()` — 16 byte random | ✅ |
| | | 2.4.4 `wipeBuffer(buf)` — zeroing sicuro | ✅ |
| 2.5 | CryptoWorkerClient | | ✅ |
| | | 2.5.1 Typed postMessage con discriminated union | ✅ |
| | | 2.5.2 Request/response tracking con ID univoco | ✅ |
| | | 2.5.3 Timeout configurabile (default 30s) | ✅ |

**Test: 17/17 ✅**

---

## Fase 3 — Package `crdt` (Motore CRDT Collaborativo Yjs + SecSync) ✅

| # | Task | Subtask | Stato |
|---|------|---------|-------|
| 3.1 | Lamport Clock | | ✅ |
| | | 3.1.1 `tick()` — incremento locale | ✅ |
| | | 3.1.2 `merge(remote)` — max(local, remote) + 1 | ✅ |
| | | 3.1.3 `isValidNext(remote)` — validazione monotonia | ✅ |
| | | 3.1.4 `toJSON()` / `fromJSON()` — serializzazione | ✅ |
| | | 3.1.5 Test monotonia, merge, serializzazione | ✅ |
| 3.2 | SecSyncProvider | | ✅ |
| | | 3.2.1 Intercettazione `doc.on('update')` — listener Yjs | ✅ |
| | | 3.2.2 `encryptAndSend(update)` — AES-GCM + Ed25519 sign | ✅ |
| | | 3.2.3 `receiveUpdate(update)` — verifica firma + clock + decrypt + apply | ✅ |
| | | 3.2.4 `createSnapshot()` — stato completo cifrato e firmato | ✅ |
| | | 3.2.5 `receiveSnapshot(snapshot)` — restore completo | ✅ |
| | | 3.2.6 `SecSyncTransport` interface (send/receive update/snapshot) | ✅ |
| | | 3.2.7 Guard `isApplyingRemote` — prevenzione loop infinito | ✅ |
| | | 3.2.8 Test: encrypt-send flow, snapshot, remote apply, firma invalida, clock fuori sequenza | ✅ |

**Test: 11/11 ✅**

---

## Fase 4 — Package `rag` (Sub-Sistema RAG nel Browser) ✅

| # | Task | Subtask | Stato |
|---|------|---------|-------|
| 4.1 | WorkerPool | | ✅ |
| | | 4.1.1 Scheduling a coda con concurrency configurabile | ✅ |
| | | 4.1.2 `execute(task)` / `terminate()` | ✅ |
| 4.2 | EmbeddingService | | ✅ |
| | | 4.2.1 `chunkText(text, maxTokens, overlap)` — chunking con sovrapposizione | ✅ |
| | | 4.2.2 `normalizeVector(v)` — L2 normalization | ✅ |
| | | 4.2.3 `cosineSimilarity(a, b)` — calcolo similarità | ✅ |
| | | 4.2.4 `EmbeddingModel` interface + `EmbeddingModelConfig` type | ✅ |
| | | 4.2.5 `OnnxEmbeddingModel` — placeholder per onnxruntime-web (WebGPU) | ✅ |
| | | 4.2.6 Test chunking, normalizzazione, cosine similarity | ✅ |
| 4.3 | VectorIndex | | ✅ |
| | | 4.3.1 `VectorIndex` interface (add/search/remove) | ✅ |
| | | 4.3.2 `BruteForceIndex` — fallback JS puro con cosine similarity | ✅ |
| | | 4.3.3 `HNSWIndex` — placeholder per hnswlib-wasm | ✅ |
| | | 4.3.4 `defaultHNSWConfig` (cosine, M:16, efConstruction:200) | ✅ |
| | | 4.3.5 Test BruteForceIndex add/search/remove | ✅ |
| 4.4 | RAGPipeline | | ✅ |
| | | 4.4.1 Orchestrazione chunk → embed → search → return | ✅ |
| | | 4.4.2 Parametri topK e threshold configurabili | ✅ |
| | | 4.4.3 Test pipeline completa con mock embedding model | ✅ |

**Test: 16/16 ✅**

---

## Fase 5 — Package `proxy-backend` (Proxy LLM Zero Data Retention) ✅

| # | Task | Subtask | Stato |
|---|------|---------|-------|
| 5.1 | PIIMasker | | ✅ |
| | | 5.1.1 Regex patterns: email, telefoni, SSN, IBAN, date, IP, carte di credito | ✅ |
| | | 5.1.2 Supporto custom entity masking | ✅ |
| | | 5.1.3 `mask(text)` / `unmask(text)` con token map effimera | ✅ |
| | | 5.1.4 Test: masking multi-pattern, roundtrip mask/unmask | ✅ |
| 5.2 | SessionBufferManager | | ✅ |
| | | 5.2.1 Map<sessionId, BufferedSession> con TTL (5 min) | ✅ |
| | | 5.2.2 `append(sessionId, token)` / `flush(sessionId)` / `destroy(sessionId)` | ✅ |
| | | 5.2.3 Sweep periodico sessioni scadute | ✅ |
| | | 5.2.4 Test: append, flush, TTL destroy, cleanup | ✅ |
| 5.3 | PromptBuilder (Logic Check) | | ✅ |
| | | 5.3.1 `buildLogicCheckPrompt(scene, ragChunks, entities)` — ruolo "Revisore Analitico" | ✅ |
| | | 5.3.2 Istruzioni fact extraction + JSON output con `evidence_chains` | ✅ |
| | | 5.3.3 `parseLogicCheckResponse(raw)` — parsing e validazione JSON | ✅ |
| | | 5.3.4 Test: struttura prompt, parsing JSON, risposta malformata | ✅ |
| 5.4 | Auth (JWT) | | ✅ |
| | | 5.4.1 `initJWT(secret)` — inizializzazione HMAC-SHA256 | ✅ |
| | | 5.4.2 `createToken(payload, expiresIn)` / `verifyToken(token)` | ✅ |
| | | 5.4.3 Test: create/verify, token scaduto, token invalido | ✅ |
| 5.5 | LLMProvider | | ✅ |
| | | 5.5.1 `LLMProvider` interface + `LLMProviderConfig` type | ✅ |
| | | 5.5.2 `OpenAIProvider` class con supporto streaming | ✅ |
| | | 5.5.3 `createLLMProvider(config)` factory | ✅ |
| 5.6 | Server Fastify | | ✅ |
| | | 5.6.1 CORS + Rate Limiting + JWT auth middleware | ✅ |
| | | 5.6.2 `POST /api/llm/complete` — endpoint REST con PII masking | ✅ |
| | | 5.6.3 `WS /ws/llm/stream` — WebSocket con pattern "Detach, Don't Destroy" | ✅ |
| | | 5.6.4 In-Band Auth (JWT come primo payload WS, non in URL) | ✅ |
| | | 5.6.5 Integrazione session buffer per riconnessione | ✅ |
| | | 5.6.6 `createServer(config)` factory | ✅ |

**Test: 25/25 ✅**

---

## Fase 6 — Package `frontend` (React + BlockNote) 🔲

| # | Task | Subtask | Stato |
|---|------|---------|-------|
| 6.1 | Setup React + Vite + BlockNote | | 🔲 |
| | | 6.1.1 Inizializzazione progetto Vite + React + TypeScript | 🔲 |
| | | 6.1.2 Integrazione BlockNote editor con schema default | 🔲 |
| | | 6.1.3 Header HTTP COOP/COEP per SharedArrayBuffer | 🔲 |
| 6.2 | Custom Blocks (Schede Personaggio / Alert Narrativi) | | 🔲 |
| | | 6.2.1 `createReactBlockSpec` — definizione PropSchema e render component | 🔲 |
| | | 6.2.2 Integrazione Slash Menu con `insertOrUpdateBlockForSlashMenu` | 🔲 |
| | | 6.2.3 ToggleWrapper per blocchi toggleable | 🔲 |
| 6.3 | Custom Inline Content (Entity Tags & Mentions) | | 🔲 |
| | | 6.3.1 `createReactInlineContentSpec` — tag entità con UUID | 🔲 |
| | | 6.3.2 `SuggestionMenuController` per trigger `@` | 🔲 |
| | | 6.3.3 `getMentionMenuItems` — query + filtro + `insertInlineContent` | 🔲 |
| 6.4 | Integrazione Crypto Web Worker | | 🔲 |
| | | 6.4.1 Spawning Web Worker dedicato per Argon2id | 🔲 |
| | | 6.4.2 Comunicazione tipizzata con CryptoWorkerClient | 🔲 |
| | | 6.4.3 UI login/unlock con derivazione KEK | 🔲 |
| 6.5 | Integrazione CRDT/Yjs | | 🔲 |
| | | 6.5.1 Binding Yjs ↔ BlockNote document model | 🔲 |
| | | 6.5.2 SecSyncProvider con WebSocket transport | 🔲 |
| | | 6.5.3 Indicatore di stato connessione nella UI | 🔲 |
| 6.6 | Integrazione RAG in-browser | | 🔲 |
| | | 6.6.1 Web Worker pool per inferenza ONNX | 🔲 |
| | | 6.6.2 Caricamento modello nomic-embed-text-v1.5 via WebGPU | 🔲 |
| | | 6.6.3 VectorIndex con persistenza IndexedDB (IDBFS) | 🔲 |
| | | 6.6.4 Indicizzazione automatica dei contenuti del documento | 🔲 |
| 6.7 | Biometria Cognitiva & Trigger Predittivo | | 🔲 |
| | | 6.7.1 Event listener Dwell Time / Flight Time | 🔲 |
| | | 6.7.2 Rilevamento pattern correttivi (Backspace frequency) | 🔲 |
| | | 6.7.3 Soglia probabilistica → trigger RAG automatico | 🔲 |
| 6.8 | Logic Check UI & Semantic Highlighting | | 🔲 |
| | | 6.8.1 Chiamata proxy LLM con prompt logic check | 🔲 |
| | | 6.8.2 Parsing risposta JSON `evidence_chains` | 🔲 |
| | | 6.8.3 Marker visivo inline su testo in conflitto (Semantic Highlighting) | 🔲 |
| 6.9 | WebSocket client & riconnessione | | 🔲 |
| | | 6.9.1 Client WS con In-Band Auth JWT | 🔲 |
| | | 6.9.2 Riconnessione automatica su `visibilitychange` | 🔲 |
| | | 6.9.3 Flush buffer dal proxy al ripristino sessione | 🔲 |

---

## Riepilogo Avanzamento

| Fase | Package | Build | Test | Stato |
|------|---------|-------|------|-------|
| 0 | Scaffolding | ✅ | — | ✅ |
| 1 | shared | ✅ | 6/6 | ✅ |
| 2 | crypto | ✅ | 17/17 | ✅ |
| 3 | crdt | ✅ | 11/11 | ✅ |
| 4 | rag | ✅ | 16/16 | ✅ |
| 5 | proxy-backend | ✅ | 25/25 | ✅ |
| 6 | frontend | — | — | 🔲 |

**Totale test: 75/75 ✅** — **Completamento backend: 100%** — **Frontend: da implementare**
