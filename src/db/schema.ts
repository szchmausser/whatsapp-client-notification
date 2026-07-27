import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const channels = sqliteTable("channels", {
  jid: text("jid").primaryKey(),
  name: text("name"),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelJid: text("channel_jid")
    .notNull()
    .references(() => channels.jid),
  messageId: text("message_id").notNull().unique(),
  sender: text("sender"),
  content: text("content"),
  messageType: text("message_type"),
  timestamp: integer("timestamp").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const syncState = sqliteTable("sync_state", {
  channelJid: text("channel_jid")
    .primaryKey()
    .references(() => channels.jid),
  lastMessageId: text("last_message_id"),
  lastTimestamp: integer("last_timestamp"),
  lastSyncAt: integer("last_sync_at"),
});
