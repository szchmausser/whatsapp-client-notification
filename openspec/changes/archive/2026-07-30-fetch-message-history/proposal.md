# Proposal: fetch-message-history

## Intent

Replace the current `fetch-day.ts` approach (QR re-scan every run, one-shot `messaging-history.set` event) with iterative `fetchMessageHistory` calls. No more QR re-scans, efficient targeting of specific dates, and a fix for the sync.ts timestamp bug (seconds vs milliseconds).

## Scope

### In Scope
- Refactor `fetch-day.ts` to use `sock.fetchMessageHistory(count, key, timestampMs)` with iterative pagination (max 50/query)
- Fix `sync.ts` timestamp bug: `fetchOlderMessages` passes seconds, but proto field expects milliseconds
- Change browser config to `Browsers.windows('Desktop')` for better history coverage
- Add 3-retry exponential backoff when `fetchMessageHistory` returns silently
- Support full-sync bootstrap: delete auth, QR scan, get one message as key, then iterate `fetchMessageHistory`
- Keep existing CLI interface (`npm run fetch:day -- DD-MM-YYYY`)
- Keep `./auth-fetch` isolation from main service

### Out of Scope
- Date ranges (single day only as-is)
- Modifying `client.ts`, `handler.ts`, or main service lifecycle
- Testing infrastructure (manual verification only in this change)
- Real-time message capture during fetch window

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `history-fetch-day`: Changes from one-shot `messaging-history.set` to iterative `fetchMessageHistory`. Requires updated spec for connection flow, pagination, retry logic, and bootstrap path.

## Approach

`fetchMessageHistory(count, key, timestampMs)` requests older messages on demand. Query max 50 per call, paginate using the oldest received message as the next key. Timestamps converted to ms (`msgTimestamp * 1000`). Desktop browser identity triggers platform-level history optimization. If no messages arrive (silent server), retry 3x with exponential backoff. Bootstrap path: delete `./auth-fetch`, QR scan, wait for one real-time message via `messages.upsert`, then paginate backward from it.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/scripts/fetch-day.ts` | Modified | Replace history-set handler with iterative fetchMessageHistory loop |
| `src/whatsapp/sync.ts` | Modified | Fix `fetchOlderMessages` timestamp: `msgTimestamp * 1000` |
| `package.json` | Modified | (none expected — CLI name stays) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| fetchMessageHistory silent (server not responding) | Medium | 3 retries with exp backoff, then log failure and exit |
| Very old chats same limit as Web UI | Medium | Accept limitation — same ceiling as WhatsApp Web |
| Concurrent fetch + main service | Low | Separate auth dirs (`./auth-fetch` vs `./auth`) prevent session conflict |
| History sync timeout too short | Low | Increase default timeout from 20s to 240s per findings |

## Rollback Plan

1. `git revert` the commit (or `git checkout` the previous `fetch-day.ts` and `sync.ts`)
2. Verify `npm run dev` still works with original sync.ts
3. Single-commit revert

## Dependencies

- `@whiskeysockets/baileys` v7 (already installed) — `fetchMessageHistory` API
- `processMessage` from `message-processor.ts` (already shared)

## Success Criteria

- [ ] `npm run fetch:day -- DD-MM-YYYY` fetches messages for that date without QR re-scan (after first bootstrap)
- [ ] Running same date twice produces zero duplicate messages (idempotent)
- [ ] fetchMessageHistory paginates correctly across multiple 50-message pages
- [ ] `sync.ts` uses `timestamp * 1000` before passing to `fetchMessageHistory`
