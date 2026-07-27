import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { loadConfig, Config } from "../config.js";

const logger = pino({ level: "info" });

interface ClientResult {
  socket: WASocket;
  restart: () => void;
}

export function createClient(config: Config): ClientResult {
  let socket: WASocket;
  let restartCount = 0;
  const MAX_RESTART_DELAY = 60_000; // 60 seconds cap

  async function connect(): Promise<WASocket> {
    const { state, saveCreds } = await useMultiFileAuthState("./auth");

    socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger,
      syncFullHistory: true,
      markOnlineOnConnect: false,
    });

    // Save credentials on update
    socket.ev.on("creds.update", saveCreds);

    // Handle connection updates
    socket.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("QR code received, scan with your phone");
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
        restartCount = 0; // Reset on successful connection
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

  // Initial connection
  connect().catch((err) => {
    console.error("Initial connection failed:", err);
    reconnect();
  });

  return { socket: undefined as unknown as WASocket, restart };
}
