#!/usr/bin/env tsx
import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type ConnectionState,
  type WAMessage,
  type WAMessageKey,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { eq, asc, desc, gte, and } from "drizzle-orm";
// no unused fs/promises imports needed (auth is preserved, not deleted)
import { createDb, type Database } from "../db/index.js";
import { loadConfig, type Config } from "../config.js";
import { processMessage } from "../whatsapp/message-processor.js";
import { messages } from "../db/schema.js";
import { shouldRetryDisconnect } from "../whatsapp/disconnect.js";

// ── Types ──────────────────────────────────────────────────────

interface DateRange {
  start: number; // epoch seconds
  end: number; // epoch seconds
}

interface ParseResult {
  dateStr: string;
  verbose: boolean;
  fillGaps: boolean;
}

interface SeedInfo {
  key: Pick<WAMessageKey, "remoteJid" | "id" | "fromMe">;
  timestamp: number; // epoch seconds
}

interface FetchResponse {
  messages: WAMessage[];
  peerDataRequestSessionId?: string | null;
}

interface BootstrapHandle {
  promise: Promise<SeedInfo>;
  cancel: () => void;
}

interface FetchSummary {
  matched: number;
  processed: number;
  skipped: number;
  errors: number;
}

// ── CLI argument parsing ───────────────────────────────────────

export function isValidCalendarDate(day: number, month: number, year: number): boolean {
  // new Date() "normalizes" overflow (e.g. 31-02 -> 03-03), so we roundtrip
  // and confirm the components survived unchanged.
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function parseArgs(argv: string[]): ParseResult {
  const dateStr = argv[2];
  const match = dateStr ? /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateStr) : null;
  if (!match) {
    console.error("Invalid date format: " + (dateStr || "(missing)") + ". Formato esperado: dd-mm-aaaa");
    process.exit(1);
  }

  const [, ddStr, mmStr, yyyyStr] = match;
  const day = Number(ddStr);
  const month = Number(mmStr);
  const year = Number(yyyyStr);

  if (!isValidCalendarDate(day, month, year)) {
    console.error(`Fecha inexistente en el calendario: ${dateStr}`);
    process.exit(1);
  }

  const flags = argv.slice(3);
  const verbose = flags.includes("--verbose");
  const fillGaps = flags.includes("--fill-gaps");
  return { dateStr, verbose, fillGaps };
}

// ── Date range computation — local timezone day boundaries ──────

export function computeEpochRange(dateStr: string): DateRange {
  const [day, month, year] = dateStr.split("-").map(Number);
  const start = new Date(year, month - 1, day).getTime() / 1000; // epoch seconds, local midnight
  // Compute the *next* local midnight directly instead of start + 86400.
  // In timezones with DST, the day of the transition has 23h or 25h, so a
  // fixed +86400s offset would land off the real midnight.
  const end = new Date(year, month - 1, day + 1).getTime() / 1000;
  return { start, end };
}

// ── Logger ─────────────────────────────────────────────────────

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const MAX_BOOT_RETRIES = 3;

// ── FetchSummary helpers ──────────────────────────────────────

function logSummary(
  summary: FetchSummary,
  dateStr: string,
  startTime: number,
  fillGaps = false,
): void {
  const duration = Math.round((Date.now() - startTime) / 1000);
  const modeStr = fillGaps ? " (fill-gaps mode)" : "";
  if (summary.matched === 0) {
    logger.info(`No se encontraron mensajes para la fecha ${dateStr}${modeStr}.`);
  } else {
    logger.info(
      `Fetch complete: ${summary.matched} matched, ${summary.processed} processed, ${summary.errors} errors in ${duration}s for ${dateStr}${modeStr}`,
    );
  }
}

// ── Sleep helper ───────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Phase 1: Build socket with upgraded config ─────────────────

function buildSocket(
  config: Config,
  db: Database,
  authDir: string,
): () => Promise<ReturnType<typeof makeWASocket>> {
  return async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      logger,
      syncFullHistory: true,
      shouldSyncHistoryMessage: ({ syncType, oldestMsgInChunkTimestampSec }) => {
        if (syncType === proto.HistorySync.HistorySyncType.FULL) return false;
        if (oldestMsgInChunkTimestampSec) {
          const MAX_AGE_SEC = 3 * 24 * 60 * 60;
          const age = Math.floor(Date.now() / 1000) - Number(oldestMsgInChunkTimestampSec);
          if (age > MAX_AGE_SEC) return false;
        }
        return true;
      },
      browser: ["Client Notification Fetch", "Chrome", "4.0.0"],
      getMessage: async (key: WAMessageKey): Promise<proto.IMessage | undefined> => {
        if (!key.id) return undefined;
        const rows = await db
          .select()
          .from(messages)
          .where(eq(messages.messageId, key.id))
          .limit(1);
        if (rows.length === 0) return undefined;
        return JSON.parse(rows[0].content || "{}") as proto.IMessage;
      },
    });

    sock.ev.on("creds.update", saveCreds);

    // Save offline/realtime messages received while socket connects
    sock.ev.on("messages.upsert", async (data) => {
      for (const msg of data.messages) {
        if (msg.key.remoteJid === config.chatJid && msg.message) {
          await processMessage({
            db,
            chatJid: config.chatJid,
            msg,
            dispatchEnabled: config.dispatchEnabled,
          });
        }
      }
    });

    return sock;
  };
}

// ── Phase 2: Seed detection — from DB ──────────────────────────

/**
 * Find a message in DB with timestamp >= rangeEnd to use as seed.
 * This ensures backward pagination from the seed lands in or after the target date.
 * Fallback: If no message >= rangeEnd exists (e.g., current day or gap without future messages),
 * find the latest message in DB for this chat whose timestamp >= rangeStart.
 * If no such message exists, returns null to trigger the bootstrap path.
 */
function rowToSeed(
  row: { messageId: string | null; isFromMe: boolean | null; timestamp: number },
  chatJid: string,
): SeedInfo | null {
  if (!row.messageId) return null;
  return {
    key: { remoteJid: chatJid, id: row.messageId, fromMe: row.isFromMe ?? false },
    timestamp: row.timestamp,
  };
}

export async function getSeedAfterTimestamp(
  db: Database,
  chatJid: string,
  rangeEnd: number,
  rangeStart?: number,
): Promise<SeedInfo | null> {
  // First: message with timestamp >= rangeEnd (closest after target date)
  const afterTarget = await db
    .select()
    .from(messages)
    .where(and(eq(messages.chatJid, chatJid), gte(messages.timestamp, rangeEnd)))
    .orderBy(asc(messages.timestamp))
    .limit(1);

  if (afterTarget.length > 0) {
    const seed = rowToSeed(afterTarget[0], chatJid);
    if (seed) return seed;
    logger.warn({ row: afterTarget[0] }, "Seed candidate (afterTarget) sin messageId, se descarta");
  }

  // Fallback: if rangeStart is provided, find latest message in DB >= rangeStart
  if (typeof rangeStart === "number") {
    const latestMsg = await db
      .select()
      .from(messages)
      .where(and(eq(messages.chatJid, chatJid), gte(messages.timestamp, rangeStart)))
      .orderBy(desc(messages.timestamp))
      .limit(1);

    if (latestMsg.length > 0) {
      const seed = rowToSeed(latestMsg[0], chatJid);
      if (seed) return seed;
      logger.warn({ row: latestMsg[0] }, "Seed candidate (fallback) sin messageId, se descarta");
    }
  }

  return null;
}

// ── Phase 2: Bootstrap listener — captures seed from sync ──────

function setupBootstrapListener(
  sock: ReturnType<typeof makeWASocket>,
  db: Database,
  config: Config,
  range: DateRange,
  fillGaps: boolean,
): BootstrapHandle {
  const BOOTSTRAP_TIMEOUT = 240_000;
  const DEBOUNCE_MS = 5_000;

  let hardTimer: ReturnType<typeof setTimeout>;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let oldestSeed: SeedInfo | null = null;
  let processedCount = 0;
  let settled = false;

  let resolvePromise!: (value: SeedInfo) => void;
  let rejectPromise!: (reason: Error) => void;
  const promise = new Promise<SeedInfo>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  // Declared before use so cleanup()/cancel() can always reach the exact
  // same function reference that was passed to sock.ev.on(...).
  function cleanup() {
    clearTimeout(hardTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
    sock.ev.off("messaging-history.set", bootstrapHandler);
  }

  function tryResolve() {
    if (settled) return;
    settled = true;
    cleanup();
    if (oldestSeed) {
      logger.info(
        { messageId: oldestSeed.key.id, totalProcessed: processedCount },
        "Bootstrap complete — captured seed message",
      );
      resolvePromise(oldestSeed);
    } else {
      rejectPromise(new Error("Bootstrap timeout: no messages received within 240s"));
    }
  }

  const bootstrapHandler = async (data: {
    messages: WAMessage[];
    syncType?: proto.HistorySync.HistorySyncType | null;
  }) => {
    if (settled) return; // defensive: ignore stray events after cancel()/resolve()
    if (data.syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) return;

    for (const msg of data.messages) {
      if (!msg.key.remoteJid || msg.key.remoteJid !== config.chatJid) continue;
      if (!msg.message || !msg.key.id) continue;

      const ts =
        typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp
          : msg.messageTimestamp?.toNumber() ?? Math.floor(Date.now() / 1000);

      // Persist only what belongs to the requested window (or, with
      // --fill-gaps, anything from range.start onward) — same rule
      // iterativeFetch uses, so bootstrap doesn't silently over-save.
      const inTargetRange = ts >= range.start && ts < range.end;
      const shouldProcess = fillGaps ? ts >= range.start : inTargetRange;

      if (shouldProcess) {
        await processMessage({ db, chatJid: config.chatJid, msg, dispatchEnabled: config.dispatchEnabled });
        processedCount++;
      }

      // Track the oldest message seen regardless of whether it was
      // persisted — this is what iterativeFetch will paginate backward
      // from next, so it must reflect the true oldest boundary of the
      // initial sync, not just the oldest *saved* message.
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

  hardTimer = setTimeout(tryResolve, BOOTSTRAP_TIMEOUT);

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

// ── Phase 3: fetchWithTimeout — one-shot ON_DEMAND waiter ──────

function fetchWithTimeout(
  sock: ReturnType<typeof makeWASocket>,
  seed: SeedInfo,
  timeoutMs: number,
): Promise<FetchResponse | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.ev.off("messaging-history.set", handler);
      resolve(null);
    }, timeoutMs);

    const handler = (data: {
      messages: WAMessage[];
      syncType?: proto.HistorySync.HistorySyncType | null;
      peerDataRequestSessionId?: string | null;
    }) => {
      if (data.syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
        clearTimeout(timer);
        sock.ev.off("messaging-history.set", handler);
        resolve({
          messages: data.messages,
          peerDataRequestSessionId: data.peerDataRequestSessionId,
        });
      }
    };

    sock.ev.on("messaging-history.set", handler);

    sock.fetchMessageHistory(50, seed.key, seed.timestamp * 1000).catch(() => {
      clearTimeout(timer);
      sock.ev.off("messaging-history.set", handler);
      resolve(null);
    });
  });
}

// ── Phase 3 & 4: Iterative fetch loop with retry ────────────────

async function iterativeFetch(
  sock: ReturnType<typeof makeWASocket>,
  seed: SeedInfo,
  range: DateRange,
  db: Database,
  config: Config,
  verbose: boolean,
  fillGaps: boolean,
  disconnected: () => boolean,
): Promise<FetchSummary> {
  const summary: FetchSummary = { matched: 0, processed: 0, skipped: 0, errors: 0 };
  let currentSeed = seed;
  let retries = 0;
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5_000, 15_000, 45_000];

  while (retries < MAX_RETRIES) {
    if (disconnected()) {
      logger.error("Connection lost during fetch. Exiting.");
      return summary;
    }

    const response = await fetchWithTimeout(sock, currentSeed, 30_000);

    if (response === null) {
      retries++;
      if (retries < MAX_RETRIES) {
        logger.warn(
          { retry: retries },
          `fetchMessageHistory timeout, retrying in ${RETRY_DELAYS[retries - 1] / 1000}s`,
        );
        await sleep(RETRY_DELAYS[retries - 1]);
      }
      continue;
    }

    retries = 0; // reset on success

    const { messages: msgs } = response;

    if (!msgs || msgs.length === 0) {
      logger.info("No hay más historial disponible.");
      return summary;
    }

    // Process batch (newest first — reverse chronological order)
    for (const msg of msgs) {
      const ts =
        typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp
          : msg.messageTimestamp?.toNumber() ?? 0;

      const inTargetRange = ts >= range.start && ts < range.end;
      const shouldProcess = fillGaps ? ts >= range.start : inTargetRange;

      if (shouldProcess) {
        summary.matched++;
        const result = await processMessage({
          db,
          chatJid: config.chatJid,
          msg,
          dispatchEnabled: config.dispatchEnabled,
        });
        if (result.skipped) summary.skipped++;
        else if (result.error) summary.errors++;
        else summary.processed++;

        if (verbose) {
          const status = result.error
            ? "error"
            : result.skipped
              ? "skipped"
              : "processed";
          logger.info(`[${status}] ${result.messageId} from ${result.sender} at ${ts}`);
        }
      }
    }

    // Get oldest message for next seed
    const oldest = msgs[msgs.length - 1];
    const oldestTs =
      typeof oldest.messageTimestamp === "number"
        ? oldest.messageTimestamp
        : oldest.messageTimestamp?.toNumber() ?? 0;

    // Stop if batch is a partial page (end of history) or predates target range
    if (msgs.length < 50 || oldestTs < range.start) {
      return summary;
    }

    if (!oldest.key.id) {
      logger.error("El mensaje más antiguo del batch no tiene id; no se puede continuar paginando.");
      return summary;
    }

    // Rate-limit delay between pages
    await sleep(2_000);

    // Use oldest message as next seed to paginate further back
    currentSeed = {
      key: {
        remoteJid: oldest.key.remoteJid || config.chatJid,
        id: oldest.key.id,
        fromMe: oldest.key.fromMe ?? false,
      },
      timestamp: oldestTs,
    };
  }

  logger.error(`fetchMessageHistory failed after ${MAX_RETRIES} retries`);
  return summary;
}

// ── Wait for connection.open ──────────────────────────────────

function waitForOpen(
  sock: ReturnType<typeof makeWASocket>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\n========================================");
        console.log("  QR CODE - Scan with your phone");
        console.log("========================================\n");
        qrcode.generate(qr, { small: true }, (code) => {
          console.log(code);
        });
        console.log("\n========================================\n");
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        if (isLoggedOut) {
          sock.ev.off("connection.update", handler);
          console.log(
            "Sesión expirada. Eliminá ./auth-fetch/ y ejecutá de nuevo para re-escanear QR.",
          );
          process.exit(1);
          return;
        }

        sock.ev.off("connection.update", handler);

        if (shouldRetryDisconnect(statusCode)) {
          reject(new Error(`Connection closed (status ${statusCode})`));
          return;
        }

        reject(new Error(`Fatal: connection closed (status ${statusCode})`));
      }

      if (connection === "open") {
        sock.ev.off("connection.update", handler);
        logger.info("WhatsApp connection established");
        resolve();
      }
    };

    sock.ev.on("connection.update", handler);
  });
}

// ── Main (with connection retry loop) ───────────────────────────

async function main() {
  const config = loadConfig();
  const { dateStr, verbose, fillGaps } = parseArgs(process.argv);
  const range = computeEpochRange(dateStr);
  const startTime = Date.now();

  const AUTH_DIR = "./auth-fetch";
  const db = await createDb(config.db);

  // ── Connection retry loop (like client.ts — exponential backoff) ─
  let sock: ReturnType<typeof makeWASocket> | undefined;
  let bootstrapHandle: BootstrapHandle | null = null;
  let retryDelay = 1_000;
  const MAX_RETRY_DELAY = 30_000;

  for (let attempt = 1; attempt <= MAX_BOOT_RETRIES; attempt++) {
    const connect = buildSocket(config, db, AUTH_DIR);
    sock = await connect();

    // Register bootstrap listener EARLY (before connection.open) to catch messaging-history.set on new QR sessions
    bootstrapHandle?.cancel();
    bootstrapHandle = setupBootstrapListener(sock, db, config, range, fillGaps);

    try {
      await waitForOpen(sock);
      break; // connected successfully
    } catch (err) {
      sock?.end(undefined);
      bootstrapHandle?.cancel();
      if (attempt < MAX_BOOT_RETRIES) {
        logger.warn(
          `Connection closed. Reconnecting in ${retryDelay}ms (attempt ${attempt}/${MAX_BOOT_RETRIES})...`,
        );
        await sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
      } else {
        console.log(
          `\nNo se pudo conectar después de ${MAX_BOOT_RETRIES} intentos.\n` +
            `Asegurate de escanear el QR code que aparece arriba con WhatsApp.\n` +
            `Si el QR no aparece, eliminá la carpeta ${AUTH_DIR}/ y ejecutá de nuevo.\n`,
        );
        process.exit(1);
      }
    }
  }

  if (!sock || !bootstrapHandle) {
    process.exit(1);
  }

  // ── Mid-fetch disconnect detection ──────────────────────────────
  let disconnected = false;
  sock.ev.on("connection.update", (update) => {
    if (update.connection === "close") {
      disconnected = true;
    }
  });

  // ── Signal handlers (once, after connection) ───────────────────
  process.on("SIGINT", () => {
    sock?.end(undefined);
    bootstrapHandle?.cancel();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    sock?.end(undefined);
    bootstrapHandle?.cancel();
    process.exit(143);
  });

  // ── Overall script timeout ─────────────────────────────────────
  const TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "600000", 10);
  const timeoutHandle = setTimeout(() => {
    sock?.end(undefined);
    bootstrapHandle?.cancel();
    logger.error(`Script timed out after ${TIMEOUT_MS}ms`);
    process.exit(2);
  }, TIMEOUT_MS);

  // ── Seed detection AFTER connection (allows offline messages to flush to DB)
  await sleep(3_000);

  let seed = await getSeedAfterTimestamp(db, config.chatJid, range.end, range.start);

  if (seed) {
    // Seed found in DB — cancel early bootstrap listener as it's not needed
    bootstrapHandle.cancel();
  } else {
    logger.info("No messages in DB — awaiting bootstrap sync from early listener");
    try {
      seed = await bootstrapHandle.promise;
    } catch (err) {
      clearTimeout(timeoutHandle);
      logger.error({ err }, "No se pudo obtener historial inicial. Probá de nuevo.");
      sock.end(undefined);
      process.exit(1);
    }
  }

  // ── Iterative fetch loop ──────────────────────────────────────
  let summary: FetchSummary;
  try {
    summary = await iterativeFetch(sock, seed!, range, db, config, verbose, fillGaps, () => disconnected);
  } finally {
    clearTimeout(timeoutHandle);
  }

  // ── Summary and exit ──────────────────────────────────────────
  logSummary(summary, dateStr, startTime, fillGaps);
  sock.end(undefined);
  process.exit(0);
}

// Only run main() when executed as a standalone script, not when imported as a module
if (!process.env.VITEST) {
  main().catch((err) => {
    logger.error({ err }, "Fatal error");
    process.exit(1);
  });
}