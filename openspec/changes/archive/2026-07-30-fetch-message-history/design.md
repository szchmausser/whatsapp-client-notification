# Design: fetch-message-history

## Technical Approach

Replace the current one-shot `messaging-history.set` listener in `fetch-day.ts` with an iterative `fetchMessageHistory` pagination loop. Keep `./auth-fetch` between runs — QR scan once, reuse forever. Bootstrap path for empty DB: full sync → capture one message → seed iterative fetch. Fix `sync.ts` timestamp bug (seconds → ms). All Baileys socket config upgraded per spec R8.

## Architecture Decisions

| Option | Tradeoffs | Decision |
|--------|-----------|----------|
| **Auth lifecycle** | Delete every run vs persist | Persist. Delete only when bootstrap needed (DB empty or logged out). Single auth dir `./auth-fetch` isolated from main service. |
| **Seed source** | DB oldest msg vs bootstrap sync always | Prefer DB. Query `WHERE chat_jid = ? ORDER BY timestamp ASC LIMIT 1`. Null → bootstrap. No additional queries per pagination cycle — seed is the oldest message of each received batch. |
| **Key construction** | `fromMe` omitted (current sync.ts) vs included | Include `fromMe` from `messages.is_from_me` column. Baileys v7 proto requires the full `WAMessageKey`. |
| **Retry strategy** | Socket reconnect vs wait-and-retry | Wait-and-retry. `fetchMessageHistory` creates a server-side session — reconnecting invalidates it. Timer-based: 30s window, 3 retries (5s, 15s, 45s), exit 3. |
| **Bootstrap sync** | `syncFullHistory: true` vs manual `fetchMessageHistory` empty | Full sync necessary — `fetchMessageHistory` needs a seed to paginate from. Accept the one-shot QR cost on bootstrap only. |
| **getMessage callback** | Omit vs implement | Implement via DB lookup. Baileys v7 uses it for protocol message retrieval; omitting may cause undefined behavior with `enableAutoSessionRecreation`. |

## Data Flow

```
parseArgs → computeEpochRange → createDb
    │
    ├─ queryDB(oldest) → has seed?
    │   ├─ YES: connect(AUTH_DIR) → connection.open → iterativeFetch(seed)
    │   └─ NO:  rm(AUTH_DIR) → connect(AUTH_DIR) → bootstrapSync → capture seed → iterativeFetch(seed)
    │
    └─ iterativeFetch(seed):
         └─ loop {
              fetchMessageHistory(50, key, ts * 1000)
              │
              wait 30s for messaging-history.set (syncType=ON_DEMAND)
              │   └─ timeout → retry (5→15→45s) → exit 3
              │
              filter batch by date range [startTs, endTs]
              processMessage(match) → db
              │
              batch < 50  → break  (last page)
              oldest < startTs → break  (past target)
              oldest = new seed → continue
         }
```

**Messages flow**: `fetchMessageHistory` → `messaging-history.set` event filter → `processMessage()` (identical to handler.ts) → MySQL insert (idempotent via UNIQUE `message_id`). Dispatch classification runs only if `DISPATCH_ENABLED=true`.

## Component Breakdown (all in `src/scripts/fetch-day.ts`)

| Function | Responsibility |
|----------|---------------|
| `parseArgs(argv)` | Validates `DD-MM-YYYY`, `--verbose`. Exits 1 on invalid. |
| `computeEpochRange(dateStr)` | UTC-4 day bounds in epoch seconds. |
| `getOldestSeed(db, chatJid)` | Returns `{ key, timestamp }` or null. |
| `bootstrapSync(sock)` | Listens on `messaging-history.set`, captures first valid msg, waits `messaging-history.status: complete`, returns seed. 240s timeout. |
| `iterativeFetch(sock, seed, range)` | Pagination loop with retry logic. `processMessage` per match. |
| `waitForOnDemand(sock, sessionId, signal)` | Promise wrapper — resolves on matching `messaging-history.set` with `peerDataRequestSessionId === sessionId`, rejects on 30s timeout. |
| `buildSocket(config)` | Creates `WASocket` with upgraded config: `Browsers.windows('Desktop')`, `makeCacheableSignalKeyStore`, `enableAutoSessionRecreation`, `enableRecentMessageCache`, `getMessage`, `syncFullHistory: true`. |
| `main()` | Orchestrator: parse → range → seed → connect → iterativeFetch or bootstrap → summary → exit. |

## Interfaces

```typescript
interface SeedInfo {
  key: { remoteJid: string; id: string; fromMe: boolean };
  timestamp: number; // epoch seconds
}

interface FetchResult {
  messages: WAMessage[];
  sessionId: string;
}

// Key additions to socket config
getMessage: async (key: WAMessageKey): Promise<WAMessage | undefined> => {
  const rows = await db.select()
    .from(messages)
    .where(eq(messages.messageId, key.id!))
    .limit(1);
  return rows.length > 0 ? (JSON.parse(rows[0].content || '{}') as WAMessage) : undefined;
}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/scripts/fetch-day.ts` | Rewrite | Replace full-sync listener with `fetchMessageHistory` loop + bootstrap path + retry |
| `src/whatsapp/sync.ts` | Modify | Line 91: `timestamp` → `timestamp * 1000` |
| `.env.example` | Maybe | Add `FETCH_TIMEOUT_MS` if not already (it exists — **no change needed**) |

## sync.ts Fix

**File**: `src/whatsapp/sync.ts`, line 91. **Change**: `const timestamp = oldestMsg.timestamp;` stays the same (epoch seconds in DB). **Line 88**: `timestamp` → `timestamp * 1000` as the third argument to `fetchMessageHistory`. The proto field `oldestMsgTimestampMs` expects milliseconds.

```typescript
const requestId = await socket.fetchMessageHistory(
  HISTORY_FETCH_COUNT,
  key,
  timestamp * 1000  // BUGFIX: seconds → milliseconds
);
```

## Error Handling

| Failure Mode | Detection | Response |
|-------------|-----------|----------|
| No auth (QR needed) | `DisconnectReason.loggedOut` or no creds | Print QR, wait. Bootstrap path = delete auth + fresh connect. |
| Logged out mid-run | `connection.update` with `loggedOut` | Exit 1. User re-scans manually. |
| `fetchMessageHistory` silent | `setTimeout` 30s after call | Retry 5s → 15s → 45s. Exhausted → exit 3. |
| On-demand response with wrong sessionId | `sessionId` mismatch | Ignore event. Timer continues. |
| DB connection error | `processMessage` throws | Log error, continue loop — idempotency prevents partial-state issues. |
| Bootstrap timeout (no history-set) | 240s timer | Exit 2. |
| Bootstrap empty (0 messages) | All history chunks processed, 0 captured | Exit 1, user needs to ensure group has messages. |
| SIGINT/SIGTERM | OS signal | `sock.end()`, exit 130/143. |

## CLI Interface

**Unchanged**: `npm run fetch:day -- DD-MM-YYYY [--verbose]`

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `parseArgs`, `computeEpochRange` | Pure functions — test valid/invalid/edge cases |
| Unit | `waitForOnDemand` timer/retry | Mock timers, verify retry escalation |
| Integration | `iterativeFetch` with mock socket | Inject fake `messaging-history.set` events, verify pagination stops correctly |
| Manual | Full end-to-end | `npm run fetch:day -- DD-MM-YYYY`, verify no QR on second run, verify no duplicates |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. The script is standalone — `client.ts`, `handler.ts`, and the main service lifecycle are untouched. `sync.ts` fix is a one-line change with no behavior difference unless `fetchOlderMessages` is called (only used by `client.ts` reconnection path).

## Open Questions

None — all decisions resolved by proposal + spec.
