import { WASocket, getBinaryNodeChild } from "@whiskeysockets/baileys";
import { eq, desc } from "drizzle-orm";
import { messages, syncState } from "../db/schema.js";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

type Database = BetterSQLite3Database<typeof import("../db/schema.js")>;

export async function performCatchUpSync(
  socket: WASocket,
  db: Database,
  channelJid: string
): Promise<void> {
  console.log(`Starting catch-up sync for channel: ${channelJid}`);

  // Get current sync state
  const currentSync = db
    .select()
    .from(syncState)
    .where(eq(syncState.channelJid, channelJid))
    .get();

  if (!currentSync?.lastTimestamp) {
    console.log(
      "No previous sync state found. Skipping catch-up (will capture new messages going forward)"
    );
    return;
  }

  const lastTimestamp = currentSync.lastTimestamp;
  const now = Math.floor(Date.now() / 1000);
  const timeDiff = now - lastTimestamp;

  console.log(
    `Last sync: ${new Date(lastTimestamp * 1000).toISOString()} (${timeDiff}s ago)`
  );

  try {
    // newsletterFetchMessages(jid, count, since, after)
    // since = timestamp to fetch from, after = message ID to fetch after
    const result = await socket.newsletterFetchMessages(
      channelJid,
      100, // count: fetch up to 100 messages
      lastTimestamp, // since: timestamp of last known message
      0 // after: 0 means no specific message ID offset
    );

    // Navigate through the BinaryNode structure:
    // result (iq) -> message_upates -> [message, message, ...]
    const messageUpdatesNode = getBinaryNodeChild(result, "message_updates");
    const messageNodes = messageUpdatesNode?.content;

    if (!messageNodes || !Array.isArray(messageNodes)) {
      console.log("No messages returned from catch-up sync");
      return;
    }

    let syncedCount = 0;

    for (const node of messageNodes) {
      if (node.tag !== "message") continue;

      // Extract message attributes
      const attrs = node.attrs || {};
      const messageId = attrs.id || attrs.server_id;
      if (!messageId) continue;

      // Idempotency check
      const existing = db
        .select()
        .from(messages)
        .where(eq(messages.messageId, messageId))
        .get();

      if (existing) continue;

      // Extract timestamp
      const timestamp = attrs.t ? parseInt(attrs.t, 10) : now;

      // Extract content from message node
      // node.content may be a protobuf-encoded Buffer (for rich media) or an array of sub-nodes
      let content: string | null = null;
      let messageType = "unknown";

      if (Array.isArray(node.content) && node.content.length > 0) {
        const contentNode = node.content[0];
        if (contentNode && typeof contentNode === "object" && "tag" in contentNode) {
          content = JSON.stringify({
            tag: contentNode.tag,
            content: (contentNode as { tag?: string; content?: unknown }).content,
          });
          messageType = contentNode.tag || "unknown";
        }
      }

      // Insert message
      db.insert(messages)
        .values({
          channelJid,
          messageId,
          sender: attrs.participant || null,
          content,
          messageType,
          timestamp,
          createdAt: new Date(),
        })
        .run();

      syncedCount++;
    }

    // Update sync state if we got new messages
    if (syncedCount > 0) {
      // Get the latest message timestamp to advance sync cursor
      const latestMsg = db
        .select()
        .from(messages)
        .where(eq(messages.channelJid, channelJid))
        .orderBy(desc(messages.timestamp))
        .limit(1)
        .get();

      if (latestMsg) {
        db.update(syncState)
          .set({
            lastMessageId: latestMsg.messageId,
            lastTimestamp: latestMsg.timestamp,
            lastSyncAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(syncState.channelJid, channelJid))
          .run();
      }
    }

    console.log(`Catch-up sync complete: ${syncedCount} new messages synced`);

    if (syncedCount === 0) {
      console.log("No new messages to sync. Database is up to date.");
    }
  } catch (error) {
    console.error("Catch-up sync failed:", error);
    console.log(
      "Will continue with real-time message capture. Gap may exist in database."
    );
  }
}
