import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";

const logger = pino({ level: "error" });

interface ClientResult {
  getSocket: () => WASocket | null;
  onReady: (callback: (socket: WASocket) => void) => void;
  restart: () => void;
}

export function createClient(authDir: string): ClientResult {
  let socket: WASocket | null = null;
  let restartCount = 0;
  let readyCallback: ((socket: WASocket) => void) | null = null;
  let handlerRegistered = false;
  const MAX_RESTART_DELAY = 60_000;

  async function connect(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    socket = makeWASocket({
      auth: state,
      logger,
      syncFullHistory: true,
      markOnlineOnConnect: false,
    });

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
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(
          `Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          reconnect();
        } else {
          console.log("Logged out. Please re-authenticate.");
          process.exit(1);
        }
      }

      if (connection === "open") {
        console.log("WhatsApp connection established");
        restartCount = 0;
        if (readyCallback && socket && !handlerRegistered) {
          handlerRegistered = true;
          readyCallback(socket);
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
    restart,
  };
}
