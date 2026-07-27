import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { createClient } from "./whatsapp/client.js";
import { setupMessageHandler } from "./whatsapp/handler.js";
import { performCatchUpSync } from "./whatsapp/sync.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Starting client-notification (channel: ${config.channelJid})`);

  try {
    // 1. Initialize database
    const db = createDb(config.dbPath);
    console.log(`Database initialized: ${config.dbPath}`);

    // 2. Connect to WhatsApp (returns immediately, socket connects async)
    const client = createClient(config);

    // 3. Wait for socket to be ready via connection.update
    // The client handles reconnection internally
    console.log("Connecting to WhatsApp...");

    // We need to wait for the socket to be available
    // The client's internal connect() will set up the socket
    // Let's add a listener for connection updates
    const waitForSocket = (): Promise<void> => {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (client.socket) {
            clearInterval(checkInterval);

            // Setup connection listener on the actual socket
            client.socket.ev.on("connection.update", async (update) => {
              if (update.connection === "open") {
                console.log("Connected to WhatsApp");

                // Setup message handler for real-time capture
                setupMessageHandler(client.socket, db, config.channelJid);

                // Run catch-up sync for any missed messages
                await performCatchUpSync(client.socket, db, config.channelJid);
              }
            });

            resolve();
          }
        }, 100);
      });
    };

    await waitForSocket();

    // 4. Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      console.log(`Received ${signal}. Shutting down...`);
      client.socket.end(undefined);
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Keep process alive
    console.log("Client notification service running. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("Failed to start:", error);
    process.exit(1);
  }
}

main();
