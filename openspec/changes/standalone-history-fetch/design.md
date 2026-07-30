# Design: Standalone History Fetch

## Technical Approach

A single CLI script `src/scripts/fetch-day.ts` that opens a throwaway WhatsApp session via raw `makeWASocket`, requests full history sync, filters messages to one date using Unix timestamps (VET/UTC-4), persists matching messages through the existing `processMessage`, then exits cleanly. Zero changes to `client.ts`, `handler.ts`, or `sync.ts`.

## Architecture Decisions

### Decision: Single script file vs. module breakdown

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Single self-contained file | Simple, no cross-module coupling, easy to run as one-off | **Chosen** — the script has one exit path and one job |
| Split into lib/ + bin/ | Testable in isolation | Rejected — v1 has no test infrastructure (per spec boundary) |

The script is organized into internal sections (parse → connect → wait → sync → filter → persist → exit) within one file. No internal modules extracted in v1.

### Decision: Direct `makeWASocket` vs. reuse `createClient`

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Reuse `createClient` from client.ts | Looks DRY | **Rejected** — `createClient` is built for a permanently-running service with exponential backoff reconnect. The script needs connect→sync→exit, not resume→reconnect→loop. The two have fundamentally different lifecycles. |
| Call `makeWASocket` directly | Duplicates some socket config | **Chosen** — correct lifecycle, explicit, no hidden reconnect behavior |

### Decision: Date filtering location

| Option | Tradeoff | Decision |
|--------|----------|----------|
| In `shouldSyncHistoryMessage` | Short-circuits early, less data in memory | **Rejected** — Baileys passes chunk-level timestamps, not per-message. We'd reject a chunk containing a mix of in-range and out-of-range messages. |
| In `messaging-history.set` handler | Per-message precision | **Chosen** — compute target day's epoch range once, filter each message's `messageTimestamp` against it |

### Decision: Timezone anchor

VET is UTC-4 year-round (no DST in Venezuela since 2016). The date range is computed once at startup: `parse DD-MM-YYYY → VET midnight (00:00:00 UTC-4) → VET 23:59:59 UTC-4`. This avoids date-fns dependency — pure `Date.UTC` arithmetic.

## Data Flow

```
┌──────────────┐
│  process.argv │── DD-MM-YYYY, --verbose
└──────┬───────┘
       │ parseDate()
       ▼
┌──────────────────┐    ┌──────────────────┐
│  dateRangeEpochs  │    │  loadConfig()     │
│  {start, end}     │    │  from .env         │
└──────┬───────────┘    └────┬─────────────┘
       │                     │
       ▼                     ▼
┌──────────────────────────────────────────────┐
│  makeWASocket({ syncFullHistory: true })      │
│  auth: useMultiFileAuthState("./auth-fetch")  │
│  shouldSyncHistoryMessage: () => true          │
│  print QR if no auth                          │
└──────┬───────────────────────────────────────┘
       │
       ├── messaging-history.set ──► filter by date ──► processMessage(dispatchEnabled) ──► mysql
       ├── messaging-history.status ──► "complete" ──► close socket ──► exit 0
       ├── connection.update ──► "close" ──► log error ──► exit 1
       ├── creds.update ──► saveCreds
       └── timeout (120s) ──► close socket ──► exit 2
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/scripts/fetch-day.ts` | Create | Single script — entry point, all logic |
| `src/whatsapp/message-processor.ts` | (none) | Used as-is, import only |
| `src/db/index.ts` | (none) | Used as-is, import only |
| `src/config.ts` | (none) | Used as-is, import only |
| `src/whatsapp/client.ts` | (none) | Not touched — design constraint |

## Script Internal Structure (`src/scripts/fetch-day.ts`)

### Section 1: CLI Parsing (lines ~1–35)

Parse `process.argv`:
- `argv[2]`: date string in `DD-MM-YYYY` format. Reject with "^(\d{2})-(\d{2})-(\d{4})$" regex. Exit 1 on mismatch.
- `argv[3]` (optional): `--verbose` flag.

```typescript
const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;
```

### Section 2: Date Range Computation (lines ~36–65)

```typescript
function computeEpochRange(dateStr: string, timezoneOffset = -4): { start: number; end: number } {
  // DD-MM-YYYY → components
  // start = Date.UTC(year, month-1, day, 0, 0, 0) - timezoneOffset * 3600
  // end   = Date.UTC(year, month-1, day, 23, 59, 59) - timezoneOffset * 3600
  // return { start, end } (seconds)
}
```

VET = UTC-4 → offset is subtracted from UTC epoch. Pure arithmetic, no library needed.

### Section 3: Connection Setup (lines ~66–130)

```typescript
const { state, saveCreds } = await useMultiFileAuthState("./auth-fetch");
const sock = makeWASocket({
  auth: state,
  syncFullHistory: true,
  shouldSyncHistoryMessage: () => true,  // accept ALL chunks
  browser: ["Client Notification Fetch", "Chrome", "4.0.0"],
  printQRInTerminal: true,  // or manual via qrcode-terminal
});

// Register ALL handlers BEFORE connection resolves:
sock.ev.on("creds.update", saveCreds);
sock.ev.on("connection.update", handleConnectionUpdate);
sock.ev.on("messaging-history.set", handleHistorySet);
sock.ev.on("messaging-history.status", handleHistoryStatus);
sock.ev.on("messages.upsert", handleMessagesUpsert);
```

The `messaging-history.set` event fires BEFORE the `connection.open` event in Baileys — handlers must be registered synchronously after the socket is created.

### Section 4: Event Handlers (lines ~131–230)

**`messaging-history.set`** — bulk sync event. Contains an array of `messages[]` (WAMessage[]). Iterate, check `messageTimestamp` against range, call `processMessage` for matches.

```typescript
async function handleHistorySet({ messages, isLatest }: { messages: WAMessage[]; isLatest: boolean }) {
  let chunkMatch = 0;
  for (const msg of messages) {
    const ts = Number(msg.messageTimestamp);
    if (ts >= range.start && ts <= range.end) {
      chunkMatch++;
      const result = await processMessage({ db, chatJid, msg, dispatchEnabled });
      updateCounters(result);
    }
  }
  verbose && log per-message details;
  log chunk progress;
}
```

**`messaging-history.status`** — detect completion.

```typescript
function handleHistoryStatus(status: Baileys.HistorySyncStatus) {
  if (status === "complete") {
    clearTimeout(timeoutHandle);
    sock?.close();
    logSummary();
    process.exit(0);
  }
}
```

**`messages.upsert`** — real-time messages arriving during the fetch window (edge case). Same date filter + processMessage.

**`connection.update`** — detect close/errors. If `connection === "close"`, log error to stderr and exit 1.

### Section 5: Summary & Exit (lines ~231–280)

Counters tracked as module-level `let` variables:

```typescript
let received = 0;    // total messages in sync events
let matched = 0;     // messages in target date range
let processed = 0;   // processMessage returned !skipped
let skipped = 0;     // processMessage returned skipped
let errors = 0;      // processMessage returned error
```

Non-verbose output:
```
Fetch complete: 12 processed, 38 skipped, 0 errors for 29-07-2026
```
or:
```
No messages found for 29-07-2026
```

Verbose output per matching message:
```
[processed] WA123abc from 584129338026@s.whatsapp.net at 1722268800
[skipped] WA456def from ... at ...
```

### Section 6: Timeout (lines ~281–290)

```typescript
const TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "120000", 10);
const timeoutHandle = setTimeout(() => {
  sock?.close();
  console.warn("History fetch timed out after 120s");
  process.exit(2);
}, TIMEOUT_MS);
```

### Section 7: Signal Handling (lines ~291–305)

```typescript
process.on("SIGINT", () => { sock?.close(); process.exit(130); });
process.on("SIGTERM", () => { sock?.close(); process.exit(143); });
```

## Interfaces / Contracts

The script exports nothing — it's a CLI entry point only. Imports:

```typescript
import makeWASocket, { useMultiFileAuthState, DisconnectReason, type WAMessage } from "@whiskeysockets/baileys";
import { createDb, type Database } from "../db/index.js";
import { processMessage } from "../whatsapp/message-processor.js";
import { loadConfig } from "../config.js";
```

## Config Reuse

`loadConfig()` from `config.ts` returns `Config` with all needed fields:
- `config.chatJid` — `MONITOR_JID`
- `config.db` — DB connection params
- `config.dispatchEnabled` — `DISPATCH_ENABLED`
- `config.authDir` — **not used** (script hardcodes `./auth-fetch`)

The script ignores `config.authDir` by design — it uses a separate auth directory to avoid interfering with the main service's session.

## Exit Matrix

| Condition | Code | Stdout | Stderr |
|-----------|------|--------|--------|
| Sync complete, messages found | 0 | Summary line | — |
| Sync complete, no messages | 0 | `"No messages found for {date}"` | — |
| Invalid date arg | 1 | — | `"Invalid date format: {arg}"` |
| Connection error | 1 | — | Error description |
| Timeout | 2 | — | `"History fetch timed out after {ms}ms"` |
| SIGINT | 130 | — | — |
| SIGTERM | 143 | — | — |

## Testing Strategy

Per spec boundary (R9): no testing infrastructure in v1. The design prioritizes correctness through:
- Regex validation of date input
- Deterministic epoch arithmetic (no TZ library)
- Idempotency via `message_id` UNIQUE constraint (inherited from `processMessage`)
- Logging for manual verification

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The script is a direct CLI entry point with no command composition or delegated authority.

## Migration / Rollout

No migration required. The script lives alongside the main service — they share the MySQL database but use independent WhatsApp sessions (`./auth` vs `./auth-fetch`). First run automatically creates `./auth-fetch` via `useMultiFileAuthState`.
