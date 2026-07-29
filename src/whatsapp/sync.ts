import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { eq, asc } from "drizzle-orm";
import { messages, dispatchNotifications } from "../db/schema.js";
import type { Database } from "../db/index.js";
import { classifyDispatch, extractDispatchFields, matchCompany, companies } from "../dispatch/index.js";

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

      // Idempotency check
      const existing = await db
        .select()
        .from(messages)
        .where(eq(messages.messageId, messageId))
        .limit(1);

      if (existing.length > 0) continue;

      // Extract fields (same as handler)
      const m = msg.message;
      const sender = msg.key.participant || msg.key.remoteJid || undefined;
      const messageType = Object.keys(m)[0] || "unknown";
      const content = JSON.stringify(m);
      const text = m.conversation || m.extendedTextMessage?.text || undefined;
      const caption =
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        undefined;
      const fullText = text || caption || undefined;

      const timestamp = msg.messageTimestamp
        ? typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp
          : Number(msg.messageTimestamp)
        : Math.floor(Date.now() / 1000);

      await db.insert(messages).values({
        chatJid: msgJid,
        messageId,
        sender: sender || null,
        content,
        messageType,
        timestamp,
        createdAt: new Date(),
        text: text || null,
        senderName: msg.pushName || null,
        replyTo: m.extendedTextMessage?.contextInfo?.stanzaId || null,
        isForwarded: m.extendedTextMessage?.contextInfo?.isForwarded ? true : false,
        isFromMe: msg.key.fromMe ? true : false,
        mimeType: (m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage)?.mimetype || null,
        fileSize: (m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage)?.fileLength
          ? Number((m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage)!.fileLength)
          : null,
        caption: caption || null,
        mediaUrl: null,
        latitude: m.locationMessage?.degreesLatitude ?? null,
        longitude: m.locationMessage?.degreesLongitude ?? null,
        contactName: m.contactMessage?.displayName || null,
        contactPhone: m.contactMessage?.vcard
          ? m.contactMessage.vcard.match(/TEL[^:]*:([^\r\n]+)/)?.[1]?.trim() || null
          : null,
        fileName: m.documentMessage?.fileName || null,
        documentUrl: null,
        reactionTo: m.reactionMessage?.key?.id || null,
        reactionEmoji: m.reactionMessage?.text || null,
        forwardingScore: m.extendedTextMessage?.contextInfo?.forwardingScore ?? null,
        isViewOnce: !!(m.viewOnceMessage || m.viewOnceMessageV2),
        ephemeralExpiration: msg.ephemeralDuration ?? null,
        broadcast: msg.broadcast ? true : false,
        pushName: msg.pushName || null,
        seconds: m.audioMessage?.seconds || m.videoMessage?.seconds || null,
        ptt: m.audioMessage?.ptt ? true : false,
        isAnimated: m.stickerMessage?.isAnimated ? true : false,
        jpegThumbnail: null,
        pollName: m.pollCreationMessage?.name || null,
        pollValues: m.pollCreationMessage?.options ? JSON.stringify(m.pollCreationMessage.options) : null,
        selectableCount: m.pollCreationMessage?.selectableOptionsCount || null,
        groupJid: m.groupInviteMessage?.groupJid || null,
        groupName: m.groupInviteMessage?.groupName || null,
        inviteCode: m.groupInviteMessage?.inviteCode || null,
        inviteExpiration: m.groupInviteMessage?.inviteExpiration != null
          ? Number(m.groupInviteMessage.inviteExpiration)
          : null,
        selectedButtonId: m.buttonsResponseMessage?.selectedButtonId || null,
        selectedListOption: m.listResponseMessage?.singleSelectReply?.selectedRowId || null,
        templateButtonSelectedId: m.templateButtonReplyMessage?.selectedId || null,
        nativeFlowResponse: m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || null,
        orderId: m.orderMessage?.orderId || null,
        orderHeadline: m.orderMessage?.orderTitle || null,
        orderNote: m.orderMessage?.message || null,
      });

      captured++;

      // === DISPATCH CLASSIFICATION ===
      if (dispatchEnabled && fullText) {
        try {
          const classification = classifyDispatch(fullText);
          if (classification.isDispatch) {
            let fields: ReturnType<typeof extractDispatchFields> | null = null;
            try { fields = extractDispatchFields(fullText); } catch { fields = null; }

            let match = null;
            if (fields?.destinationName) {
              try { match = matchCompany(fields.destinationName, companies); } catch { match = null; }
            }

            const isFromMe = msg.key.fromMe ?? false;
            const senderName = msg.pushName || null;
            const imageMsg = m.imageMessage;
            const videoMsg = m.videoMessage;
            const audioMsg = m.audioMessage;
            const documentMsg = m.documentMessage;
            const mediaMsg = imageMsg || videoMsg || audioMsg || documentMsg;

            await db.insert(dispatchNotifications).values({
              chatJid: msgJid,
              messageId,
              sender: sender || null,
              content,
              messageType,
              timestamp,
              createdAt: new Date(),
              text: fullText || null,
              senderName,
              replyTo: m.extendedTextMessage?.contextInfo?.stanzaId || null,
              isForwarded: m.extendedTextMessage?.contextInfo?.isForwarded ? true : false,
              isFromMe: isFromMe ? true : false,
              mimeType: mediaMsg?.mimetype || null,
              fileSize: mediaMsg?.fileLength ? Number(mediaMsg.fileLength) : null,
              caption: caption || null,
              mediaUrl: null,
              latitude: m.locationMessage?.degreesLatitude ?? null,
              longitude: m.locationMessage?.degreesLongitude ?? null,
              contactName: m.contactMessage?.displayName || null,
              contactPhone: m.contactMessage?.vcard
                ? m.contactMessage.vcard.match(/TEL[^:]*:([^\r\n]+)/)?.[1]?.trim() || null : null,
              fileName: documentMsg?.fileName || null,
              documentUrl: null,
              reactionTo: m.reactionMessage?.key?.id || null,
              reactionEmoji: m.reactionMessage?.text || null,
              forwardingScore: m.extendedTextMessage?.contextInfo?.forwardingScore ?? null,
              isViewOnce: !!(m.viewOnceMessage || m.viewOnceMessageV2),
              ephemeralExpiration: msg.ephemeralDuration ?? null,
              broadcast: msg.broadcast ? true : false,
              pushName: msg.pushName || null,
              seconds: audioMsg?.seconds || videoMsg?.seconds || null,
              ptt: audioMsg?.ptt ? true : false,
              isAnimated: m.stickerMessage?.isAnimated ? true : false,
              jpegThumbnail: null,
              pollName: m.pollCreationMessage?.name || null,
              pollValues: m.pollCreationMessage?.options ? JSON.stringify(m.pollCreationMessage.options) : null,
              selectableCount: m.pollCreationMessage?.selectableOptionsCount || null,
              groupJid: m.groupInviteMessage?.groupJid || null,
              groupName: m.groupInviteMessage?.groupName || null,
              inviteCode: m.groupInviteMessage?.inviteCode || null,
              inviteExpiration: m.groupInviteMessage?.inviteExpiration != null ? Number(m.groupInviteMessage.inviteExpiration) : null,
              selectedButtonId: m.buttonsResponseMessage?.selectedButtonId || null,
              selectedListOption: m.listResponseMessage?.singleSelectReply?.selectedRowId || null,
              templateButtonSelectedId: m.templateButtonReplyMessage?.selectedId || null,
              nativeFlowResponse: m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || null,
              orderId: m.orderMessage?.orderId || null,
              orderHeadline: m.orderMessage?.orderTitle || null,
              orderNote: m.orderMessage?.message || null,
              // Dispatch-specific
              isDispatch: true,
              confidence: classification.confidence,
              dispatchType: classification.dispatchType,
              vehicleType: fields?.vehicleType ?? null,
              plate: fields?.plate ?? null,
              driverName: fields?.driverName ?? null,
              driverId: fields?.driverId ?? null,
              driverPhone: fields?.driverPhone ?? null,
              motorcycleCount: fields?.motorcycleCount ?? null,
              destinationName: fields?.destinationName ?? null,
              invoices: fields?.invoices ?? null,
              controlNotes: fields?.controlNotes ?? null,
              franelas: fields?.franelas ?? null,
              warranty: fields?.warranty ?? null,
              matchedCompanyId: match?.companyId ?? null,
              matchedConfidence: match?.confidence ?? null,
              status: "pending_extraction",
              classifiedAt: new Date(),
              sentAt: null,
              errorMessage: null,
            });

            console.log(`[Sync][Dispatch] Captured dispatch ${messageId} (confidence: ${classification.confidence})`);
            if (fields?.plate) console.log(`[Sync][Dispatch]   plate: ${fields.plate}`);
            if (fields?.destinationName) console.log(`[Sync][Dispatch]   destination: ${fields.destinationName}`);
          }
        } catch {
          // Non-blocking — message already saved
        }
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
      timestamp
    );
    console.log(`[Sync] History request sent (id: ${requestId}). Messages will arrive via messaging-history.set event.`);
  } catch (err) {
    console.error("[Sync] Failed to request history:", err);
  }
}
