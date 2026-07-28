import { mysqlTable, varchar, int, real, boolean, timestamp, text } from "drizzle-orm/mysql-core";

export const chats = mysqlTable("chats", {
  jid: varchar("jid", { length: 255 }).primaryKey(),
  createdAt: timestamp("created_at").notNull(),
});

export const messages = mysqlTable("messages", {
  id: int("id").primaryKey().autoincrement(),
  chatJid: varchar("chat_jid", { length: 255 })
    .notNull()
    .references(() => chats.jid),
  messageId: varchar("message_id", { length: 255 }).notNull().unique(),
  sender: varchar("sender", { length: 255 }),
  content: text("content"),
  messageType: varchar("message_type", { length: 50 }),
  timestamp: int("timestamp").notNull(),
  createdAt: timestamp("created_at").notNull(),

  // Processed fields
  text: text("text"),
  senderName: varchar("sender_name", { length: 255 }),
  replyTo: varchar("reply_to", { length: 255 }),
  isForwarded: boolean("is_forwarded"),
  isFromMe: boolean("is_from_me"),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: int("file_size"),
  caption: text("caption"),
  mediaUrl: text("media_url"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  contactName: varchar("contact_name", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  fileName: varchar("file_name", { length: 255 }),
  documentUrl: text("document_url"),
  reactionTo: varchar("reaction_to", { length: 255 }),
  reactionEmoji: varchar("reaction_emoji", { length: 50 }),

  // Forwarded message metadata
  forwardingScore: int("forwarding_score"),
  isViewOnce: boolean("is_view_once"),
  ephemeralExpiration: int("ephemeral_expiration"),
  broadcast: boolean("broadcast"),
  pushName: varchar("push_name", { length: 255 }),

  // Audio/Video duration
  seconds: int("seconds"),
  ptt: boolean("ptt"),

  // Sticker
  isAnimated: boolean("is_animated"),

  // Thumbnail (base64)
  jpegThumbnail: text("jpeg_thumbnail"),

  // Polls
  pollName: varchar("poll_name", { length: 255 }),
  pollValues: text("poll_values"),
  selectableCount: int("selectable_count"),

  // Group Invite
  groupJid: varchar("group_jid", { length: 255 }),
  groupName: varchar("group_name", { length: 255 }),
  inviteCode: varchar("invite_code", { length: 255 }),
  inviteExpiration: int("invite_expiration"),

  // Interactive Responses
  selectedButtonId: varchar("selected_button_id", { length: 255 }),
  selectedListOption: varchar("selected_list_option", { length: 255 }),
  templateButtonSelectedId: varchar("template_button_selected_id", { length: 255 }),
  nativeFlowResponse: text("native_flow_response"),

  // Order
  orderId: varchar("order_id", { length: 255 }),
  orderHeadline: varchar("order_headline", { length: 255 }),
  orderNote: text("order_note"),
});

export const syncState = mysqlTable("sync_state", {
  chatJid: varchar("chat_jid", { length: 255 })
    .primaryKey()
    .references(() => chats.jid),
  lastMessageId: varchar("last_message_id", { length: 255 }),
  lastTimestamp: int("last_timestamp"),
  lastSyncAt: int("last_sync_at"),
});
