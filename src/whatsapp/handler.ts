import { WASocket } from "@whiskeysockets/baileys";
import { eq } from "drizzle-orm";
import { syncState } from "../db/schema.js";
import type { Database } from "../db/index.js";
import type { CaptureDirection } from "../config.js";
import { processMessage } from "./message-processor.js";
import { ensureChat } from "../db/ensure-chat.js";

export async function setupMessageHandler(
  socket: WASocket,
  db: Database,
  chatJid: string,
  captureDirection: CaptureDirection = "both",
  dispatchEnabled: boolean = false
): Promise<void> {
  // Ensure chat row exists BEFORE registering listeners
  await ensureChat(db, chatJid);

  console.log(`Message handler active for chat: ${chatJid} (direction: ${captureDirection})`);

  // Listen for incoming messages (notify = real-time, append = history sync)
  socket.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
    if (type !== "notify" && type !== "append") return;

    let latestTimestamp = 0;
    let latestMessageId: string | null = null;

    for (const msg of msgs) {
      const isFromMe = msg.key.fromMe ?? false;

      // Filter by capture direction
      if (captureDirection === "incoming" && isFromMe) continue;
      if (captureDirection === "outgoing" && !isFromMe) continue;

      // Filter: only process messages from the configured chat
      if (msg.key.remoteJid !== chatJid) continue;

      // Skip messages with no content
      if (!msg.message) continue;

      const messageId = msg.key.id;
      if (!messageId) continue;

      // Process message using shared logic
      const result = await processMessage({ db, chatJid, msg, dispatchEnabled });

      if (result.error) {
        console.error(`Failed to process message ${messageId}:`, result.error);
        continue;
      }

      if (result.skipped) {
        console.log(`Message ${messageId} already exists, skipping`);
        continue;
      }

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

      console.log(`Message captured: ${messageId} from ${result.sender}`);
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
}
