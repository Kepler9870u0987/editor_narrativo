# Specifica di Implementazione Low-Level: Editor Narrativo AI-Augmented (Local-First)

Questo documento definisce le specifiche tecniche di basso livello, i design pattern e le configurazioni esatte per l'implementazione dell'editor narrativo Zero-Knowledge. È redatto per guidare i team di ingegneria (Frontend, Security, AI/WASM e Backend) nella stesura del codice di produzione.

---

## 1. Implementazione Frontend: React & Ecosistema BlockNote

Il layer di presentazione richiede l'estensione del Default Schema di BlockNote tramite la definizione di specifiche rigorose per blocchi e contenuti in-line.

### 1.1 Custom Blocks (Es. Schede Personaggio / Alert Narrativi)

Per implementare blocchi strutturati (es. un blocco per enfatizzare snodi di trama o schede personaggio), utilizzare l'API `createReactBlockSpec`. [1]

**Pattern Implementativo:**

- **Definizione PropSchema:** Utilizzare `propSchema` per validare strettamente i dati. Se il blocco richiede testo editabile, impostare `content: "inline"`; se è un blocco puramente UI (es. un divisore), impostare `content: "none"`. [1]
- **Render Component:** Il componente React riceve le props (contenenti `block` ed `editor`). Per i blocchi toggleable (che nascondono/mostrano i figli), avvolgere il contenuto nel componente `ToggleWrapper` fornito da `@blocknote/react`. [2]
- **Integrazione Slash Menu:** Per permettere all'utente di inserire il blocco digitando `/`, estendere il menu utilizzando `insertOrUpdateBlockForSlashMenu`. [3] Questo metodo intelligente converte il blocco corrente se è vuoto, altrimenti ne inserisce uno nuovo al di sotto. [3]

### 1.2 Custom Inline Content (Entity Tags & Mentions)

Per tracciare entità (es. `@Marco`) in modo assoluto e non ambiguo per il motore RAG, utilizzare `createReactInlineContentSpec`. [4]

**Pattern Implementativo:**

- **Specifica Inline:** Definire il tag con `content: "none"` (poiché il nome del personaggio è un'entità monolitica non editabile a caratteri singoli) e un `propSchema` contenente l'UUID dell'entità. [4]
- **Suggestion Menu Controller:** Intercettare il carattere trigger (es. `@`) utilizzando il componente `SuggestionMenuController` nel JSX del `BlockNoteView`. [5]
- **Funzione di Filtraggio:** Implementare una funzione `getMentionMenuItems` che interroghi il database locale (es. Zustand o Redux store), filtri i risultati tramite `filterSuggestionItems` e invochi `editor.insertInlineContent()` iniettando il payload JSON formattato. [5]

---

## 2. Layer Crittografico: Client-Side Encryption (Web Crypto API)

L'architettura Zero-Knowledge impone che nessun testo in chiaro o vettore embedding raggiunga lo storage persistente senza essere prima cifrato sul dispositivo dell'utente.

### 2.1 Derivazione KEK tramite Argon2id (WASM)

Non utilizzare PBKDF2 nativo per l'hashing della master password. Utilizzare `libsodium-wrappers` (compilato in WebAssembly) per sfruttare Argon2id, il quale offre resistenza superiore contro attacchi basati su GPU. [6]

**Configurazione di Produzione (Raccomandazioni OWASP):**

Invocare `crypto_pwhash` (o l'astrazione custom se si usa un pacchetto come `@datadayrepos/libsodium-wrapper`) all'interno di un **Web Worker isolato**. [7]

**Parametri:**

| Parametro       | Valore                                                              |
| --------------- | ------------------------------------------------------------------- |
| `memoryLimit`   | Almeno 46 MiB (`46 * 1024 * 1024`) [7]                             |
| `opsLimit`      | Almeno 1 iterazione (bilanciare UX e sicurezza time-hard) [7]       |
| `parallelism`   | Fissato a 1 (limite architetturale dei thread WASM nel browser) [7] |

Il risultato è la **KEK** (Key Encryption Key), mantenuta solo nella memoria volatile (`sessionStorage` o closure JS).

### 2.2 Espansione Chiavi (HKDF) e Cifratura Simmetrica (AES-GCM)

La Master Data Encryption Key (DEK), generata casualmente, viene espansa per creare chiavi separate per testo e vettori utilizzando l'algoritmo **HKDF-SHA256** fornito nativamente dalla `crypto.subtle.deriveKey`. [8]

**Pipeline AES-256-GCM:**

1. **Vettore di Inizializzazione (IV):** Per ogni singola operazione di cifratura, generare un IV strettamente univoco di 12 byte:
   ```javascript
   crypto.getRandomValues(new Uint8Array(12));
   ```
   [9]

2. **Cifratura:** Utilizzare:
   ```javascript
   crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
   ```
   [9]

3. **Integrità:** AES-GCM (Galois/Counter Mode) appende automaticamente un Authentication Tag a 16 byte al ciphertext, garantendo l'impossibilità di manomissione (AEAD). [9] Il payload persistito nel DB deve serializzare sia il Ciphertext che l'IV associato. [9]

---

## 3. Motore CRDT Collaborativo (Yjs + SecSync)

L'impiego nativo dei provider Yjs (come `y-websocket`) trasmette i vettori di stato in chiaro, violando il principio Zero-Knowledge. L'implementazione deve basarsi su un middleware ispirato all'architettura **SecSync**. [11]

### 3.1 Topologia SecSync (Snapshot e Update)

Il server backend funge unicamente da **registro log append-only cieco**. L'architettura prevede due primitive:

- **Snapshot:** Rappresentazione consolidata ed interamente cifrata (AES-GCM) del documento CRDT a un dato istante (Lamport Clock). [11]
- **Update (Operazioni):** Frammenti crittografati che contengono le differenze incrementali codificate da Yjs (es. `Y.encodeStateAsUpdate`). [11]

### 3.2 Sicurezza e Schema Validation Backend

- **Firme Digitali (Ed25519):** Ogni Update e Snapshot cifrato inviato al server deve essere firmato digitalmente con la chiave pubblica Ed25519 del client (generata e validata tramite `libsodium`). [11] Questo previene la non ripudiabilità e attacchi Man-In-The-Middle. [11]
- **Metadati in Chiaro:** L'ID del Documento, l'ID dello Snapshot, la Chiave Pubblica del client e il Clock incrementale viaggiano in chiaro (unencrypted ma autenticati tramite firma). [11] Questo permette al backend di validare le sequenze temporali ed evitare che un client malevolo corrompa il log operativo, scartando gli update fuori sequenza. [11]

---

## 4. Sub-Sistema RAG e Inferenza AI nel Browser

L'architettura RAG (Retrieval-Augmented Generation) viene spinta interamente verso l'Edge (il browser del client) per azzerare i costi infrastrutturali cloud e mitigare gli attacchi di Embedding Inversion (estrazione di dati sensibili dai vettori sul server).

### 4.1 Orchestrazione Web Workers e SharedArrayBuffer

L'inferenza di rete neurale e il parsing del database HNSW non devono bloccare il Main Thread UI di React.

- **Isolamento Thread:** Istruire un pool di Web Workers dedicati passando il flag di compilazione Emscripten `-sWASM_WORKERS`. [12]
- **Zero-Copy Memory (SharedArrayBuffer):** Per trasferire gli enormi array in virgola mobile tra il modello AI e l'indice vettoriale senza i pesanti costi del Garbage Collector (clonazione strutturata), stanziare le matrici in un `SharedArrayBuffer`. [13]

**Intestazioni HTTP di Sicurezza Obbligatorie:**

A causa delle difese contro gli attacchi Spectre, `SharedArrayBuffer` crasherà nel browser a meno che il web server / reverse proxy non inietti tassativamente i seguenti header HTTP:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### 4.2 Embedding con ONNX Runtime Web e WebGPU

L'estrazione semantica è delegata alla libreria `onnxruntime-web`. [15]

- **Hardware Acceleration:** Inizializzare la sessione inferenziale configurando `executionProviders: ['webgpu']`. [15] Le API WebGPU consentono al browser di parallelizzare il calcolo matriciale direttamente sull'hardware grafico locale, sfruttando ottimizzazioni come i dot-product a 8 bit (DP4a) e precisione Float16, superando i limiti colli di bottiglia computazionali della pura decodifica CPU in WebAssembly. [16]
- **Modello AI Selezionato:** Utilizzare il modello open-weights quantizzato **nomic-embed-text-v1.5** (137 milioni di parametri). [17] La sua architettura impiega Rotary Positional Embeddings, Flash Attention, e attivazioni SwiGLU (25% più veloci della standard GeLU), permettendo una context window nativa di 8192 token; l'ideale per processare macro-capitoli narrativi per intero riducendo il numero di vettori finali. [17]

### 4.3 Database Vettoriale e Persistenza IndexedDB (hnswlib-wasm)

Lo storage topologico e la similarity search (calcolo del vicino più prossimo) operano in RAM tramite `hnswlib-wasm`. [18]

- **Parametri HNSW in WASM:** Configurare la metrica su `cosine`. [18] Impostare `M` (connessioni massime per nodo) in un range moderato di **12–48**: valori superiori saturerebbero rapidamente l'heap limitato di WebAssembly causando crash di tipo "Out of Memory" nel tab del browser. [18]
- **Strategia di Persistenza (IDBFS):** Per salvare il grafo RAM su disco permanente del browser senza rallentamenti, la libreria maschera le API IndexedDB tramite il modulo IDBFS di Emscripten. [18] Al salvataggio incrementale (es. su evento di debouncing o `beforeunload`), invocare l'astrazione `await index.writeIndex(...)` seguita imperativamente da `EmscriptenFileSystemManager.syncFS(false)` per comandare il flush fisico da RAM a file di database IndexedDB. [18] Al fine di ottimizzare il throughput di I/O nel browser Chrome/Edge, configurare la transazione IndexedDB sottostante in modalità `"relaxed"` (evitando la durabilità strict che impone pesanti flush operativi sul disco a stato solido).

---

## 5. Rete Proxy LLM e Logica di Coerenza

Il check della coerenza di trama è delegato a Foundation Model in cloud (es. OpenAI, DeepSeek) tramite un Proxy aziendale.

### 5.1 Il Proxy LLM Zero Data Retention (ZDR)

Il backend per l'inoltro ai LLM esterni deve agire rigorosamente in modalità **"Stateless" (ZDR)**. [19] Nessun log, nessun prompt e nessun vettore deve essere scritto su cluster di storage per alcun motivo. [19]

- **Masking Dinamico PII (Personally Identifiable Information):** Prima di forwardare il prompt all'API di terze parti, il Trust Layer del Proxy deve eseguire una detection regex e metadata-driven delle entità, mascherando i dati sensibili in token effimeri (es. `<ENTITY_42>`), de-mascherandoli unicamente in fase di ritorno verso il client. [20]

### 5.2 Resilienza del Trasporto: "Stateful Bridge" su WebSocket

Le connessioni via smartphone o tab in background chiuderanno sistematicamente i WebSocket (Drop TCP). [21]

- **Logica Backend:** Implementare un pattern **"Detach, Don't Destroy"**. Quando il client TCP si disconnette, non troncare il thread gRPC aperto con OpenAI/Anthropic. [21] Accumulare i frammenti dello streaming (token) in un buffer allocato in RAM, provvisto di un TTL (Time-to-Live) di **5 minuti**. [21]
- **Logica Frontend:** Il client intercetta l'evento di visibilità HTML (`visibilitychange`). Quando lo stato torna `visible`, il client invia un segnale di riconnessione fornendo l'ID Sessione. Il proxy riconosce la sessione, fa un flush istantaneo del buffer RAM verso il client e ripristina il flusso senza colli di bottiglia o perdita di informazioni. [21] Includere i token di autenticazione JWT come **primo payload asincrono (In-Band Auth)** all'apertura del socket, e non nella URL, per evitare leak di sicurezza nei log di rete. [21]

### 5.3 Biometria Cognitiva e Trigger Predittivo

Per evitare interruzioni frustranti (finestre popup invasive) che spezzano lo "Stato di Flusso" autoriale, il sistema non si avvia con un banale pulsante "Controlla Errori".

- **Keystroke Dynamics:** Attaccare event listener al div principale di BlockNote per calcolare il **Dwell Time** (millisecondi in cui il tasto rimane premuto) e il **Flight Time** (millisecondi tra due tasti).
- **Cognitive Load Correlation (CLC):** Misurando variazioni brusche in questi delta temporali combinati all'aumento di pattern correttivi (frequenti battute del tasto Backspace), il client frontend estrapola un'irregolarità ritmica. Quest'anomalia è l'esatta impronta digitale dell'**esitazione cognitiva** dell'autore (incertezza creativa). È unicamente a fronte del superamento di tale soglia probabilistica locale che il client emette in modo autonomo la chiamata RAG.

### 5.4 Logic Check Prompt Engineering

Per scovare veri "Plot Hole" (incoerenze narrative), non basta la semplice similarità vettoriale. Il prompt deve costringere l'LLM a eseguire un confronto logico.

**Pattern Prompting:** Costruire un prompt che imponga all'LLM l'assunzione del ruolo di un **"Revisore Analitico"**. [22]

1. **Decomposizione Fatti (Fact Extraction):** Istruire l'LLM a scomporre prima la nuova scena digitata dall'autore in mere preposizioni o assunzioni di stato, privandola della "verbosità retorica". [22]
2. **Restrizione Output in JSON:** Usare l'istruzione di JSON-Structured Prompting. Costringere il modello a rispondere in **formato JSON rigido**. [24] Le chiavi obbligatorie devono includere un array `evidence_chains`. [22] Questo array conterrà le citazioni letterali estratte dalla Story Bible (e fornite in contesto al prompt dal modulo HNSW locale) che dimostrano all'utente la ragione del conflitto, innescando a frontend l'inserimento di un marker visivo (**Semantic Highlighting**) sul testo specifico in BlockNote. L'imposizione del formato JSON garantisce il parsing deterministico del frontend ed incrementa empiricamente la coesione logica del LLM fino al 9%. [24]

---

## Bibliografia

1. [Custom Blocks - BlockNote](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks)
2. [Toggleable Custom Blocks - BlockNote](https://www.blocknotejs.org/examples/custom-schema/toggleable-blocks)
3. [Alert Block with Full UX - BlockNote](https://www.blocknotejs.org/examples/custom-schema/alert-block-full-ux)
4. [Custom Inline Content Types - BlockNote](https://www.blocknotejs.org/docs/features/custom-schemas/custom-inline-content)
5. [Suggestion Menus - BlockNote](https://www.blocknotejs.org/docs/react/components/suggestion-menus)
6. [Libsodium Quick Reference - Paragon Initiative Enterprises Blog](https://paragonie.com/blog/2017/06/libsodium-quick-reference-quick-comparison-similar-functions-and-which-one-use)
7. [datadayrepos/libsodium-wrapper - GitHub](https://github.com/datadayrepos/libsodium-wrapper)
8. [Web Cryptography API Level 2 - W3C](https://w3c.github.io/webcrypto/)
9. [Implementing AES-GCM Encryption in JavaScript - Haikel Fazzani](https://www.haikel-fazzani.eu.org/blog/post/javascript-cryptography-aes-gcm)
10. — *(non utilizzato)*
11. [End to end encryption with schema validation - Yjs Community](https://discuss.yjs.dev/t/end-to-end-encryption-with-schema-validation/2263) | [nikgraf/secsync - GitHub](https://github.com/nikgraf/secsync)
12. [Wasm Workers API — Emscripten documentation](https://emscripten.org/docs/api_reference/wasm_workers.html)
13. [SharedArrayBuffer and Memory Management in JavaScript - Medium](https://medium.com/@artemkhrenov/sharedarraybuffer-and-memory-management-in-javascript-06738cda8f51) | [SharedArrayBuffer - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
14. — *(non utilizzato)*
15. [onnxruntime-web - NPM](https://www.npmjs.com/package/onnxruntime-web)
16. [On device models in the browser via WebAssembly and WebGPU - DEV](https://dev.to/aileenvl/on-device-models-and-how-they-work-in-the-browser-thanks-to-web-assembly-and-webgpu-5bo6)
17. [Nomic-Embed-Text-V1 Overview - Emergent Mind](https://www.emergentmind.com/topics/nomic-embed-text-v1)
18. [ShravanSunder/hnswlib-wasm - GitHub](https://github.com/ShravanSunder/hnswlib-wasm)
19. [Zero Data Retention in LLM-based Enterprise AI Assistants - arXiv](https://arxiv.org/pdf/2510.11558) | [Literature Review](https://www.themoonlight.io/en/review/zero-data-retention-in-llm-based-enterprise-ai-assistants-a-comparative-study-of-market-leading-agentic-ai-products)
20. — *(PII Masking, best practice interna)*
21. [The Production WebSocket Manifesto - Medium](https://medium.com/@uzma.webdev/the-production-websocket-manifesto-engineering-for-the-ugly-states-7dc97d074c53)
22. [Finding Flawed Fictions: Plot Hole Detection - arXiv](https://arxiv.org/abs/2504.11900) | [HTML version](https://arxiv.org/html/2504.11900v3)
23. — *(non utilizzato)*
24. [Enhancing AI Code Generation and Logical Reasoning using JSON-Structured Prompting - IJARSCT](https://ijarsct.co.in/Paper29963.pdf)
