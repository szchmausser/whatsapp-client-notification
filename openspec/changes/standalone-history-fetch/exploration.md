# Exploration: standalone-history-fetch

## Current State

The `client-notification` project is a WhatsApp data collector using Baileys. Key architectural elements relevant to this change:

### WhatsApp Connection (`src/whatsapp/client.ts`)

- `createClient(authDir, onSocketCreated?)` — factory function returning `ClientResult` (getSocket, onReady, onReconnect, restart)
- Uses `makeWASocket` with `syncFullHistory: true`, `markOnlineOnConnect: false`
- Has `shouldSyncHistoryMessage` filter: rejects FULL sync type + chunks older than 3 days (`SYNC_MAX_AGE_DAYS = 3`)
- Built-in reconnection with exponential backoff — NOT suitable for a script that needs controlled exit

### Message Processing (`src/whatsapp/message-processor.ts`)

- `processMessage(opts)` — shared logic for field extraction + DB insert + dispatch classification
- Idempotency via `message_id` UNIQUE constraint + check-before-insert (lines 84-92)
- Returns `ProcessResult` with `skipped`, `classified`, `error` fields
- Already referenced as used by `scripts/fetch-day.ts` in its header comment (file doesn't exist yet)

### History Sync (`src/whatsapp/sync.ts`)

- `setupHistorySyncListener` — listens to `messaging-history.set` event, processes messages via `processMessage`
- Filters by chat JID list, uses `isLatest` flag (logged but NOT used for control flow)
- `fetchOlderMessages` — manual pagination via `socket.fetchMessageHistory(count, key, timestamp)` (max 50 per query)
- `messaging-history.status` event is NOT currently used anywhere in the codebase

### Database (`src/db/index.ts`, `src/db/schema.ts`)

- `createDb(config)` — creates mysql2 pool + drizzle wrapper
- `messages` table has `message_id VARCHAR(255) UNIQUE` — idempotency guarantee
- `sync_state` table tracks last processed message per chat
- `dispatch_notifications` table for classified dispatches

### Config (`src/config.ts`)

- `loadConfig()` — reads from .env, returns typed `Config` object
- Includes `authDir` (default `./auth`), `chatJid`, `db`, `captureDirection`, `dispatchEnabled`

## Affected Areas

| File | Impact |
|------|--------|
| `src/scripts/fetch-day.ts` | NEW — the standalone script (referenced in message-processor.ts comment but doesn't exist) |
| `src/whatsapp/message-processor.ts` | Reuse `processMessage` directly (already designed for this) |
| `src/db/index.ts` | Reuse `createDb` (pool creation is generic) |
| `package.json` | Add `fetch:day` npm script |
| `.env.example` | Document new env vars for fetch script |

## Approaches

### 1. Direct `makeWASocket` (recommended)

Script creates its own socket with `makeWASocket` + `useMultiFileAuthState('./auth-fetch')`.

- **Pros**: Full control over `shouldSyncHistoryMessage`, reconnection behavior, exit logic. Clean separation from main service.
- **Cons**: Duplicates some connection setup code (~20 lines).
- **Effort**: Low

### 2. Reuse `createClient`

Call `createClient('./auth-fetch', onSocketCreated)` and override behavior via callbacks.

- **Pros**: Less code duplication.
- **Cons**: `createClient` has built-in infinite reconnection — script can't control exit cleanly. The `shouldSyncHistoryMessage` filter is hardcoded for 3 days. Would need to modify `createClient` to accept custom filter, which changes the main service's API.
- **Effort**: Medium (requires refactoring `createClient`)

### 3. Extend `createClient` with options

Add `filter`, `maxRetries`, `onComplete` options to `createClient`.

- **Pros**: Reusable for both main service and scripts.
- **Cons**: Adds complexity to the main service's connection logic. YAGNI — the main service doesn't need these options.
- **Effort**: Medium-High

## Recommendation

**Approach 1: Direct `makeWASocket`**. The script is a standalone tool with fundamentally different lifecycle (connect → sync → exit) than the main service (connect → stay alive → reconnect). Trying to share the connection logic creates more problems than it solves.

The script should:
- Use `makeWASocket` directly with `syncFullHistory: true`
- Set `shouldSyncHistoryMessage` to accept ALL chunks (no age filter — we need full history for the target date)
- Listen to `messaging-history.set` for messages + `messaging-history.status` for completion
- Filter messages by date in the event handler (not in `shouldSyncHistoryMessage`)
- Reuse `processMessage` from `message-processor.ts` (already designed for this)
- Reuse `createDb` from `db/index.ts` (generic pool creation)
- Exit cleanly when `messaging-history.status` fires with `status: 'complete'`

## Key Technical Details

### Baileys History Sync Events

- `messaging-history.set`: `{ messages, chats, contacts, isLatest, progress?, syncType? }` — fires per chunk
- `messaging-history.status`: `{ syncType, status: 'complete' | 'paused', explicit }` — fires when sync finishes
- `isLatest` in `messaging-history.set` indicates the final chunk (but `messaging-history.status` is more reliable for completion)

### Date Filtering Strategy

- Parse CLI date (DD-MM-YYYY) → convert to Unix timestamp range [startOfDay, endOfDay]
- In `messaging-history.set` handler: filter `msg.messageTimestamp` within range
- Reject chunks where ALL messages are outside range (optimization, not required)

### Auth Persistence

- `useMultiFileAuthState('./auth-fetch')` persists session to `./auth-fetch/` directory
- First run requires QR scan; subsequent runs reuse persisted credentials
- Separate from `./auth` (main service) — no interference

### Sync Completion Detection

- Primary signal: `messaging-history.status` with `status: 'complete'`
- Fallback: `messaging-history.set` with `isLatest: true` + `progress: 100`
- Safety: timeout after N minutes (configurable) to prevent hanging

### CLI Interface

```
npx tsx src/scripts/fetch-day.ts <date> [options]
  --jid <JID>         Chat JID to fetch (or MONITOR_JID from env)
  --direction <dir>   incoming|outgoing|both (default: both)
  --dispatch          Enable dispatch classification
  --timeout <minutes> Max wait for sync (default: 10)
```

## Risks

1. **Chunk granularity**: Baileys may send chunks spanning multiple days. Accepting all chunks means processing messages outside the target date — acceptable for correctness, slight memory overhead.
2. **QR scan on first run**: The script needs its own auth. First run requires QR scan. If the user runs it headless, this is a blocker. Mitigation: document clearly, consider headless auth export from main service.
3. **Concurrent runs**: Running the script while the main service is connected to the SAME auth directory would cause session conflicts. Using `./auth-fetch` prevents this, but running TWO fetch scripts simultaneously would conflict. Mitigation: document single-instance requirement.
4. **Large history for old dates**: Fetching messages from months ago requires Baileys to sync potentially massive history. The `shouldSyncHistoryMessage` filter controls which chunks are accepted. For old dates, we may need to accept more chunks, increasing memory usage.
5. **No progress feedback**: Baileys doesn't provide per-message progress for history sync. The `progress` field in `messaging-history.set` is optional and may not be reliable. Mitigation: log message counts per chunk, rely on `messaging-history.status` for completion.

## Ready for Proposal

Yes. The exploration is complete with a clear technical direction (Approach 1: Direct `makeWASocket`). All key questions are answered. The script has a well-defined architecture: standalone entry point, own auth, reuse `processMessage` and `createDb`, date filtering in event handler, completion via `messaging-history.status`.
