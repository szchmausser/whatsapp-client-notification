# Client Notification — WhatsApp Channel Collector

## Project Overview

Standalone Node.js + TypeScript service that captures WhatsApp Channel messages and persists them to SQLite. This is a **data collector** — other systems consume the SQLite DB directly.

## Tech Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| Node.js + TypeScript | Runtime + types | ES2022, strict mode |
| @whiskeysockets/baileys | WhatsApp Web API | github:edge |
| Drizzle ORM | Schema + migrations | latest |
| better-sqlite3 | SQLite driver (synchronous) | ^12.x |
| pino | Logging (Baileys native) | ^9.x |
| dotenv | Environment config | ^16.x |
| tsx | Dev runner with watch | ^4.x |

## Project Structure

```
client-notification/
├── src/
│   ├── db/
│   │   ├── schema.ts       # Drizzle schema (channels, messages, sync_state)
│   │   └── index.ts        # Init DB + migrate
│   ├── whatsapp/
│   │   ├── client.ts       # makeWASocket + connection + reconnection
│   │   └── handler.ts      # messages.upsert → persist + idempotency
│   ├── config.ts           # dotenv config (typed)
│   └── index.ts            # Entry point
├── drizzle/                # Generated migrations (DO commit)
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## Database Schema (SQLite via Drizzle)

### channels
- `jid` (TEXT, PK) — WhatsApp channel JID ending in @newsletter
- `name` (TEXT) — Channel name
- `description` (TEXT) — Channel description
- `created_at` (INTEGER) — Creation timestamp

### messages
- `id` (INTEGER, PK AUTOINCREMENT)
- `channel_jid` (TEXT, FK → channels.jid)
- `message_id` (TEXT, UNIQUE) — **Idempotency key**
- `sender` (TEXT) — Message sender
- `content` (TEXT) — Raw JSON payload
- `message_type` (TEXT) — Message type (text, image, etc.)
- `timestamp` (INTEGER) — Message timestamp
- `created_at` (INTEGER) — Insertion timestamp

### sync_state
- `channel_jid` (TEXT, PK, FK → channels.jid)
- `last_message_id` (TEXT) — Last processed message ID
- `last_timestamp` (INTEGER) — Last processed timestamp
- `last_sync_at` (INTEGER) — Last sync timestamp

## Design Principles

- **KISS + YAGNI strictly** — no anticipatory abstractions
- **No repository pattern** — Drizzle IS the data access layer
- **No controllers/services/DTOs** — no web framework exists here
- **Raw payload storage** — store JSON, extract only what's queried
- **Idempotency via UNIQUE** — `message_id` constraint + INSERT OR IGNORE

## Environment Variables

```bash
CHANNEL_JID=     # WhatsApp channel JID (must end with @newsletter)
DB_PATH=./data/collector.db  # SQLite database path
LOG_LEVEL=info   # trace|debug|info|warn|error|fatal
```

## Available Scripts

```bash
npm run dev          # Dev mode with watch (tsx watch)
npm run build        # Compile TypeScript
npm start            # Run compiled output
npm run db:generate  # Generate Drizzle migration
npm run db:migrate   # Run pending migrations
npm run db:push      # Push schema to DB (dev)
```

## Key APIs Used

### Baileys
- `makeWASocket()` — Create WhatsApp connection
- `useMultiFileAuthState()` — Persist session to disk
- `sock.ev.on('messages.upsert')` — Capture incoming messages
- `sock.ev.on('connection.update')` — Handle reconnection
- `sock.newsletterFetchMessages()` — Backfill historical messages
- `sock.ev.on('creds.update', saveCreds)` — Persist auth state

### Drizzle ORM
- `sqliteTable()` — Define table schema
- `drizzle-kit generate` — Create migration files
- `drizzle-kit migrate` — Apply migrations
- `migrate(db)` — Programmatic migration on startup

### better-sqlite3
- `new Database(path)` — Open/create SQLite file
- `db.pragma('journal_mode = WAL') — Enable WAL for performance`

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
