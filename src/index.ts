import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { createClient } from "./whatsapp/client.js";
import { setupMessageHandler } from "./whatsapp/handler.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Starting client-notification (chat: ${config.chatJid})`);

  try {
    // 1. Initialize database
    const db = createDb(config.dbPath);
    console.log(`Database initialized: ${config.dbPath}`);

    // 2. Connect to WhatsApp
    const client = createClient(config.authDir);

    // 3. When connection is ready, setup handler
    client.onReady((socket) => {
      console.log("Setting up message handler...");
      setupMessageHandler(socket, db, config.chatJid);
    });

    // 4. Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      console.log(`Received ${signal}. Shutting down...`);
      const socket = client.getSocket();
      if (socket) {
        socket.end(undefined);
      }
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    console.log("Client notification service running. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("Failed to start:", error);
    process.exit(1);
  }
}

main();
