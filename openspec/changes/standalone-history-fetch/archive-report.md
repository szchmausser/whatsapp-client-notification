# Archive Report: standalone-history-fetch

## Change Summary

Added a standalone CLI script `src/scripts/fetch-day.ts` that fills historical WhatsApp message gaps on demand. The script connects an independent session, requests full history sync, filters messages to a target date, persists via `processMessage`, and exits cleanly. Zero changes to the main service's connection lifecycle.

## Implementation Status

| Task | Status | Notes |
|------|--------|-------|
| T1: CLI parsing + date range | Complete | Regex validation, VET epoch computation |
| T2: Connection scaffold | Complete | `makeWASocket` direct, `useMultiFileAuthState` |
| T3: Event handlers | Complete | history.set, history.status, upsert, connection |
| T4: Summary + wiring | Complete | `logSummary` with duration, timeout, signals |
| T5: package.json + .env | Complete | `fetch:day` script, `FETCH_TIMEOUT_MS` documented |

**All 5 tasks completed.** TypeScript compiles clean (`npx tsc --noEmit` passes).

## Files Created / Modified

| File | Action | Lines |
|------|--------|-------|
| `src/scripts/fetch-day.ts` | Created | 247 |
| `package.json` | Modified | +1 line (`fetch:day` script) |
| ` `.env.example` | Modified | +2 lines (`FETCH_TIMEOUT_MS` + section header) |

## Spec Deviations

All deviations are proper Baileys v7 API usage, not implementation errors.

| Spec Requirement | Implementation | Verdict |
|------------------|----------------|---------|
| R3: `sock.close()` on connection failure | `sock.end(undefined)` | Baileys v7 preferred API |
| R7: `sock.close()` on sync complete | `sock.end(undefined)` | Baileys v7 preferred API |
| R8: Exit 2 on timeout | Exit 2 on timeout | Correct |
| R7: `status === 'complete'` check | `({ status }) => { if (status === 'complete') }` | Baileys v7 destructures event data, not a plain string |
| Summary format: processed/skipped/errors | Includes `matched` count + duration | Enhancement beyond spec |

The `messaging-history.status` handler destructuring `{ status }` instead of receiving a string is the correct Baileys v7 pattern — the event emits an object, not a bare string.

## Verification

- **TypeScript**: `npx tsc --noEmit` passes with zero errors
- **Idempotency**: Guaranteed by existing `message_id` UNIQUE constraint in `processMessage`
- **Auth isolation**: Independent `./auth-fetch` directory — no interference with main service
- **Exit codes**: 0 (success), 1 (error/connection/args), 2 (timeout), 130 (SIGINT), 143 (SIGTERM)

## Known Limitations

| Limitation | Mitigation |
|------------|------------|
| Single date only (no ranges) | Per spec boundary — v1 scope |
| No test infrastructure | Per spec boundary — manual verification only |
| Single-instance requirement | Separate auth dir prevents main-service conflict |
| QR scan needed on first (headless) run | Session persists after first scan |

## Capability Added

**`history-fetch-day`**: On-demand WhatsApp history fetch for a specific date. CLI-based, independent auth, reuses shared `processMessage` for extraction and persistence with no new insert logic.

## Project Context Update

The project now has two operational modes:
1. **Continuous collector** (`npm run dev`) — main service with reconnection logic
2. **On-demand fetch** (`npm run fetch:day`) — standalone script for historical gap fill

Both share the MySQL database but operate with independent WhatsApp sessions (`./auth` vs `./auth-fetch`).
