import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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

  // Processed fields
  text: text("text"),
  senderName: text("sender_name"),
  replyTo: text("reply_to"),
  isForwarded: integer("is_forwarded", { mode: "boolean" }),
  isFromMe: integer("is_from_me", { mode: "boolean" }),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  caption: text("caption"),
  mediaUrl: text("media_url"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  fileName: text("file_name"),
  documentUrl: text("document_url"),
  reactionTo: text("reaction_to"),
  reactionEmoji: text("reaction_emoji"),

  // Forwarded message metadata
  forwardingScore: integer("forwarding_score"),
  isViewOnce: integer("is_view_once", { mode: "boolean" }),
  ephemeralExpiration: integer("ephemeral_expiration"),
  broadcast: integer("broadcast", { mode: "boolean" }),
  pushName: text("push_name"),

  // Audio/Video duration
  seconds: integer("seconds"),
  ptt: integer("ptt", { mode: "boolean" }),

  // Sticker
  isAnimated: integer("is_animated", { mode: "boolean" }),

  // Thumbnail (base64)
  jpegThumbnail: text("jpeg_thumbnail"),

  // Polls
  pollName: text("poll_name"),
  pollValues: text("poll_values"),
  selectableCount: integer("selectable_count"),

  // Group Invite
  groupJid: text("group_jid"),
  groupName: text("group_name"),
  inviteCode: text("invite_code"),
  inviteExpiration: integer("invite_expiration"),

  // Interactive Responses
  selectedButtonId: text("selected_button_id"),
  selectedListOption: text("selected_list_option"),
  templateButtonSelectedId: text("template_button_selected_id"),
  nativeFlowResponse: text("native_flow_response"),

  // Order
  orderId: text("order_id"),
  orderHeadline: text("order_headline"),
  orderNote: text("order_note"),
});

export const syncState = sqliteTable("sync_state", {
  chatJid: text("chat_jid")
    .primaryKey()
    .references(() => chats.jid),
  lastMessageId: text("last_message_id"),
  lastTimestamp: integer("last_timestamp"),
  lastSyncAt: integer("last_sync_at"),
});
