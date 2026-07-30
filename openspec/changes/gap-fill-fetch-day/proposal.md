# Proposal: Gap-fill fetch-day

## Intent

`fetch-day.ts` currently seeds from the oldest DB message, so it can only find messages older than what's already stored. This makes it impossible to fill gaps for dates in the middle or recent past. This change makes any target date reachable by smart seed selection.

## Scope

### In Scope
- Seed selection rewrite in `fetch-day.ts`: query for a message after target date, paginate backward
- Bootstrap fallback when no post-target-date seed exists
- R3 spec update (seed selection semantics)

### Out of Scope
- Forward pagination (blocked by Baileys — API is backward-only)
- E2E tests
- Main service changes (client.ts, handler.ts, sync.ts)
- CLI interface, env vars, auth (unchanged)

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `history-fetch-day`: R3 seed selection — from always oldest to message after `range.end`. If none exists, bootstrap for a recent seed via WhatsApp sync.

## Approach

1. Replace `getOldestSeed()` with `getSeedAfterTimestamp()` — queries the first message where `timestamp >= range.end`, ordered ASC, LIMIT 1.
2. If seed found → paginate backward into target range (existing loop works as-is).
3. If no seed → reuse bootstrap path to get a recent message from WhatsApp sync.
4. Bootstrap already persists messages and returns `SeedInfo` — compatible with the fetch loop.
5. `getOldestSeed()` is replaced, not modified — cleaner diff.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/scripts/fetch-day.ts` | Modified | Replace `getOldestSeed` with `getSeedAfterTimestamp`; `needBootstrap` adapts |
| `openspec/specs/history-fetch-day/spec.md` | Modified | R3 scenarios updated |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bootstrap fails for recent seed | Low | Existing retry (3 attempts, exponential backoff) |
| DB has messages but none after target | Low-Medium | Bootstrap fallback covers this |
| Boundary miss at seed timestamp | Low | Seed >= range.end, range filter uses [start, end) |

## Rollback Plan

1. `git revert` the commit modifying `fetch-day.ts`
2. No config or data migration needed

## Dependencies

- Existing bootstrap infrastructure (`setupBootstrapListener`, `fetchWithTimeout`, `iterativeFetch`) — unchanged
- `fetchMessageHistory` backward-only constraint — hard, unchanged

## Success Criteria

- [ ] `npx tsx src/scripts/fetch-day.ts DD-MM-YYYY` retrieves messages for that date even when DB has newer messages
- [ ] When DB has messages after the target date, no bootstrap is triggered
- [ ] When DB is empty or has no messages after target date, bootstrap provides a valid seed
- [ ] Existing pagination, retry, and timeout behavior preserved
