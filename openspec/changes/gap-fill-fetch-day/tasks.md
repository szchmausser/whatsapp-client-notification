# Tasks: Gap-fill fetch-day

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~25 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Foundation

- [ ] 1.1 Update drizzle-orm imports in `src/scripts/fetch-day.ts` — add `gte` and `desc` to existing import from `drizzle-orm`

## Phase 2: Core Implementation

- [ ] 2.1 Implement `getSeedAfterTimestamp(db, chatJid, rangeEnd)` — query `WHERE timestamp >= rangeEnd ORDER BY timestamp ASC LIMIT 1`; fallback to newest message overall `ORDER BY timestamp DESC LIMIT 1`; return null if DB empty
- [ ] 2.2 Replace `getOldestSeed(db, config.chatJid)` call in `main()` with `getSeedAfterTimestamp(db, config.chatJid, range.end)`
- [ ] 2.3 Remove unused `getOldestSeed()` function

## Phase 3: Verification

- [ ] 3.1 Run `npx tsc --noEmit` for compile check
- [ ] 3.2 Run `npx tsx src/scripts/fetch-day.ts DD-MM-YYYY` against a known date for manual verification
