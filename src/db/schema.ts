import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const chats = sqliteTable("chats", {
  jid: text("jid").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatJid: text("chat_jid")
    .notNull()
    .references(() => chats.jid),
  messageId: text("message_id").notNull().unique(),
  sender: text("sender"),
  content: text("content"),
  messageType: text("message_type"),
  timestamp: integer("timestamp").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const syncState = sqliteTable("sync_state", {
  chatJid: text("chat_jid")
    .primaryKey()
    .references(() => chats.jid),
  lastMessageId: text("last_message_id"),
  lastTimestamp: integer("last_timestamp"),
  lastSyncAt: integer("last_sync_at"),
});
