# Architettura & Istruzioni di Avvio — Editor Narrativo

## Architettura Generale

**Editor Narrativo** è un editor di testi narrativi AI-augmented con architettura **local-first** e **Zero-Knowledge**. Il progetto è un **monorepo pnpm** con 8 package + 1 app frontend.

### I 3 Server Backend (tutti Fastify)

| Server | Porta default | Package | Ruolo |
|--------|--------------|---------|-------|
| **account-backend** | `4000` | `packages/account-backend` | Autenticazione, registrazione, sessioni, MFA (TOTP + WebAuthn/Passkey), JWKS, gestione chiavi cifrate utente |
| **proxy-backend** | `4010` | `packages/proxy-backend` | Proxy LLM Zero Data Retention — masking PII, logic check narrativo, streaming WebSocket, session buffer per riconnessione |
| **documents-backend** | `4100` | `packages/documents-backend` | CRUD documenti, snapshot cifrati, sync incrementale CRDT via WebSocket, Lamport clock |

### Frontend (Vite + React)

| Server | Porta | Package |
|--------|-------|---------|
| **Vite dev server** | `5173` | `apps/frontend` |

Vite fa da **reverse proxy** verso i 3 backend:
- `/account/*` → `http://127.0.0.1:4000`
- `/proxy/*` → `http://127.0.0.1:4010`
- `/documents/*` → `http://127.0.0.1:4100`

### Come funzionano i server

1. **account-backend** (`:4000`) — è il server di identità. Gestisce il ciclo completo: registrazione → verifica email → login → JWT (EdDSA) → refresh token (cookie httpOnly) → TOTP 2FA → passkey WebAuthn → gestione sessioni → bootstrap chiavi crittografiche. Espone anche un endpoint JWKS (`/.well-known/jwks.json`) usato dagli altri backend per verificare i JWT senza secret condiviso. Usa SQLite con WAL mode.

2. **proxy-backend** (`:4010`) — è il proxy "Zero Data Retention" verso LLM esterni (OpenAI-compatibili). Maschera i dati PII prima di inoltrarli, supporta streaming via WebSocket con In-Band Auth JWT, mantiene un buffer di sessione per riconnessioni graceful. In dev senza `LLM_API_KEY`, usa uno stub che risponde "no conflict". All'avvio tenta di scaricare le JWKS da account-backend per validare i token.

3. **documents-backend** (`:4100`) — gestisce la persistenza dei documenti cifrati. Supporta CRUD REST + sync real-time via WebSocket (protocollo: AUTH → SUBSCRIBE → PUSH_UPDATE → MISSING_UPDATES). Gli snapshot e gli update sono cifrati client-side (AES-GCM), il server vede solo blob opachi. Usa SQLite WAL. Anche lui recupera le JWKS da account-backend all'avvio.

### Librerie condivise (solo codice, nessun server)

| Package | Scopo |
|---------|-------|
| `shared` | Tipi TypeScript, costanti crittografiche, config HNSW |
| `crypto` | AES-256-GCM, HKDF, AES-KW, Ed25519 (libsodium), Argon2id, CryptoWorkerClient |
| `crdt` | Yjs SecSync provider con Lamport clock, cifratura e firma degli update |
| `rag` | RAG in-browser: chunking, embedding, vector index (BruteForce/IVF/HNSW), pipeline |
| `account-shared` | Tipi contratto frontend↔account-backend |
| `documents-shared` | Tipi contratto frontend↔documents-backend |

### Frontend

React 18 + BlockNote (editor rich-text basato su TipTap/ProseMirror) con:
- **Custom blocks**: schede personaggio, alert narrativi, sezioni toggle
- **Entity mentions** con trigger `@`
- **2 Web Workers**: `crypto-worker` (Argon2id + Ed25519) e `rag-worker` (ONNX embedding)
- **Biometria cognitiva**: rileva esitazione dell'utente e suggerisce logic check automatico
- **Sync CRDT**: Yjs ↔ BlockNote con SecSync cifrato su WebSocket
- **RAG locale**: embedding nomic-embed-text-v1.5 via WebGPU/ONNX + vector search in IndexedDB
- **Logic check**: streaming LLM con evidenze e highlighting semantico inline
- **Auth completa**: login, register, 2FA, passkey, unlock crittografico

---

## Prerequisiti

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0

## Installazione dipendenze

```bash
pnpm install
```

## Build di tutti i package

```bash
pnpm build
```

> Necessario almeno la prima volta per compilare i package TypeScript condivisi.

## Avvio in Sviluppo

Servono **4 terminali** (o un unico terminale con tool come `concurrently`).

### 1. Account Backend (porta 4000)

```bash
cd packages/account-backend
pnpm dev
```

> Avviare **per primo**: gli altri backend scaricano le JWKS da qui all'avvio.

### 2. Proxy Backend (porta 4010)

```bash
cd packages/proxy-backend
pnpm dev
```

Variabili d'ambiente opzionali:
| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `PORT` | `4010` | Porta di ascolto |
| `LLM_API_KEY` | — | API key OpenAI (senza: usa stub dev) |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Base URL provider LLM |
| `LLM_MODEL` | `gpt-4o-mini` | Modello LLM |
| `JWT_SECRET` | — | Secret JWT (senza: usa JWKS da account-backend) |
| `ACCOUNT_BASE_URL` | `http://127.0.0.1:4000` | URL account-backend per JWKS |

### 3. Documents Backend (porta 4100)

```bash
cd packages/documents-backend
pnpm dev
```

Variabili d'ambiente opzionali:
| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `PORT` | `4100` | Porta di ascolto |
| `JWT_SECRET` | — | Secret JWT (senza: usa JWKS da account-backend) |
| `ACCOUNT_BASE_URL` | `http://127.0.0.1:4000` | URL account-backend per JWKS |

### 4. Frontend (porta 5173)

```bash
cd apps/frontend
pnpm dev
```

Variabili d'ambiente opzionali (nel file `.env`):
| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `VITE_ACCOUNT_BASE_URL` | `http://127.0.0.1:4000` | URL account-backend |
| `VITE_PROXY_BASE_URL` | `http://127.0.0.1:4010` | URL proxy-backend |
| `VITE_DOCUMENTS_BASE_URL` | `http://127.0.0.1:4100` | URL documents-backend |

Apri il browser su: **http://127.0.0.1:5173**

## Ordine di avvio consigliato

1. `account-backend` (genera le chiavi JWKS)
2. `proxy-backend` (scarica JWKS da account-backend)
3. `documents-backend` (scarica JWKS da account-backend)
4. `frontend` (proxy Vite verso i 3 backend)

## Test

```bash
# Tutti i test di tutti i package
pnpm test

# Test di un singolo package
cd packages/crypto
pnpm test

# Test frontend
cd apps/frontend
pnpm test

# Test E2E (richiede tutti i server attivi)
cd apps/frontend
pnpm e2e
```

## Build di produzione

```bash
# Build completa
pnpm build

# Preview frontend (build statica)
cd apps/frontend
pnpm preview
```

## Porte riepilogative

| Servizio | Porta | Protocollo |
|----------|-------|------------|
| account-backend | 4000 | HTTP REST |
| proxy-backend | 4010 | HTTP REST + WebSocket |
| documents-backend | 4100 | HTTP REST + WebSocket |
| frontend (dev) | 5173 | HTTP (Vite dev server) |
