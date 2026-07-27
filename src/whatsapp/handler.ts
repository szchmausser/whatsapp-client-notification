import { WASocket } from "@whiskeysockets/baileys";
import { eq } from "drizzle-orm";
import { chats, messages, syncState } from "../db/schema.js";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

type Database = BetterSQLite3Database<typeof import("../db/schema.js")>;

export function setupMessageHandler(
  socket: WASocket,
  db: Database,
  chatJid: string
): void {
  // Listen for incoming messages
  socket.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
    console.log(`[DEBUG] messages.upsert received: type=${type}, count=${msgs.length}`);

    if (type !== "notify") return; // Only process new messages, not history sync

    for (const msg of msgs) {
      console.log(`[DEBUG] Message from: remoteJid=${msg.key.remoteJid}, participant=${msg.key.participant}`);

      // Filter: only process messages from the configured chat
      if (msg.key.remoteJid !== chatJid) {
        console.log(`[DEBUG] Skipping: remoteJid doesn't match chatJid`);
        continue;
      }

      // Skip messages with no content
      if (!msg.message) continue;

      const messageId = msg.key.id;
      if (!messageId) continue;

      // Idempotency check: skip if already exists
      const existing = db
        .select()
        .from(messages)
        .where(eq(messages.messageId, messageId))
        .get();

      if (existing) {
        console.log(`Message ${messageId} already exists, skipping`);
        continue;
      }

      // Extract sender
      const sender = msg.key.participant || msg.key.remoteJid || undefined;

      // Extract message type
      const messageType = Object.keys(msg.message)[0] || "unknown";

      // Store raw JSON payload
      const content = JSON.stringify(msg.message);

      // Insert message
      db.insert(messages)
        .values({
          chatJid,
          messageId,
          sender: sender || null,
          content,
          messageType,
          timestamp: msg.messageTimestamp
            ? typeof msg.messageTimestamp === "number"
              ? msg.messageTimestamp
              : Number(msg.messageTimestamp)
            : Math.floor(Date.now() / 1000),
          createdAt: new Date(),
        })
        .run();

      // Update sync state
      const timestamp = msg.messageTimestamp
        ? typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp
          : Number(msg.messageTimestamp)
        : Math.floor(Date.now() / 1000);

      const currentSync = db
        .select()
        .from(syncState)
        .where(eq(syncState.chatJid, chatJid))
        .get();

      if (!currentSync) {
        db.insert(syncState)
          .values({
            chatJid,
            lastMessageId: messageId,
            lastTimestamp: timestamp,
            lastSyncAt: Math.floor(Date.now() / 1000),
          })
          .run();
      } else if (!currentSync.lastTimestamp || timestamp > currentSync.lastTimestamp) {
        db.update(syncState)
          .set({
            lastMessageId: messageId,
            lastTimestamp: timestamp,
            lastSyncAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(syncState.chatJid, chatJid))
          .run();
      }

      console.log(`Message captured: ${messageId} from ${sender}`);
    }
  });

  console.log(`Message handler active for chat: ${chatJid}`);

  // Ensure chat exists in DB
  const existingChat = db
    .select()
    .from(chats)
    .where(eq(chats.jid, chatJid))
    .get();

  if (!existingChat) {
    db.insert(chats)
      .values({
        jid: chatJid,
        createdAt: new Date(),
      })
      .run();
    console.log(`Chat ${chatJid} registered in database`);
  }
}
