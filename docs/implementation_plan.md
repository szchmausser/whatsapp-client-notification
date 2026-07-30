# Fix `fetch-day.ts` — Correctness & Robustness Improvements

Standalone script that connects to WhatsApp via Baileys (own session), paginates historical messages for a target date, and persists them to MySQL. The script works conceptually but has correctness bugs, missing safeguards, and a zombie promise leak that will cause silent data loss or failures in production.

> [!WARNING]
> **Fix #2 changes bootstrap behavior**: Currently `shouldSyncHistoryMessage: () => true` accepts ALL history chunks during bootstrap. The fix limits this to recent chunks only (like `client.ts` does). If you've been relying on the full dump for some reason, flag it.

## Proposed Changes

All changes target a single file: [fetch-day.ts](file:///c:/Desarrollo/client-notification/src/scripts/fetch-day.ts)

Fixes are ordered by priority (highest risk of real-world failure first).

---

### Fix 1 (P1 🔴) — Process ALL messages in bootstrap, not just the first

**Problem**: `setupBootstrapListener` (L178-209) resolves on the FIRST matching message and ignores the rest of the batch. Messages arriving in the same `messaging-history.set` event are silently dropped. This is **data loss**.

**Change**: Rewrite `setupBootstrapListener` to:

1. Process EVERY message in each batch that matches the target JID via `processMessage()` (idempotency protects against dupes).
2. Track the oldest message seen across ALL `messaging-history.set` events (Baileys fires several in sequence during bootstrap).
3. Use a debounce pattern: after receiving an event, reset a 5-second idle timer. Resolve with the oldest seed only after 5s of silence.
4. Keep the existing 240s hard timeout as a safety net.

```typescript
function setupBootstrapListener(
  sock: ReturnType<typeof makeWASocket>,
  db: Database,
  config: Config,
): Promise<SeedInfo> {
  return new Promise<SeedInfo>((resolve, reject) => {
    const BOOTSTRAP_TIMEOUT = 240_000;
    const DEBOUNCE_MS = 5_000;
    let oldestSeed: SeedInfo | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let processedCount = 0;

    const hardTimer = setTimeout(() => {
      cleanup();
      if (oldestSeed) {
        resolve(oldestSeed);
      } else {
        reject(new Error("Bootstrap timeout: no messages received within 240s"));
      }
    }, BOOTSTRAP_TIMEOUT);

    function cleanup() {
      clearTimeout(hardTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      sock.ev.off("messaging-history.set", bootstrapHandler);
    }

    function tryResolve() {
      cleanup();
      if (oldestSeed) {
        logger.info(
          { messageId: oldestSeed.key.id, totalProcessed: processedCount },
          "Bootstrap complete — captured seed message",
        );
        resolve(oldestSeed);
      }
    }

    const bootstrapHandler = async (data: {
      messages: WAMessage[];
      syncType?: proto.HistorySync.HistorySyncType | null;
    }) => {
      if (data.syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) return;

      for (const msg of data.messages) {
        if (!msg.key.remoteJid || msg.key.remoteJid !== config.chatJid) continue;
        if (!msg.message || !msg.key.id) continue;

        await processMessage({ db, chatJid: config.chatJid, msg, dispatchEnabled: config.dispatchEnabled });
        processedCount++;

        const ts =
          typeof msg.messageTimestamp === "number"
            ? msg.messageTimestamp
            : msg.messageTimestamp?.toNumber() ?? Math.floor(Date.now() / 1000);

        if (!oldestSeed || ts < oldestSeed.timestamp) {
          oldestSeed = {
            key: { remoteJid: config.chatJid, id: msg.key.id, fromMe: msg.key.fromMe ?? false },
            timestamp: ts,
          };
        }
      }

      // Reset debounce — wait for more events before resolving
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(tryResolve, DEBOUNCE_MS);
    };

    sock.ev.on("messaging-history.set", bootstrapHandler);
  });
}
```

---

### Fix 2 (P2 🔴) — Limit `shouldSyncHistoryMessage` to recent chunks only

**Problem**: `shouldSyncHistoryMessage: () => true` (L110) tells the phone to send ALL historical messages during bootstrap. This is wasteful and potentially dangerous — the script only needs one seed to start on-demand pagination. Align with [client.ts](file:///c:/Desarrollo/client-notification/src/whatsapp/client.ts#L43-L57).

**Change**:

```diff
-      syncFullHistory: true,
-      shouldSyncHistoryMessage: () => true,
+      syncFullHistory: true,
+      shouldSyncHistoryMessage: ({ syncType, oldestMsgInChunkTimestampSec }) => {
+        if (syncType === proto.HistorySync.HistorySyncType.FULL) return false;
+        if (oldestMsgInChunkTimestampSec) {
+          const MAX_AGE_SEC = 3 * 24 * 60 * 60;
+          const age = Math.floor(Date.now() / 1000) - Number(oldestMsgInChunkTimestampSec);
+          if (age > MAX_AGE_SEC) return false;
+        }
+        return true;
+      },
```

---

### Fix 3 (P3 🔴) — Set logger level to `info`

**Problem**: Logger is hardcoded to `warn` (L67). All `logger.info()` calls — summary, bootstrap seed capture, "no more history" — are invisible. The script runs completely blind.

**Change**:

```diff
-const logger = pino({ level: "warn" });
+const logger = pino({ level: process.env.LOG_LEVEL || "info" });
```

---

### Fix 4 (P4 🟡) — Raise default script timeout

**Problem**: Global timeout defaults to 120s (L467), but bootstrap listener alone allows 240s (L164). The global timer kills the process before bootstrap can complete.

**Change**:

```diff
-  const TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "120000", 10);
+  const TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "600000", 10);
```

---

### Fix 5 (P5 🟡) — Handle mid-fetch disconnection

**Problem**: If the WA connection drops during `iterativeFetch`, all retry attempts are pointless — the socket is dead. The script wastes 3 retries × 30s timeout each before exiting.

**Change**: Pass a `disconnected` flag (set by a `connection.update` listener in `main()`) into `iterativeFetch`. Check it before each fetch attempt.

```typescript
// In main(), after waitForOpen:
let disconnected = false;
sock.ev.on("connection.update", (update) => {
  if (update.connection === "close") {
    disconnected = true;
  }
});

// Pass to iterativeFetch, check before each fetch:
if (disconnected) {
  logger.error("Connection lost during fetch. Exiting.");
  return summary;
}
```

---

### Fix 6 (P6 🟡) — Add rate-limit delay between fetch pages

**Problem**: `iterativeFetch` fires the next `fetchMessageHistory` immediately after processing a batch. WhatsApp may rate-limit or ban the session.

**Change**: Add a 2-second delay between successful page fetches.

```diff
  // After processing batch, before updating seed for next iteration:
+ await sleep(2_000);
+
  currentSeed = { ... };
```

---

### Fix 7 (P7 🟢) — Use local timezone for day boundaries

**Problem**: `computeEpochRange` uses `Date.UTC()`. For a chat operating in Venezuela (UTC-4), `30-07-2026` captures UTC midnight-to-midnight, which is 20:00-to-20:00 local time. Misses the first/last 4 hours of the actual local day.

**Decision**: Use local timezone. The group operates on Venezuelan business hours.

**Change**:

```diff
  function computeEpochRange(dateStr: string): DateRange {
    const [day, month, year] = dateStr.split("-").map(Number);
-   const start = Date.UTC(year, month - 1, day) / 1000;
+   const start = new Date(year, month - 1, day).getTime() / 1000;
    const end = start + 86400;
    return { start, end };
  }
```

---

### Fix 8 (P8 🟢) — Move counters into function scope

**Problem**: Module-level mutable counters (`matched`, `processed`, `skipped`, `errors`) make the function impure.

**Change**: Define a `FetchSummary` interface. `iterativeFetch` creates and returns it. `logSummary` receives it as argument. Remove module-level counter variables.

```typescript
interface FetchSummary {
  matched: number;
  processed: number;
  skipped: number;
  errors: number;
}
```

---

### Fix 9 (P9 🟢) — Clean up zombie bootstrap promise on retry

**Problem**: ~~`seedPromise` is not recreated on retry~~ **Correction**: `seedPromise` IS already reassigned inside the retry loop (L427). The original diagnosis was wrong. However, when a retry creates a new promise, the OLD promise's 240s `setTimeout` continues running and eventually calls `reject()` with no handler → **unhandled promise rejection**. This is a memory/promise leak, not a hang.

**Change**: Make `setupBootstrapListener` return a cancel handle alongside the promise. Call cancel before creating a new listener on retry.

```typescript
interface BootstrapHandle {
  promise: Promise<SeedInfo>;
  cancel: () => void;
}

function setupBootstrapListener(...): BootstrapHandle {
  let hardTimer: ReturnType<typeof setTimeout>;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const promise = new Promise<SeedInfo>((resolve, reject) => {
    // ...existing logic using hardTimer, debounceTimer...
  });

  return {
    promise,
    cancel: () => {
      clearTimeout(hardTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      sock.ev.off("messaging-history.set", bootstrapHandler);
    },
  };
}

// In retry loop:
if (needBootstrap) {
  bootstrapHandle?.cancel(); // kill zombie timers from previous attempt
  bootstrapHandle = setupBootstrapListener(sock, db, config);
  seedPromise = bootstrapHandle.promise;
}
```

---

## Verification Plan

### Automated Tests

No E2E tests against real WhatsApp (out of scope per `AGENTS.md`). Verification is structural:

```bash
npm run build
```

Must compile without errors.

### Manual Verification

1. **Cold bootstrap**: Delete `./auth-fetch/`, run `npx tsx src/scripts/fetch-day.ts 30-07-2026`. Verify QR scan works, seed is captured, ALL bootstrap messages are processed (not just the first), and pagination works.
2. **Warm run (seed from DB)**: Run again with messages already in DB. Verify it skips bootstrap and goes straight to pagination.
3. **Logger output**: Verify summary line and progress messages are visible in terminal.
4. **Timeout**: Set `FETCH_TIMEOUT_MS=5000` and verify the script exits cleanly with the timeout error.

### Priority Summary

| Priority | Fix | Severity | Risk if skipped |
|----------|-----|----------|-----------------|
| P1 🔴 | Fix 1 — Process all bootstrap messages | Data loss | Silently drops messages from bootstrap batches |
| P2 🔴 | Fix 2 — Limit sync history | Performance/crash | Phone sends massive full history dump |
| P3 🔴 | Fix 3 — Logger level | Diagnostics | Script runs completely mute |
| P4 🟡 | Fix 4 — Timeout default | Reliability | Script killed before bootstrap completes |
| P5 🟡 | Fix 5 — Mid-fetch disconnect | Efficiency | 90s wasted on dead socket retries |
| P6 🟡 | Fix 6 — Rate limit | Session safety | WhatsApp may ban the session |
| P7 🟢 | Fix 7 — Timezone | Correctness | Wrong 4-hour window at day boundaries |
| P8 🟢 | Fix 8 — Counters scope | Code quality | Cosmetic, no runtime impact |
| P9 🟢 | Fix 9 — Zombie promise cleanup | Leak | Unhandled rejection on retry, not a crash |
