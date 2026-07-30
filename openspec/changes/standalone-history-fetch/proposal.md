# Proposal: standalone-history-fetch

## Intent

Fill historical WhatsApp message gaps on demand — for example, after a service outage or when joining an existing group — without interfering with the main service's connection lifecycle or reconnection logic.

## Scope

### In Scope
- Standalone CLI script `src/scripts/fetch-day.ts` using direct `makeWASocket`
- Independent auth directory `./auth-fetch` (separate from main service's `./auth`)
- Reuse `processMessage` and `createDb` as-is (no modification needed)
- Date filtering in `messaging-history.set` event handler (accept-all in `shouldSyncHistoryMessage`)
- Auto-exit on `messaging-history.status: complete` + 120s timeout fallback
- `fetch:day` npm script entry in `package.json`
- Idempotency via existing `message_id` UNIQUE constraint

### Out of Scope
- Modifying `createClient`, `handler.ts`, or `sync.ts`
- Date ranges (single day only, DD-MM-YYYY)
- Testing infrastructure (no tests for this script yet)
- Concurrent-run support (document single-instance requirement)

## Capabilities

### New Capabilities
- `history-fetch-day`: On-demand WhatsApp history fetch for a specific date. CLI-based, independent auth, reuses shared `processMessage` for extraction and persistence with no new insert logic.

### Modified Capabilities
- None

## Approach

Direct `makeWASocket` (exploration approach 1 — recommended). The script has a fundamentally different lifecycle (connect → sync → exit) than the main service (connect → stay alive → reconnect). Trying to share connection logic would require refactoring `createClient` with options the main service doesn't need. Instead, the script calls `makeWASocket` directly with `syncFullHistory: true`, accepts all chunks, filters messages by target date in the handler, and exits on sync completion.

## User Interface

```
npx tsx src/scripts/fetch-day.ts DD-MM-YYYY [--verbose]
```

| Aspect | Value |
|--------|-------|
| Format | `DD-MM-YYYY` (e.g., `29-07-2026`) |
| Verbose | `--verbose` for per-message logging |
| Default | Summary: total processed, skipped, errors |
| Exit 0 | Success (or "no messages found" for that date) |
| Exit 1 | Error (connection failed, timeout) |
| Exit 2 | Auth needed (QR scan required) |

## Flow

1. Parse CLI args (date, verbose flag)
2. Load/create auth state from `./auth-fetch` (`useMultiFileAuthState`)
3. Connect via `makeWASocket` (show QR on first run, wait for scan)
4. Register `messaging-history.set` and `messaging-history.status` listeners
5. On each `messaging-history.set` chunk: filter messages within [startOfDay, endOfDay] timestamp range, call `processMessage` for each match
6. On `status: complete`: log summary, `process.exit(0)`
7. On timeout (120s): log warning, `process.exit(1)`

## Components

| Component | Detail |
|-----------|--------|
| **Auth** | `./auth-fetch` dir, `useMultiFileAuthState`, QR code via `qrcode-terminal` |
| **Socket** | `makeWASocket({ syncFullHistory: true, shouldSyncHistoryMessage: () => true })` |
| **Date filter** | In handler: `msg.messageTimestamp` within [startTs, endTs] of target date |
| **Processing** | `processMessage({ db, chatJid, msg, dispatchEnabled })` — idempotent via UNIQUE |
| **Exit** | `messaging-history.status` event → `status === 'complete'` |
| **Timeout** | `setTimeout(120000)` fallback if sync never completes |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/scripts/fetch-day.ts` | New | Main script (~120-150 lines) |
| `package.json` | Modified | Add `"fetch:day": "tsx src/scripts/fetch-day.ts"` |
| `.env.example` | Modified | Document `FETCH_TIMEOUT` env var |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| QR scan needed on first (headless) run | Medium | Document clearly; session persists after first scan |
| Large sync for old dates may be slow | Low | Log per-chunk message counts for progress visibility |
| Concurrent script instances conflict | Low | Document single-instance; separate auth dir prevents main-service conflict |
| Sync never completes (Baileys quirk) | Low | Timeout fallback at 120s (configurable via env) |

## Rollback Plan

1. `git rm src/scripts/fetch-day.ts`
2. Revert `package.json` (remove `fetch:day` entry)
3. Revert `.env.example` changes
4. Single-commit revert

## Dependencies

- `@whiskeysockets/baileys` (already installed)
- `qrcode-terminal` (already installed)
- `processMessage` from `src/whatsapp/message-processor.ts`
- `createDb` from `src/db/index.ts`

## Success Criteria

- [ ] `npx tsx src/scripts/fetch-day.ts DD-MM-YYYY` processes all messages for that date and exits 0
- [ ] Running same date twice produces zero duplicate messages (idempotency)
- [ ] First run shows QR code and waits for scan before proceeding
- [ ] Script exits 1 on connection failure, 2 when auth directory is empty/first time
