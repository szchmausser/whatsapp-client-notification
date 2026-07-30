import { WASocket } from "@whiskeysockets/baileys";
import { eq } from "drizzle-orm";
import { chats, messages, syncState } from "../db/schema.js";
import type { Database } from "../db/index.js";
import type { CaptureDirection } from "../config.js";
import { processMessage } from "./message-processor.js";

export function setupMessageHandler(
  socket: WASocket,
  db: Database,
  chatJid: string,
  captureDirection: CaptureDirection = "both",
  dispatchEnabled: boolean = false
): void {
  console.log(`Message handler active for chat: ${chatJid} (direction: ${captureDirection})`);

  // Listen for incoming messages (notify = real-time, append = history sync)
  socket.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
    if (type !== "notify" && type !== "append") return; // Skip other types (replace, etc.)

    for (const msg of msgs) {
      const isFromMe = msg.key.fromMe ?? false;

      // Filter by capture direction
      if (captureDirection === "incoming" && isFromMe) {
        continue;
      }
      if (captureDirection === "outgoing" && !isFromMe) {
        continue;
      }

      // Filter: only process messages from the configured chat
      if (msg.key.remoteJid !== chatJid) {
        continue;
      }

      // Skip messages with no content
      if (!msg.message) continue;

      const messageId = msg.key.id;
      if (!messageId) continue;

      // Process message using shared logic (field extraction + insert + dispatch)
      const result = await processMessage({
        db,
        chatJid,
        msg,
        dispatchEnabled,
      });

      if (result.skipped) {
        console.log(`Message ${messageId} already exists, skipping`);
        continue;
      }

      // Update sync state
      const timestamp = msg.messageTimestamp
        ? typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp
          : Number(msg.messageTimestamp)
        : Math.floor(Date.now() / 1000);

      const currentSync = await db
        .select()
        .from(syncState)
        .where(eq(syncState.chatJid, chatJid))
        .limit(1);

      if (currentSync.length === 0) {
        await db.insert(syncState).values({
          chatJid,
          lastMessageId: messageId,
          lastTimestamp: timestamp,
          lastSyncAt: Math.floor(Date.now() / 1000),
        });
      } else if (!currentSync[0].lastTimestamp || timestamp > currentSync[0].lastTimestamp) {
        await db.update(syncState)
          .set({
            lastMessageId: messageId,
            lastTimestamp: timestamp,
            lastSyncAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(syncState.chatJid, chatJid));
      }

      console.log(`Message captured: ${messageId} from ${result.sender}`);
    }
  });

  console.log(`Message handler active for chat: ${chatJid}`);

  // Ensure chat exists in DB
  db.select()
    .from(chats)
    .where(eq(chats.jid, chatJid))
    .limit(1)
    .then((rows) => {
      if (rows.length === 0) {
        db.insert(chats).values({
          jid: chatJid,
          createdAt: new Date(),
        }).then(() => {
          console.log(`Chat ${chatJid} registered in database`);
        });
      }
    });
}
