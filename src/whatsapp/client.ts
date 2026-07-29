import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";

const logger = pino({ level: "error" });

// Only sync history from the last 7 days
const HISTORY_MAX_AGE_DAYS = 7;
const HISTORY_MAX_AGE_SEC = HISTORY_MAX_AGE_DAYS * 24 * 60 * 60;

interface ClientResult {
  getSocket: () => WASocket | null;
  onReady: (callback: (socket: WASocket) => void) => void;
  onReconnect: (callback: (socket: WASocket) => void) => void;
  restart: () => void;
}

export function createClient(
  authDir: string,
  onSocketCreated?: (socket: WASocket) => void
): ClientResult {
  let socket: WASocket | null = null;
  let restartCount = 0;
  let readyCallback: ((socket: WASocket) => void) | null = null;
  let reconnectCallback: ((socket: WASocket) => void) | null = null;
  const MAX_RESTART_DELAY = 60_000;

  async function connect(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    socket = makeWASocket({
      auth: state,
      logger,
      syncFullHistory: true,
      markOnlineOnConnect: false,
      browser: ["Client Notification", "Chrome", "4.0.0"],
      shouldSyncHistoryMessage: ({ syncType, oldestMsgInChunkTimestampSec }) => {
        // Reject FULL syncs (too large, takes forever)
        if (syncType === proto.HistorySync.HistorySyncType.FULL) {
          return false;
        }
        // Filter by date: only accept chunks from the last 7 days
        if (oldestMsgInChunkTimestampSec) {
          const chunkAge = Math.floor(Date.now() / 1000) - Number(oldestMsgInChunkTimestampSec);
          if (chunkAge > HISTORY_MAX_AGE_SEC) {
            console.log(`[Sync] Skipping chunk: oldest msg is ${Math.floor(chunkAge / 86400)} days old (max: ${HISTORY_MAX_AGE_DAYS})`);
            return false;
          }
        }
        return true;
      },
    });

    // Register early listeners BEFORE connection.update
    // messaging-history.set fires BEFORE connection.open — if we register after, we miss it
    if (onSocketCreated) {
      onSocketCreated(socket);
    }

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update: Partial<ConnectionState>) => {
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
        const isReplaced = statusCode === DisconnectReason.connectionReplaced;

        if (isLoggedOut) {
          console.log("Logged out. Please re-authenticate.");
          process.exit(1);
        }

        if (isReplaced) {
          console.log("");
          console.log("========================================");
          console.log("  SESSION REPLACED (status 440)");
          console.log("  Another WhatsApp session took over.");
          console.log("  Close all other WhatsApp Web tabs");
          console.log("  and other collector instances.");
          console.log("  Waiting 30s before retry...");
          console.log("========================================");
          console.log("");
          // Don't reconnect immediately — wait for user to close other session
          setTimeout(() => {
            console.log("Retrying connection...");
            connect().catch((err) => {
              console.error("Reconnection failed:", err);
              reconnect();
            });
          }, 30_000);
          return;
        }

        console.log(
          `Connection closed. Status: ${statusCode}. Reconnecting...`
        );
        reconnect();
      }

      if (connection === "open") {
        console.log("WhatsApp connection established");
        restartCount = 0;

        // SIEMPRE registrar el handler en cada socket nuevo
        if (readyCallback && socket) {
          readyCallback(socket);
        }

        // En reconexión, además pedir mensajes perdidos
        const isReconnect = (state.creds.accountSyncCounter || 0) > 0;
        if (isReconnect) {
          console.log("Reconnection detected, requesting recent messages...");
          if (reconnectCallback && socket) {
            reconnectCallback(socket);
          }
        }
      }
    });

    return socket;
  }

  function reconnect(): void {
    restartCount++;
    const delay = Math.min(1000 * Math.pow(2, restartCount - 1), MAX_RESTART_DELAY);
    console.log(`Reconnecting in ${delay}ms (attempt ${restartCount})...`);

    setTimeout(() => {
      connect().catch((err) => {
        console.error("Reconnection failed:", err);
        reconnect();
      });
    }, delay);
  }

  function restart(): void {
    restartCount = 0;
    connect().catch((err) => {
      console.error("Restart failed:", err);
      reconnect();
    });
  }

  connect().catch((err) => {
    console.error("Initial connection failed:", err);
    reconnect();
  });

  return {
    getSocket: () => socket,
    onReady: (callback) => { readyCallback = callback; },
    onReconnect: (callback) => { reconnectCallback = callback; },
    restart,
  };
}
