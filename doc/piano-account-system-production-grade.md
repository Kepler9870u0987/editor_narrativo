# Piano Account System Production-Grade

## 1. Stato attuale del progetto

Il repository oggi non contiene un vero sistema account applicativo.

Esiste solo:

- verifica JWT lato `proxy-backend`
- uso del claim `sub` come `userId`
- sessioni WebSocket legate all'utente autenticato
- primitive crypto client-side per KEK, DEK, wrapping e signing key

Non esistono ancora:

- registrazione utente
- login/logout applicativo
- refresh token
- profilo utente
- verifica email
- reset password
- MFA / passkeys
- database utenti
- gestione device/sessioni
- recupero account zero-knowledge
- frontend login/unlock

Conclusione: il sistema attuale e' un resource server che consuma identita' gia' emesse altrove, non un identity/account system completo.

## 2. Obiettivo production-grade

L'obiettivo corretto per questo prodotto e' un sistema con doppio piano:

1. **Account/Auth plane**
   Gestisce identita', accesso, sessioni, verifica email, MFA, device e policy.

2. **Zero-knowledge unlock plane**
   Gestisce sblocco locale dei dati cifrati senza che il server possa leggere il contenuto.

Questa separazione e' obbligatoria. In un prodotto come questo "password di login" e "chiave di sblocco dei dati" non devono essere trattate come la stessa cosa per default.

## 3. Architettura consigliata

### 3.1 Servizi

- `proxy-backend`
  Resta il resource server per LLM proxy e WebSocket streaming.
- `account-backend` nuovo
  Espone auth, account, sessioni, email verification, recovery e device management.
- `frontend` futuro
  Implementa login, unlock, gestione chiavi, device UX e session management.

### 3.2 Regola architetturale

- `proxy-backend` non deve piu' emettere token in produzione.
- `proxy-backend` deve solo verificare access token firmati dal sistema account.
- la logica utenti, sessioni e recovery non va messa nel proxy ZDR.

### 3.3 Tipo di token

Per produzione non consiglierei HS256 condiviso tra servizi.

Target:

- access token firmato con chiave asimmetrica (`EdDSA` o `ES256`)
- pubblicazione chiave pubblica / JWKS interno
- verifica lato `proxy-backend` tramite chiave pubblica, non shared secret

Questo riduce il blast radius e separa bene issuer e consumer.

## 4. Modello utente consigliato

### 4.1 Entita' principali

#### `users`

- `id` UUID
- `email_normalized`
- `email_verified_at`
- `status` (`pending`, `active`, `locked`, `disabled`)
- `display_name`
- `created_at`
- `updated_at`
- `last_login_at`

#### `auth_credentials`

- `user_id`
- `type` (`password`, `passkey`)
- `password_hash` se presente
- `password_algo_version`
- `passkey_id`
- `created_at`
- `last_used_at`

#### `user_sessions`

- `id` UUID
- `user_id`
- `refresh_token_family_id`
- `refresh_token_hash`
- `device_name`
- `user_agent`
- `ip_created`
- `ip_last_seen`
- `created_at`
- `last_seen_at`
- `expires_at`
- `revoked_at`
- `revocation_reason`

#### `email_verification_tokens`

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `used_at`

#### `password_reset_tokens`

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `used_at`

#### `mfa_factors`

- `id`
- `user_id`
- `type` (`totp`, `webauthn`)
- `secret_encrypted` se applicabile
- `recovery_codes_hash`
- `enabled_at`

#### `wrapped_key_material`

- `user_id`
- `wrapped_dek`
- `argon2_salt`
- `wrapped_signing_secret_key`
- `signing_public_key`
- `kek_version`
- `created_at`
- `updated_at`

Questa tabella e' centrale per il modello zero-knowledge.

#### `audit_events`

- `id`
- `user_id` nullable
- `session_id` nullable
- `event_type`
- `occurred_at`
- `ip`
- `user_agent`
- `risk_score`
- `metadata_redacted`

## 5. Flussi utente consigliati

### 5.1 Registrazione

Flusso production-grade:

1. L'utente crea account con email + password oppure passkey.
2. Il backend crea `user` in stato `pending`.
3. Il sistema invia email di verifica con token one-time.
4. Dopo la verifica email, il frontend esegue bootstrap crittografico:
   - genera DEK locale
   - genera signing keypair locale
   - chiede una **unlock secret** locale oppure configura un passkey di unlock
   - deriva KEK in locale con Argon2id
   - wrappa DEK e signing secret key
   - invia al backend solo materiale cifrato
5. Lo stato account passa a `active`.

### 5.2 Login

Flusso consigliato:

1. Autenticazione account:
   - password oppure passkey
   - MFA se richiesto
2. Il backend emette:
   - access token breve
   - refresh token ruotabile in cookie `HttpOnly`, `Secure`, `SameSite=Strict` o `Lax`
3. Il frontend scarica `wrapped_key_material`
4. L'utente sblocca i dati:
   - inserisce unlock secret locale
   - oppure usa passkey di unlock
5. Il client deriva la KEK, unwrap DEK e signing key e mantiene il materiale solo in memoria volatile.

### 5.3 Logout

- logout del solo device corrente
- revoke del refresh token corrente
- purge del materiale crittografico volatile client-side
- chiusura sessioni WebSocket aperte

### 5.4 Logout globale

- revoke di tutta la token family o di tutte le sessioni dell'utente
- invalidazione access token tramite breve TTL + versioning / denylist limitata

### 5.5 Reset password

Va separato in modo rigoroso:

- **reset password di account**: possibile via email token
- **reset unlock secret**: non puo' recuperare i dati esistenti senza recovery material

Questo va spiegato chiaramente in UX. In zero-knowledge vero non esiste "ti resetto la password e recuperi tutto" senza introdurre escrow.

## 6. Separazione obbligatoria: auth password vs unlock secret

Questa e' la decisione di prodotto piu' importante.

### Opzione raccomandata

- **Auth password / passkey**
  Serve ad autenticarsi al servizio.
- **Unlock secret**
  Serve a derivare la KEK e sbloccare localmente i dati.

Vantaggi:

- recovery account possibile senza mentire sul modello zero-knowledge
- compromissione parziale dell'account non implica automaticamente lettura dei dati
- maggiore chiarezza nei flussi operativi

### Cosa NON fare

Non usare direttamente la password di login come unica chiave di cifratura dei dati senza una strategia di recovery esplicita. Porta quasi sempre a UX debole o a promesse di sicurezza incoerenti.

## 7. Strategia di sessione production-grade

### 7.1 Access token

- TTL: 5-15 minuti
- contiene `sub`, `sid`, `iss`, `aud`, `exp`, `iat`, `jti`
- scope minimi, niente payload gonfiato

### 7.2 Refresh token

- opaco, non JWT
- hashato a database
- rotazione ad ogni refresh
- rilevamento reuse
- family revocation in caso di replay

### 7.3 Cookie

- `HttpOnly`
- `Secure`
- `SameSite=Lax` o `Strict`
- path ristretto

### 7.4 Gestione device

L'utente deve poter vedere:

- device attivi
- ultimo accesso
- IP approssimato / paese
- revoke per device

## 8. MFA e passkeys

### Raccomandazione

Baseline production-grade:

- passkeys supportate dal day 1
- TOTP come fallback
- recovery codes one-time

### Policy

- MFA obbligatoria per admin
- MFA step-up per operazioni sensibili:
  - cambio email
  - rotazione unlock setup
  - export recovery kit
  - revoke globale sessioni

## 9. Recovery zero-knowledge

Qui serve una decisione di prodotto esplicita.

### Modello piu' coerente con zero-knowledge

- il server non puo' recuperare la KEK
- l'utente riceve un **Recovery Kit** exportabile localmente
- il recovery kit contiene materiale per rewrappare il DEK
- il recovery kit deve essere:
  - mostrato una volta
  - scaricabile cifrato
  - stampabile / salvabile offline

### Opzione enterprise opzionale

Solo se il prodotto lo richiede:

- escrow opzionale lato organizzazione
- attivabile tenant-by-tenant
- separato dal default consumer/privacy-first

Se attivato, va dichiarato come compromesso intenzionale del modello zero-knowledge puro.

## 10. Autorizzazione

Per la prima versione:

- modello owner-only sui documenti
- ogni documento appartiene a un solo `user_id`

Per evoluzione:

- organizzazioni
- workspace
- ruoli (`owner`, `editor`, `viewer`, `admin`)
- membership e ACL

Importante: la crittografia collaborativa richiedera' condivisione del DEK o envelope encryption per destinatario. Questo va progettato prima di introdurre collaborazione multiutente reale.

## 11. API consigliate

### Auth / account

- `POST /auth/register`
- `POST /auth/verify-email`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `POST /auth/mfa/totp/setup`
- `POST /auth/mfa/totp/verify`
- `POST /auth/passkeys/register/start`
- `POST /auth/passkeys/register/finish`
- `POST /auth/passkeys/login/start`
- `POST /auth/passkeys/login/finish`

### User / device

- `GET /me`
- `PATCH /me`
- `GET /me/sessions`
- `DELETE /me/sessions/:id`

### Zero-knowledge bootstrap

- `POST /me/keys/bootstrap`
- `GET /me/keys/material`
- `POST /me/keys/rotate-unlock`
- `POST /me/keys/recovery/export`
- `POST /me/keys/recovery/import`

## 12. Sicurezza applicativa

### 12.1 Password hashing server-side

Se il login usa password:

- Argon2id server-side
- pepper applicativo in secret manager
- rehash policy per upgrade parametri

La Argon2 client-side per KEK non sostituisce l'hashing password server-side.

### 12.2 Secret management

- chiavi firma token in secret manager
- rotazione chiavi pianificata
- `kid` nei token
- supporto multi-key durante rotazione

### 12.3 CSRF / XSS

- refresh token solo in cookie HttpOnly
- CSRF token per endpoint cookie-authenticated non idempotenti
- CSP restrittiva sul frontend
- Trusted Types se possibile

### 12.4 Abuse protection

- rate limit per IP, email e device fingerprint debole
- cooldown su tentativi login
- lockout progressivo, non permanente
- detection su password reset flood
- email verification replay protection

### 12.5 Audit

Audit event per:

- register
- verify email
- login success/fail
- refresh token reuse
- MFA enable/disable
- password reset
- session revoke
- unlock rotation
- recovery export/import

Mai loggare:

- prompt utente
- unlock secret
- KEK/DEK
- token completi
- recovery kit

## 13. Sicurezza operativa

### Logging e observability

- structured logging con redaction
- trace id / request id
- metriche login, refresh, revoke, MFA, email failures
- alert su refresh reuse, spike login fail, verification abuse

### Backup

Fare backup di:

- metadata account
- wrapped key material
- audit log

Non servono backup di plaintext per definizione.

### Compliance readiness

Da prevedere:

- data export account metadata
- deletion / right to erasure
- retention policy per audit e sessioni
- consenso e informativa per telemetria

## 14. Impatto sul monorepo

### Nuovi moduli consigliati

- `packages/account-backend`
- `packages/account-shared`
- `packages/frontend` o `apps/frontend`

### Modifiche a `proxy-backend`

- sostituire config JWT simmetrica con verifica issuer pubblico
- accettare claim `sid`
- opzionalmente verificare scope / audience dedicata al proxy
- non gestire direttamente registrazione o refresh token

### Modifiche frontend future

- pagina register
- pagina login
- pagina verify email
- flow unlock locale
- gestione sessioni e device
- export/import recovery kit

## 15. Piano di implementazione consigliato

### Fase A - Fondazioni account

- schema database utenti/sessioni/token
- auth service separato
- email verification
- login/logout/refresh
- pagina login basilare

### Fase B - Zero-knowledge bootstrap

- bootstrap wrapped DEK
- unlock locale
- fetch key material
- logout con purge memoria

### Fase C - Sicurezza forte

- passkeys
- TOTP
- recovery kit
- device management
- audit trail

### Fase D - Hardening produzione

- JWKS / key rotation
- secret manager
- CSP / CSRF
- alerting
- runbook incidenti auth

## 16. Requisiti minimi per dichiararlo production-grade

Non considererei il sistema production-grade senza tutti questi punti:

- email verification
- refresh token rotation con reuse detection
- session revocation per device
- access token breve
- passkeys o MFA
- separazione auth/unlock
- recovery zero-knowledge esplicitamente progettato
- audit log redatto
- rate limiting e abuse protection
- secret rotation
- key material wrappato lato client
- test E2E su register/login/refresh/logout/revoke/unlock

## 17. Raccomandazione finale

Per questo progetto la soluzione migliore e' costruire:

- **account system classico ma robusto** per identita' e sessioni
- **zero-knowledge key system separato** per lo sblocco dei contenuti

Se si tenta di fonderli in un unico concetto di "password utente", si rischia un sistema piu' fragile, piu' difficile da spiegare e meno onesto dal punto di vista sicurezza.

Il prossimo passo corretto non e' partire dal frontend login, ma:

1. definire schema DB account/sessioni
2. progettare il contratto API auth + keys
3. aggiornare `proxy-backend` per trustare un issuer esterno
4. solo dopo implementare UX `register/login/unlock`
