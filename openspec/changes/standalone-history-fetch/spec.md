# History Fetch Day — Specification

## Purpose

On-demand WhatsApp history fetch for a single date. CLI script connects an independent session, requests full history sync, filters messages to the target date, persists via `processMessage`, and exits.

## Requirements

### R1: Date argument parsing

The script MUST accept `DD-MM-YYYY` and reject invalid formats with exit code 1 and a stderr message.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Valid date | Invoked as `fetch-day.ts 29-07-2026` | Argument parsed | Epoch bounds computed, processing proceeds |
| Malformed | Invoked as `fetch-day.ts not-a-date` | Argument validated | Logs "Invalid date format" to stderr, exits 1 |

### R2: Verbose logging flag

The script SHOULD accept `--verbose`. When absent, only per-chunk progress and a summary line print. When present, each message is logged individually.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Default | Runs without `--verbose` | Messages processed | Per-chunk counts + summary: `"Fetch complete: {processed} processed, {skipped} skipped, {errors} errors for {date}"` |
| Verbose | Runs with `--verbose` | Message processed | `"[status] {messageId} from {sender} at {timestamp}"` per message, plus summary |

### R3: WhatsApp connection lifecycle

The script MUST use its own auth directory (`./auth-fetch`) via `useMultiFileAuthState`. It MUST call `makeWASocket` directly. It MUST NOT reuse `createClient`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| First run | No auth in `./auth-fetch` | Socket starts | QR code printed, script waits for scan |
| Connection failure | Socket closes with error | `connection.update` fires `connection === 'close'` | Error logged to stderr, exits 1 |

### R4: History sync acceptance

The script MUST set `shouldSyncHistoryMessage: () => true`. Date filtering happens only in the event handler.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Accept all | Multiple `messaging-history.set` events | `shouldSyncHistoryMessage` evaluated | All messages accepted regardless of age |

### R5: Date-based message filtering

The script MUST filter messages in `messaging-history.set`. Only messages within the target date range MUST reach `processMessage`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| In range | Event has 50 msgs, 12 in target range | Handler filters | 12 passed to `processMessage`, chunk log shows 12 |

### R6: Persistence via processMessage

The script MUST reuse `processMessage`. `dispatchEnabled` reads from `DISPATCH_ENABLED` env.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Idempotent re-run | First run processes 12 msgs for 29-07-2026 | Second run for same date | 0 processed, 12 skipped, DB identical |

### R7: Clean exit on sync completion

The script MUST listen for `messaging-history.status: complete` and exit 0.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Normal | Sync completes with msgs | Status fires | Summary printed, exits 0 |
| Empty day | No msgs for target date | Sync finishes | `"No messages found for {date}"`, exits 0 |

### R8: Timeout fallback

The script MUST set a 120s timeout. If sync doesn't complete, it MUST log a warning and exit 2. Timeout SHOULD be configurable via `FETCH_TIMEOUT_MS`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Timeout | Sync incomplete after 120s | Timeout fires | Logs warning, exits 2 |

## Data Contracts

**CLI**: `npx tsx src/scripts/fetch-day.ts <DD-MM-YYYY> [--verbose]`

**Exit codes**: 0=success, 1=error (connection/args), 2=timeout/auth-needed

**Stdout** (default): `"Fetch complete: {p} processed, {s} skipped, {e} errors for {date}"` or `"No messages found for {date}"`

**Stdout** (verbose): Per-message `"[{status}] {id} from {sender} at {ts}"` + summary

**Env**: `MONITOR_JID` (req), `DB_HOST/PORT/USER/PASSWORD/NAME`, `DISPATCH_ENABLED`, `FETCH_TIMEOUT_MS` (default 120000)

## Dependencies

| Dependency | Source | Usage |
|------------|--------|-------|
| `processMessage` | `message-processor.ts` | Persist each matching message |
| `createDb` | `db/index.ts` | Database connection |
| `makeWASocket` | Baileys | WhatsApp connection, `syncFullHistory: true` |
| `useMultiFileAuthState` | Baileys | Auth in `./auth-fetch` |
| `qrcode-terminal` | npm | QR code display |

## Boundaries

- Single date only — no ranges in v1
- No modifications to `client.ts`, `handler.ts`, `sync.ts`
- No testing infrastructure in v1
- Single-instance requirement (concurrent runs unsupported)