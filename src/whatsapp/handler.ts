import { WASocket } from "@whiskeysockets/baileys";
import { eq } from "drizzle-orm";
import { chats, messages, syncState } from "../db/schema.js";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

type Database = BetterSQLite3Database<typeof import("../db/schema.js")>;

function extractPhoneFromVCard(vcard: string): string | null {
  const match = vcard.match(/TEL[^:]*:([^\r\n]+)/);
  return match ? match[1].trim() : null;
}

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

      // --- Extract processed fields ---
      const m = msg.message;

      // Text content
      const text =
        m.conversation || m.extendedTextMessage?.text || undefined;

      // Sender info
      const senderName = msg.pushName || undefined;

      // Reply info
      const replyTo =
        m.extendedTextMessage?.contextInfo?.stanzaId || undefined;

      // Message flags
      const isForwarded =
        m.extendedTextMessage?.contextInfo?.isForwarded ?? null;
      const isFromMe = msg.key.fromMe ?? null;

      // Media (image, video, audio, document)
      const imageMsg = m.imageMessage;
      const videoMsg = m.videoMessage;
      const audioMsg = m.audioMessage;
      const documentMsg = m.documentMessage;
      const mediaMsg = imageMsg || videoMsg || audioMsg || documentMsg;

      const mimeType = mediaMsg?.mimetype || undefined;
      const fileSize = mediaMsg?.fileLength
        ? Number(mediaMsg.fileLength)
        : undefined;
      const caption =
        imageMsg?.caption ||
        videoMsg?.caption ||
        documentMsg?.caption ||
        undefined;
      const mediaUrl = undefined;

      // Location
      const locationMsg = m.locationMessage;
      const latitude = locationMsg?.degreesLatitude ?? undefined;
      const longitude = locationMsg?.degreesLongitude ?? undefined;

      // Contact / vCard
      const contactMsg = m.contactMessage;
      const contactName = contactMsg?.displayName || undefined;
      const contactPhone = contactMsg?.vcard
        ? extractPhoneFromVCard(contactMsg.vcard)
        : undefined;

      // Document
      const fileName = documentMsg?.fileName || undefined;
      const documentUrl = undefined;

      // Reactions
      const reactionMsg = m.reactionMessage;
      const reactionTo = reactionMsg?.key?.id || undefined;
      const reactionEmoji = reactionMsg?.text || undefined;

      // Text metadata
      const forwardingScore =
        m.extendedTextMessage?.contextInfo?.forwardingScore ?? null;
      const isViewOnce = !!(
        m.viewOnceMessage || m.viewOnceMessageV2
      );
      const ephemeralExpiration = msg.ephemeralDuration ?? null;
      const broadcast = msg.broadcast ?? false;
      const pushName = msg.pushName || null;

      // Audio/Video duration
      const seconds =
        audioMsg?.seconds || videoMsg?.seconds || null;
      const ptt = audioMsg?.ptt ?? false;

      // Sticker
      const stickerMsg = m.stickerMessage;
      const isAnimated = stickerMsg?.isAnimated ?? false;

      // Thumbnail (base64 from any media type)
      const thumbnailRaw: Uint8Array | null =
        imageMsg?.jpegThumbnail ||
        videoMsg?.jpegThumbnail ||
        documentMsg?.jpegThumbnail ||
        stickerMsg?.pngThumbnail ||
        locationMsg?.jpegThumbnail ||
        null;
      const jpegThumbnail = thumbnailRaw
        ? Buffer.from(thumbnailRaw).toString("base64")
        : null;

      // Polls
      const pollMsg = m.pollCreationMessage;
      const pollName = pollMsg?.name || null;
      const pollValues = pollMsg?.options
        ? JSON.stringify(pollMsg.options)
        : null;
      const selectableCount = pollMsg?.selectableOptionsCount || null;

      // Group Invite
      const inviteMsg = m.groupInviteMessage;
      const groupJid = inviteMsg?.groupJid || null;
      const groupName = inviteMsg?.groupName || null;
      const inviteCode = inviteMsg?.inviteCode || null;
      const inviteExpiration = inviteMsg?.inviteExpiration != null
        ? Number(inviteMsg.inviteExpiration)
        : null;

      // Interactive Responses
      const buttonsResponse = m.buttonsResponseMessage;
      const listResponse = m.listResponseMessage;
      const templateReply = m.templateButtonReplyMessage;
      const interactiveResponse = m.interactiveResponseMessage;
      const selectedButtonId =
        buttonsResponse?.selectedButtonId || null;
      const selectedListOption =
        listResponse?.singleSelectReply?.selectedRowId || null;
      const templateButtonSelectedId =
        templateReply?.selectedId || null;
      const nativeFlowResponse =
        interactiveResponse?.nativeFlowResponseMessage?.paramsJson ||
        null;

      // Order
      const orderMsg = m.orderMessage;
      const orderId = orderMsg?.orderId || null;
      const orderHeadline = orderMsg?.orderTitle || null;
      const orderNote = orderMsg?.message || null;

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
          text,
          senderName,
          replyTo,
          isForwarded,
          isFromMe,
          mimeType,
          fileSize,
          caption,
          mediaUrl,
          latitude,
          longitude,
          contactName,
          contactPhone,
          fileName,
          documentUrl,
          reactionTo,
          reactionEmoji,

          // Text metadata
          forwardingScore,
          isViewOnce,
          ephemeralExpiration,
          broadcast,
          pushName,

          // Audio/Video duration
          seconds,
          ptt,

          // Sticker
          isAnimated,

          // Thumbnail (base64)
          jpegThumbnail,

          // Polls
          pollName,
          pollValues,
          selectableCount,

          // Group Invite
          groupJid,
          groupName,
          inviteCode,
          inviteExpiration,

          // Interactive Responses
          selectedButtonId,
          selectedListOption,
          templateButtonSelectedId,
          nativeFlowResponse,

          // Order
          orderId,
          orderHeadline,
          orderNote,
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
