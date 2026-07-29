# Client Notification — WhatsApp Channel Collector

## Project Overview

Standalone Node.js + TypeScript service that captures WhatsApp messages and persists them to MySQL. This is a **data collector** — other systems consume the MySQL database directly.

## Tech Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| Node.js + TypeScript | Runtime + types | ES2022, strict mode |
| @whiskeysockets/baileys | WhatsApp Web API | ^7.0.0-rc14 |
| mysql2 | MySQL driver | ^3.x |
| pino | Logging (Baileys native) | ^9.x |
| dotenv | Environment config | ^16.x |
| tsx | Dev runner with watch | ^4.x |

## Project Structure

```
client-notification/
├── src/
│   ├── db/
│   │   ├── schema.ts       # MySQL schema (chats, messages, sync_state)
│   │   └── index.ts        # MySQL connection
│   ├── whatsapp/
│   │   ├── client.ts       # makeWASocket + connection + reconnection
│   │   ├── handler.ts      # messages.upsert → persist + idempotency
│   │   └── sync.ts         # History gap fill on reconnection
│   ├── dispatch/
│   │   ├── classifier.ts   # Gate-based dispatch classifier
│   │   ├── extractor.ts    # Regex field extractor
│   │   ├── matcher.ts      # Company matching (Levenshtein + word overlap)
│   │   ├── companies.json  # Static company data
│   │   ├── types.ts        # DispatchFields, ClassificationResult
│   │   └── index.ts        # Barrel exports
│   ├── config.ts           # dotenv config (typed)
│   └── index.ts            # Entry point
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## Database Schema (MySQL)

### chats
- `jid` (VARCHAR(255), PK) — WhatsApp chat JID
- `created_at` (TIMESTAMP) — Creation timestamp

### messages
- `id` (INT, PK AUTO_INCREMENT)
- `chat_jid` (VARCHAR(255), FK → chats.jid)
- `message_id` (VARCHAR(255), UNIQUE) — **Idempotency key**
- `sender` (VARCHAR(255)) — Message sender
- `content` (TEXT) — Raw JSON payload
- `message_type` (VARCHAR(50)) — Message type (text, image, etc.)
- `timestamp` (INT) — Message timestamp
- `created_at` (TIMESTAMP) — Insertion timestamp
- + 30+ processed fields for text, media, location, contacts, etc.

### sync_state
- `chat_jid` (VARCHAR(255), PK, FK → chats.jid)
- `last_message_id` (VARCHAR(255)) — Last processed message ID
- `last_timestamp` (INT) — Last processed timestamp
- `last_sync_at` (INT) — Last sync timestamp

## Design Principles

- **KISS + YAGNI strictly** — no anticipatory abstractions
- **No repository pattern** — raw MySQL queries
- **No controllers/services/DTOs** — no web framework exists here
- **Raw payload storage** — store JSON, extract only what's queried
- **Idempotency via UNIQUE** — `message_id` constraint + check before insert

## Environment Variables

### WhatsApp

```bash
# MONITOR_JID — Identificador del chat/grupo a monitorear (JID)
#
# Formatos de JID en WhatsApp:
#
#   CHAT INDIVIDUAL (1:1):
#     numero@s.whatsapp.net  ← Formato viejo (número de teléfono).
#                               Ejemplo: 584129338026@s.whatsapp.net
#
#     id@lid                 ← Formato nuevo (LID). El ID es un identificador
#                               INTERNO de WhatsApp, NO es el número de teléfono.
#                               Ejemplo: 15277450379385@lid
#                               (corresponde al número 584129338026)
#
#   GRUPO:
#     id@g.us                ← Grupo con múltiples participantes.
#                               Ejemplo: 120363329903619153@g.us
#
#   CANAL:
#     id@newsletter          ← Canal de difusión.
#
# CÓMO OBTENER EL JID CORRECTO:
#
#   CHAT INDIVIDUAL (recomendado):
#     1. Iniciar el collector con MONITOR_JID vacío o con un valor temporal
#     2. Enviar un mensaje desde OTRO teléfono a tu chat personal
#     3. En los logs aparece: "remoteJid: XXXXX"
#        Ejemplo: "remoteJid: 15277450379385@lid"
#     4. Copiar ese JID exacto aquí
#
#   GRUPO:
#     1. Mismos pasos que arriba
#     2. En grupos el remoteJid es el JID del grupo (formato @g.us)
#     3. El participant indica quién envió el mensaje
#
#   NOTA: El JID @lid es específico de TU sesión de WhatsApp.
#         No hay forma de convertir un número a @lid sin iniciar sesión.
#         Es estable mientras no borres ./auth. Si WhatsApp te desloguea
#         o borrás ./auth, el LID puede cambiar — volvé a obtenerlo con el método anterior.
#
# En grupos: remoteJid = JID del grupo, participant = quién envió el mensaje
MONITOR_JID=120363329903619153@g.us

# Dirección de captura: incoming, outgoing, o both
CAPTURE_DIRECTION=incoming

# Clasificador de despachos: true para habilitar
DISPATCH_ENABLED=true
```

### Base de datos

```bash
DB_HOST=localhost
DB_PORT=3306
DB_USER=reader_notification
DB_PASSWORD=password123
DB_NAME=client_notification
```

### App

```bash
AUTH_DIR=./auth               # Directorio de sesión WhatsApp
LOG_LEVEL=info                # trace|debug|info|warn|error|fatal
```

## Available Scripts

```bash
npm run dev          # Dev mode with watch (tsx watch)
npm run build        # Compile TypeScript
npm start            # Run compiled output
```

## Key APIs Used

### Baileys
- `makeWASocket()` — Create WhatsApp connection
- `useMultiFileAuthState()` — Persist session to disk
- `sock.ev.on('messages.upsert')` — Capture incoming messages
- `sock.ev.on('connection.update')` — Handle reconnection
- `sock.ev.on('creds.update', saveCreds)` — Persist auth state

### MySQL2
- `mysql.createPool()` — Create connection pool
- `conn.execute()` — Run queries

## Conventions

- **ES Modules** — `"type": "module"` in package.json
- **Strict TypeScript** — `strict: true`, no `any` when avoidable
- **Functional over class-based** — exports functions, not classes
- **Pino for logging** — Baileys uses it natively, consistent logging
- **No emojis in code** — user preference

## Out of Scope (explicitly)

- HTTP/REST API
- AI/ML processing
- Message sending (read-only collector)
- Multi-tenant support
- Message queues (Redis, Kafka)
- UI/admin panel
- E2E tests against real WhatsApp

## Git Conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, etc.
- No AI attribution or "Co-Authored-By" tags
- Each implementation step = 1 manual commit

## npm v12 Workaround (EALLOWSCRIPTS)

Baileys from GitHub has a `prepare` script that npm v12 blocks by default. If `npm install` fails with `EALLOWSCRIPTS`:

```bash
# 1. Clean everything
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

# 2. Remove any allow-scripts config that may have been set
npm config delete allow-scripts

# 3. Install fresh
npm install

# 4. Review and approve pending scripts
npm approve-scripts --allow-scripts-pending
```

The `allowScripts` field in `package.json` must use pinned versions (e.g., `"@whiskeysockets/baileys@7.0.0-rc13": true`).
