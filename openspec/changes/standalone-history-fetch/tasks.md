# Tasks: Standalone History Fetch

## Delivery Strategy

- **Type**: `single-pr`
- **Est. total lines**: ~190 (185 new + 5 modified across 2 files)
- **Review budget**: 800 lines (well under)

No chained PRs needed. Single PR with 5-6 work-unit commits.

## Risk Assessment

| Factor | Rating | Notes |
|--------|--------|-------|
| Changed lines | Low | ~190 total, well under 400 threshold |
| Existing code changes | None | Zero changes to service code (client.ts, handler.ts, sync.ts) |
| New dependencies | None | Reuses existing stack (Baileys, mysql2, pino, dotenv, qrcode-terminal) |
| Test infrastructure | None needed | Per spec boundary: manual verification only |
| WhatsApp session | Low | Independent auth directory (`./auth-fetch`), no interference with main service |

## Tasks

### T1: File skeleton + CLI parsing + date range computation

**Description**

Create `src/scripts/fetch-day.ts` with shebang, all imports, CLI argument validation, and the VET-anchored epoch range computation.

**Implementation details**

1. Create `src/scripts/` directory
2. Shebang line: `#!/usr/bin/env tsx`
3. Imports (all from existing deps):
   - `makeWASocket, useMultiFileAuthState, DisconnectReason, type WAMessage, type HistorySyncStatus` from `@whiskeysockets/baileys`
   - `pino` from `pino`
   - `createDb, type Database` from `../db/index.js`
   - `processMessage` from `../whatsapp/message-processor.js`
   - `loadConfig` from `../config.js`
   - `dotenv/config` (side-effect import)
4. Types:
   - `interface DateRange { start: number; end: number }` (epoch seconds)
   - `interface ParseResult { dateStr: string; verbose: boolean }`
5. `parseArgs(argv: string[]): ParseResult`:
   - `argv[2]` must match `/^(\d{2})-(\d{2})-(\d{4})$/`
   - On mismatch: `console.error("Invalid date format: " + argv[2])`, `process.exit(1)`
   - `argv[3] === "--verbose"` → verbose = true
   - Return `{ dateStr, verbose }`
6. `computeEpochRange(dateStr: string, tzOffset = -4): DateRange`:
   - Parse captured groups from regex: `dd, mm, yyyy`
   - `start = Math.floor(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0) / 1000) - tzOffset * 3600`
   - `end = Math.floor(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59) / 1000) - tzOffset * 3600`
   - Return `{ start, end }` (VET = UTC-4, offset is subtracted from UTC epoch)
7. Export nothing — this is a CLI entry point

**Files**

- Create: `src/scripts/fetch-day.ts`

**Dependencies**

None (first task)

**Acceptance criteria**

- `npx tsc --noEmit` compiles without errors
- `parseArgs(["node", "script", "29-07-2026"])` returns `{ dateStr: "29-07-2026", verbose: false }`
- `parseArgs(["node", "script", "29-07-2026", "--verbose"])` returns verbose: true
- `computeEpochRange("29-07-2026")` returns deterministic epoch values (e.g. `{ start: 1722211200, end: 1722297599 }`)
- Invalid formats trigger stderr message and exit code 1

---

### T2: Main function scaffold + WhatsApp connection

**Description**

Add the `main()` async function scaffold with database connection, WhatsApp session setup, handler registration, timeout, and signal handling — with event handler bodies as stubs.

**Implementation details**

1. Add logger instance: `const logger = pino({ level: "warn" });`
2. Declare module-level counters:
   ```typescript
   let received = 0;
   let matched = 0;
   let processed = 0;
   let skipped = 0;
   let errors = 0;
   ```
3. `async function main(config: Config, range: DateRange, verbose: boolean)`:
   a. `const db = await createDb(config.db);`
   b. `const { state, saveCreds } = await useMultiFileAuthState("./auth-fetch");`
   c. `const sock = makeWASocket({ auth: state, logger, syncFullHistory: true, shouldSyncHistoryMessage: () => true, browser: ["Client Notification Fetch", "Chrome", "4.0.0"], printQRInTerminal: true });`
   d. Register handlers immediately (synchronously after socket creation):
      - `sock.ev.on("creds.update", saveCreds);`
      - `sock.ev.on("connection.update", (update) => { ... })` — QR display via `qrcode-terminal.generate()`; close → log, exit 1
      - `sock.ev.on("messaging-history.set", (data) => { ... })` — placeholder calling `processMessage` with filtering
      - `sock.ev.on("messaging-history.status", (status) => { ... })` — placeholder for complete/drained
      - `sock.ev.on("messages.upsert", (data) => { ... })` — placeholder for real-time messages
4. Timeout setup (placeholder body, implemented in T4):
   ```typescript
   const TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "120000", 10);
   const timeoutHandle = setTimeout(() => { /* T4 fills this */ }, TIMEOUT_MS);
   ```
5. Signal handlers:
   ```typescript
   process.on("SIGINT", () => { sock?.close(); process.exit(130); });
   process.on("SIGTERM", () => { sock?.close(); process.exit(143); });
   ```
6. Note: timeout + counters + summary implemented in T4; handler bodies refined in T3.

**Files**

- Modify: `src/scripts/fetch-day.ts`

**Dependencies**

T1

**Acceptance criteria**

- `npx tsc --noEmit` compiles without errors
- File has `main()` function signature matching design
- All 5 event handlers are registered on the socket

---

### T3: Event handlers — sync, status, upsert, connection

**Description**

Implement the full event handler bodies. This is the core of the script: date-based filtering in `messaging-history.set`, clean exit on `messaging-history.status`, real-time message capture in `messages.upsert`, and connection lifecycle in `connection.update`.

**Implementation details**

1. **`connection.update` handler** (complete):
   ```typescript
   const { connection, lastDisconnect, qr } = update;
   if (qr) {
     qrcode.generate(qr, { small: true }, (code) => { console.log(code); });
   }
   if (connection === "open") {
     console.log("WhatsApp connection established for history fetch");
   }
   if (connection === "close") {
     const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
     console.error(`Connection closed. Status: ${statusCode}`);
     process.exit(1);
   }
   ```

2. **`messaging-history.set` handler**:
   ```typescript
   // data: { messages: WAMessage[], isLatest: boolean }
   let chunkMatch = 0;
   for (const msg of data.messages) {
     received++;
     const ts = Number(msg.messageTimestamp);
     if (ts >= range.start && ts <= range.end) {
       matched++;
       chunkMatch++;
       const result = await processMessage({
         db,
         chatJid: config.chatJid,
         msg,
         dispatchEnabled: config.dispatchEnabled,
       });
       if (result.skipped) skipped++;
       else if (result.error) errors++;
       else processed++;
       if (verbose) {
         const status = result.error ? "error" : result.skipped ? "skipped" : "processed";
         console.log(`[${status}] ${result.messageId} from ${result.sender} at ${ts}`);
       }
     }
   }
   console.log(`[Chunk] ${chunkMatch} messages matched in chunk (received: ${received})`);
   ```

3. **`messaging-history.status` handler**:
   ```typescript
   // status: "complete" | "drained" | etc.
   if (status === "complete") {
     clearTimeout(timeoutHandle);
     sock?.close();
     logSummary();  // defined in T4
     process.exit(0);
   }
   ```

4. **`messages.upsert` handler** (real-time messages during fetch):
   ```typescript
   // data: { messages: WAMessage[], type: "notify" | "append" | ... }
   for (const msg of data.messages) {
     const ts = Number(msg.messageTimestamp);
     if (ts >= range.start && ts <= range.end) {
       const result = await processMessage({
         db,
         chatJid: config.chatJid,
         msg,
         dispatchEnabled: config.dispatchEnabled,
       });
       // same counter + verbose logging pattern
     }
   }
   ```

**Files**

- Modify: `src/scripts/fetch-day.ts`

**Dependencies**

T2

**Acceptance criteria**

- `npx tsc --noEmit` compiles without errors
- Date filtering logic correctly compares `messageTimestamp` against `range.start`/`range.end`
- Counter variables increment correctly for each outcome path
- `messaging-history.status: "complete"` triggers clearTimeout + close + exit 0

---

### T4: Summary output + main function wiring + final assembly

**Description**

Implement the `logSummary()` function, fill in the timeout body, and wire everything together at module level so the script can run.

**Implementation details**

1. `function logSummary(dateStr: string, verbose: boolean)`:
   - If `processed === 0 && skipped === 0 && errors === 0`:
     ```typescript
     console.log(`No messages found for ${dateStr}`);
     ```
   - Else (default):
     ```typescript
     console.log(`Fetch complete: ${processed} processed, ${skipped} skipped, ${errors} errors for ${dateStr}`);
     ```

2. Timeout body:
   ```typescript
   const timeoutHandle = setTimeout(() => {
     sock?.close();
     console.warn(`History fetch timed out after ${TIMEOUT_MS}ms`);
     process.exit(2);
   }, TIMEOUT_MS);
   ```

3. Module-level execution:
   ```typescript
   const config = loadConfig();
   const { dateStr, verbose } = parseArgs(process.argv);
   const range = computeEpochRange(dateStr);
   
   main(config, range, verbose).catch((err) => {
     console.error(err);
     process.exit(1);
   });
   ```

4. Add `import { Boom } from "@hapi/boom";` for DisconnectReason status code extraction

5. Add `import qrcode from "qrcode-terminal";` (if not already imported)

**Files**

- Modify: `src/scripts/fetch-day.ts`

**Dependencies**

T3

**Acceptance criteria**

- `npx tsc --noEmit` compiles without errors
- Script can be invoked: `npx tsx src/scripts/fetch-day.ts 29-07-2026` (will attempt connection)
- Summary output matches spec format
- Exit codes: 0 on complete, 2 on timeout, 130/143 on signals

---

### T5: package.json script + .env.example update

**Description**

Add the `fetch:day` npm script for convenient invocation. Document `FETCH_TIMEOUT_MS` in `.env.example`.

**Implementation details**

1. In `package.json`, add to `"scripts"`:
   ```json
   "fetch:day": "tsx src/scripts/fetch-day.ts"
   ```

2. In `.env.example`, append before the App section or after existing DB vars:
   ```bash
   # Tiempo máximo de espera para fetch-day (ms, default: 120000)
   FETCH_TIMEOUT_MS=120000
   ```

**Files**

- Modify: `package.json`
- Modify: `.env.example`

**Dependencies**

T4

**Acceptance criteria**

- `npm run fetch:day -- 29-07-2026` runs the script (will attempt connection)
- `FETCH_TIMEOUT_MS` documented in `.env.example`
- `npx tsc --noEmit` still passes

---

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| New files | 1 (`src/scripts/fetch-day.ts`, ~185 lines) |
| Modified files | 2 (`package.json` +1 line, `.env.example` +2 lines) |
| Total changed lines | ~188 |
| Risk level | **Low** |
| PR recommendation | Single PR, single review pass |
| Chained PRs | Not needed |
| Service code changes | Zero — no changes to `client.ts`, `handler.ts`, `sync.ts` |

## Total Tasks

**5 tasks** (T1–T5), all ordered sequentially.

| Path | Task | Est. lines |
|------|------|------------|
| T1 → | CLI parsing + date computation | ~40 |
| T2 → | WhatsApp connection scaffold | ~50 |
| T3 → | Event handlers | ~55 |
| T4 → | Summary + wiring | ~40 |
| T5 → | package.json + .env.example | ~3 |

## Notes for Implementation

- The `messaging-history.set` event fires **BEFORE** `connection.open` — all handlers MUST be registered synchronously after `makeWASocket()` returns
- `printQRInTerminal: true` is a Baileys built-in option; no need to call `qrcode-terminal` manually for initial QR display, but `qrcode-terminal` is still used in the `connection.update` handler for explicit QR rendering
- Auth directory `./auth-fetch` is hardcoded — intentionally separate from the main service's `./auth`
- `shouldSyncHistoryMessage: () => true` accepts ALL chunks regardless of age (date filtering happens in the handler)
- The script intentionally does NOT filter by `captureDirection` — it processes all messages from history within the date range
