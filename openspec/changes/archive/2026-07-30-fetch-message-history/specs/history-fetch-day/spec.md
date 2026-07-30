# History Fetch Day — Specification

## Purpose

On-demand WhatsApp history fetch for a single date. Uses iterative `fetchMessageHistory` pagination with persistent session. Replaces v1 (QR re-scan + one-shot `messaging-history.set`).

## Requirements

### R1: CLI (unchanged)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Valid | `fetch-day.ts 29-07-2026` | Parsed | Epoch bounds computed |
| Invalid | `fetch-day.ts bad` | Validated | Exits 1 with error |
| Verbose | With `--verbose` | Per message | `"[status] {id}"` printed |

### R2: Persistent auth (modified)

Script MUST persist `./auth-fetch` across runs.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| First run | No auth dir | Socket starts | QR printed, wait |
| Repeat | Auth exists | Socket starts | No QR needed |
| Logged out | Session expired | loggedOut event | Exits 1, user re-scans |

### R3: Seed selection (new)

On `connection.open`, query DB for oldest message as seed. If empty → delete auth, QR, full-sync bootstrap, capture one message.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Has seed | DB has messages | Opens | Iterative fetch |
| Empty DB | No messages | Opens | Full-sync bootstrap |
| Bootstrap fails | Sync returns 0 | After event | Exits 1 "No seed" |

### R4: fetchMessageHistory loop (new)

Call `sock.fetchMessageHistory(50, key, timestamp * 1000)`. Response via `messaging-history.set` with `syncType: ON_DEMAND`. Filter batch by date, pass matches to `processMessage`. Oldest msg = next seed. Loop stops when: oldest predates target, batch empty, or `messaging-history.status: complete`. Timeout 30s per call, retry 3x (5s, 15s, 45s), exit 3 on exhaustion.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Paginate | 120 older msgs | Call returns 50 | Filter, process, oldest = new seed |
| Last page | Call returns 20 | < 50 received | Oldest < target → stop |
| Empty | 0 msgs | Handler fires | Exit cleanly |
| Retry | 30s no response | Timer | Retry 5s, then 15s, then 45s, or exit 3 |
| Recovery | Response before max retries | Batch arrives | Loop continues |

### R5: Date filtering (modified)

Only msgs within target date range SHALL reach `processMessage`. Dates in VET (UTC-4).

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| In range | Batch 50, 12 in range | Filter | 12 processed, chunk log shows 12 |
| Outside | Oldest predates target | Filter | Loop terminates |

### R6: Persistence (unchanged)

Reuse `processMessage`. UNIQUE(`message_id`) guarantees idempotency.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Idempotent | Run processes 12 | Second run | 0 processed, 12 skipped |
| Concurrent | Main service runs | Both write | No duplicates |

### R7: Exit codes (modified)

| Code | Condition |
|------|-----------|
| 0 | Success |
| 1 | Args/connection/logged-out |
| 2 | Timeout (FETCH_TIMEOUT_MS) |
| 3 | fetchMessageHistory exhausted |

### R8: Socket config (new)

Must use `Browsers.windows('Desktop')`, `enableAutoSessionRecreation`, `enableRecentMessageCache`, `getMessage` callback, `makeCacheableSignalKeyStore`. `syncFullHistory: true` for bootstrap.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Desktop | Desktop browser identity | Socket created | Desktop platform |
| Cache | Cacheable key store | Socket created | Performance improved |

### R9: sync.ts fix (new)

`fetchOlderMessages` MUST pass `timestamp * 1000` to `fetchMessageHistory`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Before fix | Timestamp=1728000 (seconds) | Passed | Server receives wrong ms |
| After fix | `timestamp * 1000` | Passed | Server receives correct ms |

## Data Contracts

**CLI**: `npx tsx src/scripts/fetch-day.ts <DD-MM-YYYY> [--verbose]`
**Auth**: `./auth-fetch` (persistent)
**Env**: `MONITOR_JID`, DB vars, `DISPATCH_ENABLED`, `FETCH_TIMEOUT_MS`

## Boundaries

- Single date. No changes to `client.ts` or `handler.ts`. `sync.ts` only: one-line timestamp fix.
