# Tasks: fetch-message-history

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 400-500 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full fetch-message-history implementation | PR 1 | `npx vitest run` | `npm run fetch:day -- DD-MM-YYYY` | `git revert <commit>` |

## Phase 1: Socket Config + sync.ts Fix

- [ ] 1.1 Update socket config in `src/scripts/fetch-day.ts`: `Browsers.windows('Desktop')`, `enableAutoSessionRecreation`, `enableRecentMessageCache`, `getMessage` callback querying DB by `key.id`, `makeCacheableSignalKeyStore`
- [ ] 1.2 Fix `src/whatsapp/sync.ts` line 91: change `timestamp` to `timestamp * 1000` in `fetchMessageHistory` call

## Phase 2: Seed Detection + Bootstrap Path

- [ ] 2.1 Add `getOldestSeed(db, chatJid)` — query oldest message by `timestamp ASC LIMIT 1`, return `SeedInfo { key, timestamp }` or null
- [ ] 2.2 Add `bootstrapSync(sock, range, db)` — delete `./auth-fetch`, reconnect with `syncFullHistory: true`, capture first valid message from `messaging-history.set`, save via `processMessage`, return seed
- [ ] 2.3 Wire seed decision in `main()`: seed exists → `iterativeFetch`; null → `bootstrapSync` → `iterativeFetch`

## Phase 3: Iterative fetchMessageHistory Loop

- [ ] 3.1 Implement `waitForOnDemand(sock, sessionId, signal)` — `Promise.race` resolving on matching `messaging-history.set` with `peerDataRequestSessionId === sessionId`, rejecting on 30s timeout
- [ ] 3.2 Implement `iterativeFetch(sock, seed, range, db, config)` — pagination loop: `fetchMessageHistory(50, key, ts*1000)`, oldest msg → next seed, stop when batch < 50 or oldest < target
- [ ] 3.3 Add 3-retry exponential backoff (5s → 15s → 45s) when timeout fires; exit 3 on exhaustion

## Phase 4: Date Filtering + Persistence

- [ ] 4.1 Filter each ON_DEMAND batch by UTC-4 day boundary (`range.start`/`range.end` epoch seconds)
- [ ] 4.2 Call `processMessage()` per match, log `[status] {messageId}` in verbose mode, update counters
- [ ] 4.3 Handle stop conditions: oldest message `timestamp < range.start`, batch completely processed, or `messaging-history.status: complete`

## Phase 5: Edge Cases + Error Messages

- [ ] 5.1 Handle `DisconnectReason.loggedOut` → exit 1 with "Session expired, re-run to re-scan QR"
- [ ] 5.2 Handle bootstrap failure (0 messages after 240s) → exit 1 "No seed available"
- [ ] 5.3 Handle no matching messages → exit 0 "No messages found for DD-MM-YYYY"
- [ ] 5.4 Add SIGINT (exit 130) and SIGTERM (exit 143) handlers with `sock.end()`
