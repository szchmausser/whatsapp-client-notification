# Fix Main Collector — Correctness & Robustness Improvements

The WhatsApp collector daemon (`src/index.ts`) captures real-time messages and history syncs, persisting them to MySQL. The core pipeline has two FK race conditions that cause silent data loss, inefficient per-message DB operations, and a connection pool that will die on idle overnight.

## Proposed Changes

Changes target 4 files:

- [handler.ts](file:///c:/Desarrollo/client-notification/src/whatsapp/handler.ts)
- [sync.ts](file:///c:/Desarrollo/client-notification/src/whatsapp/sync.ts)
- [message-processor.ts](file:///c:/Desarrollo/client-notification/src/whatsapp/message-processor.ts)
- [db/index.ts](file:///c:/Desarrollo/client-notification/src/db/index.ts)

---

### Fix 1 (P1 🔴) — Ensure chat exists BEFORE processing messages in `handler.ts`

**Problem**: [handler.ts L93-106](file:///c:/Desarrollo/client-notification/src/whatsapp/handler.ts#L93-L106) registers the chat via a fire-and-forget `.then()` chain with no `await` and no `.catch()`. The `messages.upsert` listener (L18) can fire before the chat row exists → FK violation on `messages.chat_jid → chats.jid` → message silently lost (marked as `skipped` by processMessage).

**Change**:

1. Extract a shared `ensureChat()` helper that does an idempotent insert (try INSERT, catch duplicate).
2. Call `await ensureChat(db, chatJid)` at the TOP of `setupMessageHandler`, BEFORE registering the `messages.upsert` listener.
3. Remove the fire-and-forget `.then()` block at L93-106.
4. Remove the duplicate `console.log` at L90 (leftover from L15).

```typescript
// New helper — can live in handler.ts or a shared db utility
async function ensureChat(db: Database, chatJid: string): Promise<void> {
  try {
    await db.insert(chats).values({
      jid: chatJid,
      createdAt: new Date(),
    });
    console.log(`Chat ${chatJid} registered in database`);
  } catch (err: unknown) {
    // Duplicate key = chat already exists, safe to ignore
    const isDuplicate =
      err instanceof Error && "code" in err && (err as any).code === "ER_DUP_ENTRY";
    if (!isDuplicate) throw err;
  }
}
```

Updated `setupMessageHandler`:

```diff
  export async function setupMessageHandler(
    socket: WASocket,
    db: Database,
    chatJid: string,
    captureDirection: CaptureDirection = "both",
    dispatchEnabled: boolean = false
  ): Promise<void> {
+   // Ensure chat row exists BEFORE registering listeners
+   await ensureChat(db, chatJid);
+
    console.log(`Message handler active for chat: ${chatJid} (direction: ${captureDirection})`);

    socket.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
      // ...existing handler logic...
    });

-   console.log(`Message handler active for chat: ${chatJid}`);
-
-   // Ensure chat exists in DB
-   db.select()
-     .from(chats)
-     .where(eq(chats.jid, chatJid))
-     .limit(1)
-     .then((rows) => {
-       if (rows.length === 0) {
-         db.insert(chats).values({
-           jid: chatJid,
-           createdAt: new Date(),
-         }).then(() => {
-           console.log(`Chat ${chatJid} registered in database`);
-         });
-       }
-     });
  }
```

> [!IMPORTANT]
> Changing `setupMessageHandler` to `async` requires updating the caller in [index.ts L22-25](file:///c:/Desarrollo/client-notification/src/index.ts#L22-L25). The `onReady` callback must `await` or handle the promise. Simplest: make the callback async and let it bubble — `createClient.onReady` doesn't expect a return value, so an async callback is safe.

---

### Fix 2 (P1 🔴) — Ensure chat exists in `sync.ts` before processing history

**Problem**: [sync.ts L14-53](file:///c:/Desarrollo/client-notification/src/whatsapp/sync.ts#L14-L53) processes history sync messages with `processMessage()`, which inserts into `messages` with FK to `chats`. But `sync.ts` never verifies the chat exists. The `messaging-history.set` event fires BEFORE `connection.open` (and therefore before the handler's chat registration) → all synced messages fail on FK.

**Change**: Use the same `ensureChat()` helper. Call it for each unique JID found in the history batch before processing messages.

```typescript
export function setupHistorySyncListener(
  socket: WASocket,
  db: Database,
  chatJids: string[],
  dispatchEnabled: boolean = false
): void {
  socket.ev.on("messaging-history.set", async ({ messages: histMsgs, chats: syncChats, isLatest }) => {
    console.log(`[Sync] History received: ${histMsgs.length} messages, ${syncChats.length} chats (isLatest: ${isLatest})`);

+   // Ensure all monitored chats exist before inserting messages
+   const jidsInBatch = new Set(
+     histMsgs
+       .map((m) => m.key.remoteJid)
+       .filter((jid): jid is string => !!jid && chatJids.includes(jid))
+   );
+   for (const jid of jidsInBatch) {
+     await ensureChat(db, jid);
+   }

    let captured = 0;
    for (const msg of histMsgs) {
      // ...existing processing...
    }
  });
}
```

> [!NOTE]
> `ensureChat` should be extracted to a shared location importable by both `handler.ts` and `sync.ts`. Options: a new `src/db/ensure-chat.ts`, or inline in `src/db/index.ts`. I suggest a small standalone file to keep `db/index.ts` focused on connection.

---

### Fix 3 (P2 🟡) — Batch sync state update (once per batch, not per message)

**Problem**: [handler.ts L57-84](file:///c:/Desarrollo/client-notification/src/whatsapp/handler.ts#L57-L84) does 1 SELECT + 1 INSERT/UPDATE to `sync_state` for EVERY message. A batch of 20 messages = 40 extra DB queries.

**Change**: Track the highest timestamp across the batch, then update `sync_state` once after the loop.

```typescript
socket.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
  if (type !== "notify" && type !== "append") return;

  let latestTimestamp = 0;
  let latestMessageId: string | null = null;

  for (const msg of msgs) {
    // ...existing filtering and processMessage() logic...

    // Track highest timestamp for batch sync state update
    const timestamp = msg.messageTimestamp
      ? typeof msg.messageTimestamp === "number"
        ? msg.messageTimestamp
        : Number(msg.messageTimestamp)
      : Math.floor(Date.now() / 1000);

    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latestMessageId = msg.key.id ?? null;
    }
  }

  // Update sync state ONCE for the entire batch
  if (latestMessageId && latestTimestamp > 0) {
    const currentSync = await db
      .select()
      .from(syncState)
      .where(eq(syncState.chatJid, chatJid))
      .limit(1);

    if (currentSync.length === 0) {
      await db.insert(syncState).values({
        chatJid,
        lastMessageId: latestMessageId,
        lastTimestamp: latestTimestamp,
        lastSyncAt: Math.floor(Date.now() / 1000),
      });
    } else if (!currentSync[0].lastTimestamp || latestTimestamp > currentSync[0].lastTimestamp) {
      await db.update(syncState)
        .set({
          lastMessageId: latestMessageId,
          lastTimestamp: latestTimestamp,
          lastSyncAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(syncState.chatJid, chatJid));
    }
  }
});
```

---

### Fix 4 (P2 🟡) — Add keepAlive and explicit limits to MySQL pool

**Problem**: [db/index.ts L14-20](file:///c:/Desarrollo/client-notification/src/db/index.ts#L14-L20) creates a pool with zero configuration. For a 24/7 daemon, idle connections will be killed by MySQL's `wait_timeout` (default 8h) or network firewalls (often 1h). The pool won't recover them automatically without `enableKeepAlive`.

**Change**:

```diff
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
+   connectionLimit: 10,
+   enableKeepAlive: true,
+   keepAliveInitialDelay: 30_000,
+   waitForConnections: true,
  });
```

---

### Fix 5 (P2 🟡) — Fix `skipped` semantics in `processMessage`

**Problem**: [message-processor.ts L257-258](file:///c:/Desarrollo/client-notification/src/whatsapp/message-processor.ts#L257-L258) returns `{ skipped: true, error: err }` when the INSERT fails. The caller ([handler.ts L51](file:///c:/Desarrollo/client-notification/src/whatsapp/handler.ts#L51)) interprets `skipped` as "already exists" and logs `"already exists, skipping"`. A FK violation, timeout, or any real error gets misreported.

**Change**: Return `skipped: false` when there's an error. The `error` field already carries the information.

```diff
    } catch (err) {
-     return { skipped: true, messageId, sender, classified: false, dispatchInfo: null, error: err as Error };
+     return { skipped: false, messageId, sender, classified: false, dispatchInfo: null, error: err as Error };
    }
```

Update caller in `handler.ts` to check for errors explicitly:

```typescript
if (result.error) {
  console.error(`Failed to process message ${messageId}:`, result.error);
  continue;
}

if (result.skipped) {
  console.log(`Message ${messageId} already exists, skipping`);
  continue;
}
```

---

### Fix 6 (P3 🟢) — Remove duplicate "handler active" log

**Problem**: [handler.ts L15](file:///c:/Desarrollo/client-notification/src/whatsapp/handler.ts#L15) and [L90](file:///c:/Desarrollo/client-notification/src/whatsapp/handler.ts#L90) both print "Message handler active". L90 is a leftover that lacks the `(direction: ...)` detail.

**Change**: Delete L90.

```diff
-   console.log(`Message handler active for chat: ${chatJid}`);
```

> [!NOTE]
> This gets removed automatically as part of Fix 1 (the block from L90 onward is replaced).

---

### Fix 7 (P3 🟢) — SELECT-before-INSERT idempotency optimization

**Problem**: [message-processor.ts L84-92](file:///c:/Desarrollo/client-notification/src/whatsapp/message-processor.ts#L84-L92) does a SELECT to check if `messageId` exists before every INSERT. The UNIQUE constraint on `messageId` already prevents duplicates.

**Change (deferred)**: This is a valid optimization but not urgent. Drizzle's `onDuplicateKeyUpdate` with 50 columns is verbose, and the current volume doesn't justify the refactor. **No code change for now.** Document as a future optimization when message volume grows.

---

## Shared Helper Location

Create a new file for `ensureChat` (used by Fix 1 and Fix 2):

#### [NEW] `src/db/ensure-chat.ts`

```typescript
import { chats } from "./schema.js";
import type { Database } from "./index.js";

/**
 * Idempotent chat registration. Inserts the chat row if it doesn't exist.
 * Safe to call multiple times — duplicate key errors are silently ignored.
 */
export async function ensureChat(db: Database, chatJid: string): Promise<void> {
  try {
    await db.insert(chats).values({
      jid: chatJid,
      createdAt: new Date(),
    });
    console.log(`Chat ${chatJid} registered in database`);
  } catch (err: unknown) {
    const isDuplicate =
      err instanceof Error && "code" in err && (err as any).code === "ER_DUP_ENTRY";
    if (!isDuplicate) throw err;
  }
}
```

---

## Verification Plan

### Automated

```bash
npm run build
```

Must compile without errors.

### Manual Verification

1. **Fresh DB**: Drop and recreate tables. Start collector. Verify chat is registered BEFORE first message is processed (check logs order).
2. **History sync**: Delete `./auth/` to force full bootstrap. Verify sync messages are captured — no FK errors in logs.
3. **Overnight stability**: Let the collector run idle for >1h, verify pool stays alive (send a message after the idle period, check it's captured).
4. **Error vs skip**: Temporarily break the FK (e.g. wrong chatJid) and verify the log says "Failed to process" not "already exists, skipping".

### Priority Summary

| Priority | Fix | File(s) | Risk if skipped |
|----------|-----|---------|-----------------|
| P1 🔴 | Fix 1 — ensureChat in handler | handler.ts, index.ts | FK violation → silent data loss |
| P1 🔴 | Fix 2 — ensureChat in sync | sync.ts | All history sync messages lost on fresh connect |
| P2 🟡 | Fix 3 — Batch sync state | handler.ts | 2N unnecessary DB queries per batch |
| P2 🟡 | Fix 4 — Pool keepAlive | db/index.ts | Collector dies overnight on idle timeout |
| P2 🟡 | Fix 5 — skipped semantics | message-processor.ts, handler.ts | Errors misreported as duplicates |
| P3 🟢 | Fix 6 — Duplicate log | handler.ts | Cosmetic (removed by Fix 1) |
| P3 🟢 | Fix 7 — SELECT optimization | — | Deferred, not urgent at current volume |
