# Design: Gap-fill fetch-day

## Technical Approach

Replace `getOldestSeed()` with `getSeedAfterTimestamp()` that queries for the first message whose timestamp is at or after the target day's end. If no such message exists (or DB is empty), returns null → triggers the existing bootstrap path. The rest of the fetch pipeline (`setupBootstrapListener`, `fetchWithTimeout`, `iterativeFetch`) is untouched because the `SeedInfo` interface is preserved.

## Architecture Decisions

### Decision: Replace rather than parameterize `getOldestSeed`

**Choice**: New `getSeedAfterTimestamp()` function; remove `getOldestSeed()`.
**Alternatives considered**: Modify `getOldestSeed()` to accept an optional `minTimestamp` parameter.
**Rationale**: SRP — the function's semantics change from "oldest available" to "first message after a cutoff". A conditional parameter would make the API confusing since there's only one call site in `main()`.

### Decision: Bootstrap fallback for partial DB

**Choice**: When DB has messages but none >= rangeEnd, the bootstrap path runs and produces a recent seed.
**Alternatives considered**: Exit with "no seed found" message.
**Rationale**: Bootstrap is already built, tested, and returns `SeedInfo`. The fetched messages persist to DB anyway — no wasted work. The seed from bootstrap is recent (likely after target), so pagination works.

### Decision: Import `gte` and `and` from drizzle-orm

**Choice**: Add `gte` and `and` to the existing drizzle-orm import line. `desc` was initially added but removed in review since the "newest message" fallback was removed.
**Alternatives considered**: Import separately.
**Rationale**: Single import from `drizzle-orm` is the project convention.

## Data Flow

```
main()
  │
  ├─ getSeedAfterTimestamp(db, chatJid, range.end)
  │    ├─ SELECT ... WHERE chat_jid=? AND timestamp >= rangeEnd  ORDER BY timestamp ASC  LIMIT 1
  │    ├─ Row found → return SeedInfo
  │    └─ Not found → return null
  │
  ├─ null → needBootstrap=true → setupBootstrapListener → await bootstrap seed
  ├─ seed found → needBootstrap=false
  │
  └─ iterativeFetch(sock, seed, range, ...)  ← unchanged
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/scripts/fetch-day.ts` | Modify | Replace `getOldestSeed` → `getSeedAfterTimestamp`; add `gte`, `and` to imports |

## Interfaces / Contracts

```typescript
// New function — same interface shape as the replaced getOldestSeed
async function getSeedAfterTimestamp(
  db: Database,
  chatJid: string,
  rangeEnd: number,  // epoch seconds (range.end from computeEpochRange)
): Promise<SeedInfo | null>
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `getSeedAfterTimestamp` query branches | Mock DB, assert: (1) seed >= rangeEnd returned, (2) no seed → null (bootstrap), (3) empty DB → null |
| Manual | Full script run | `npx tsx src/scripts/fetch-day.ts DD-MM-YYYY` against a known date |

The new function is a pure data-access layer with clear branches — ideal for unit testing. Existing integration coverage (bootstrap, pagination) is unaffected.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The change is confined to a single TypeScript module with database queries.

## Migration / Rollout

No migration required. The change is a single script — deploy by updating the file. Rollback: `git revert` the commit.

## Open Questions

None.
