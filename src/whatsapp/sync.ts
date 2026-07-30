import type { WASocket } from "@whiskeysockets/baileys";
import { eq, asc } from "drizzle-orm";
import { messages } from "../db/schema.js";
import type { Database } from "../db/index.js";
import { processMessage } from "./message-processor.js";

const HISTORY_FETCH_COUNT = 50; // Baileys max per query

/**
 * Listen for full history sync on initial connection.
 * When syncFullHistory=true, Baileys sends ALL messages via this event.
 * This includes group messages.
 */
export function setupHistorySyncListener(
  socket: WASocket,
  db: Database,
  chatJids: string[],
  dispatchEnabled: boolean = false
): void {
  socket.ev.on("messaging-history.set", async ({ messages: histMsgs, chats, isLatest }) => {
    console.log(`[Sync] Full history received: ${histMsgs.length} messages, ${chats.length} chats (isLatest: ${isLatest})`);

    let captured = 0;
    for (const msg of histMsgs) {
      const msgJid = msg.key.remoteJid as string;
      if (!msg.key.remoteJid) continue;

      // Only process messages from monitored chats
      if (!chatJids.includes(msgJid)) continue;

      // Skip messages with no content
      if (!msg.message) continue;

      const messageId = msg.key.id;
      if (!messageId) continue;

      // Process message using shared logic
      const result = await processMessage({
        db,
        chatJid: msgJid,
        msg,
        dispatchEnabled,
      });

      if (!result.skipped) {
        captured++;
      }
    }

    if (captured > 0) {
      console.log(`[Sync] Captured ${captured} new messages from history`);
    }
  });
}

/**
 * Request older messages from a specific chat.
 * Requires the oldest message we already have as a reference point.
 * Messages arrive via messaging-history.set or messages.upsert (type=append).
 */
export async function fetchOlderMessages(
  socket: WASocket,
  db: Database,
  chatJid: string
): Promise<void> {
  console.log(`[Sync] Fetching older messages for ${chatJid}...`);

  try {
    // Get the oldest message we have for this chat
    const oldest = await db
      .select()
      .from(messages)
      .where(eq(messages.chatJid, chatJid))
      .orderBy(asc(messages.timestamp))
      .limit(1);

    if (oldest.length === 0) {
      console.log(`[Sync] No existing messages for ${chatJid}, cannot fetch older`);
      return;
    }

    const oldestMsg = oldest[0];
    const key = { remoteJid: chatJid, id: oldestMsg.messageId };
    const timestamp = oldestMsg.timestamp;

    console.log(`[Sync] Reference: oldest message ${oldestMsg.messageId} (ts: ${timestamp})`);

    const requestId = await socket.fetchMessageHistory(
      HISTORY_FETCH_COUNT,
      key,
      timestamp * 1000
    );
    console.log(`[Sync] History request sent (id: ${requestId}). Messages will arrive via messaging-history.set event.`);
  } catch (err) {
    console.error("[Sync] Failed to request history:", err);
  }
}
