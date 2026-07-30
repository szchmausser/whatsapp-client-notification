/**
 * message-processor.ts — Shared message processing logic.
 *
 * Single source of truth for:
 *   - Field extraction from a WAMessage
 *   - DB insertion (with idempotency)
 *   - Dispatch classification + insertion
 *
 * Used by:
 *   - handler.ts (real-time messages)
 *   - sync.ts (history sync)
 *   - scripts/fetch-day.ts (on-demand day import)
 */

import type { WAMessage } from "@whiskeysockets/baileys";
import { eq } from "drizzle-orm";
import { messages, dispatchNotifications } from "../db/schema.js";
import type { Database } from "../db/index.js";
import {
  classifyDispatch,
  extractDispatchFields,
  matchCompany,
  companies,
} from "../dispatch/index.js";

// ── Types ──────────────────────────────────────────────────────

export interface ProcessResult {
  /** The message was already in DB — skipped */
  skipped: boolean;
  /** The message's WhatsApp ID */
  messageId: string | null | undefined;
  /** The message sender JID */
  sender: string | null | undefined;
  /** The message was inserted as a dispatch notification */
  classified: boolean;
  /** The dispatch result details, if classified */
  dispatchInfo: {
    confidence: number;
    plate: string | null;
    driverName: string | null;
    destinationName: string | null;
    companyId: number | null;
  } | null;
  /** Insertion error, if any */
  error: Error | null;
}

export interface ProcessOptions {
  db: Database;
  chatJid: string;
  msg: WAMessage;
  dispatchEnabled?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────

function extractPhoneFromVCard(vcard: string): string | null {
  const match = vcard.match(/TEL[^:]*:([^\r\n]+)/);
  return match ? match[1].trim() : null;
}

function extractPollValues(
  pollMsg: { options?: Array<{ optionName?: string | null } | null> | null } | null | undefined
): string | null {
  if (!pollMsg?.options) return null;
  return JSON.stringify(
    pollMsg.options.map((o) => ({ name: o?.optionName }))
  );
}

// ── Main processor ─────────────────────────────────────────────

export async function processMessage(
  opts: ProcessOptions,
): Promise<ProcessResult> {
  const { db, chatJid, msg, dispatchEnabled = false } = opts;

  const messageId = msg.key?.id;
  if (!messageId)
    return { skipped: true, messageId, sender: null, classified: false, dispatchInfo: null, error: null };

  // ── Idempotency check ────────────────────────────────────────
  const existing = await db
    .select()
    .from(messages)
    .where(eq(messages.messageId, messageId))
    .limit(1);

  if (existing.length > 0) {
    return { skipped: true, messageId, sender: null, classified: false, dispatchInfo: null, error: null };
  }

  // ── Field extraction ─────────────────────────────────────────
  const m = msg.message;
  if (!m)
    return { skipped: true, messageId, sender: null, classified: false, dispatchInfo: null, error: null };

  const sender = msg.key.participant || msg.key.remoteJid || undefined;
  const messageType = Object.keys(m)[0] || "unknown";
  const content = JSON.stringify(m);
  const isFromMe = msg.key.fromMe ?? false;

  // Text content
  const text = m.conversation || m.extendedTextMessage?.text || undefined;

  // Media objects
  const imageMsg = m.imageMessage;
  const videoMsg = m.videoMessage;
  const audioMsg = m.audioMessage;
  const documentMsg = m.documentMessage;
  const mediaMsg = imageMsg || videoMsg || audioMsg || documentMsg;

  // Caption
  const caption =
    imageMsg?.caption ||
    videoMsg?.caption ||
    documentMsg?.caption ||
    undefined;

  // Combined full text for dispatch classification
  const fullText = text || caption || undefined;

  // Reply
  const replyTo =
    m.extendedTextMessage?.contextInfo?.stanzaId || undefined;

  // Location
  const latitude = m.locationMessage?.degreesLatitude ?? undefined;
  const longitude = m.locationMessage?.degreesLongitude ?? undefined;

  // Contact
  const contactName = m.contactMessage?.displayName || undefined;
  const contactPhone = m.contactMessage?.vcard
    ? extractPhoneFromVCard(m.contactMessage.vcard)
    : undefined;

  // Document
  const fileName = documentMsg?.fileName || undefined;

  // Reactions
  const reactionTo = m.reactionMessage?.key?.id || undefined;
  const reactionEmoji = m.reactionMessage?.text || undefined;

  // Flags
  const isForwarded =
    m.extendedTextMessage?.contextInfo?.isForwarded ?? null;
  const isViewOnce = !!(m.viewOnceMessage || m.viewOnceMessageV2);
  const broadcast = msg.broadcast ?? false;

  // Media metadata
  const mimeType = mediaMsg?.mimetype || undefined;
  const fileSize = mediaMsg?.fileLength
    ? Number(mediaMsg.fileLength)
    : undefined;

  // Audio / video duration
  const seconds = audioMsg?.seconds || videoMsg?.seconds || undefined;
  const ptt = audioMsg?.ptt ?? false;

  // Sticker
  const isAnimated = m.stickerMessage?.isAnimated ?? false;

  // Polls
  const pollName = m.pollCreationMessage?.name || null;
  const pollValues = extractPollValues(m.pollCreationMessage);
  const selectableCount =
    m.pollCreationMessage?.selectableOptionsCount || null;

  // Group invite
  const groupJid = m.groupInviteMessage?.groupJid || null;
  const groupName = m.groupInviteMessage?.groupName || null;
  const inviteCode = m.groupInviteMessage?.inviteCode || null;
  const inviteExpiration =
    m.groupInviteMessage?.inviteExpiration != null
      ? Number(m.groupInviteMessage.inviteExpiration)
      : null;

  // Interactive responses
  const selectedButtonId =
    m.buttonsResponseMessage?.selectedButtonId || null;
  const selectedListOption =
    m.listResponseMessage?.singleSelectReply?.selectedRowId || null;
  const templateButtonSelectedId =
    m.templateButtonReplyMessage?.selectedId || null;
  const nativeFlowResponse =
    m.interactiveResponseMessage?.nativeFlowResponseMessage
      ?.paramsJson || null;

  // Order
  const orderId = m.orderMessage?.orderId || null;
  const orderHeadline = m.orderMessage?.orderTitle || null;
  const orderNote = m.orderMessage?.message || null;

  // Forwarding score
  const forwardingScore =
    m.extendedTextMessage?.contextInfo?.forwardingScore ?? null;

  // Timestamp
  const timestamp = msg.messageTimestamp
    ? typeof msg.messageTimestamp === "number"
      ? msg.messageTimestamp
      : Number(msg.messageTimestamp)
    : Math.floor(Date.now() / 1000);

  // ── Insert message ───────────────────────────────────────────
  try {
    await db.insert(messages).values({
      chatJid,
      messageId,
      sender: sender || null,
      content,
      messageType,
      timestamp,
      createdAt: new Date(),
      text: text || null,
      senderName: msg.pushName || null,
      replyTo: replyTo || null,
      isForwarded: isForwarded ? true : false,
      isFromMe: isFromMe ? true : false,
      mimeType: mimeType || null,
      fileSize: fileSize || null,
      caption: caption || null,
      mediaUrl: null,
      latitude: latitude || null,
      longitude: longitude || null,
      contactName: contactName || null,
      contactPhone: contactPhone || null,
      fileName: fileName || null,
      documentUrl: null,
      reactionTo: reactionTo || null,
      reactionEmoji: reactionEmoji || null,
      forwardingScore: forwardingScore || null,
      isViewOnce: isViewOnce ? true : false,
      ephemeralExpiration: msg.ephemeralDuration ?? null,
      broadcast: broadcast ? true : false,
      pushName: msg.pushName || null,
      seconds: seconds || null,
      ptt: ptt ? true : false,
      isAnimated: isAnimated ? true : false,
      jpegThumbnail: null,
      pollName,
      pollValues,
      selectableCount,
      groupJid,
      groupName,
      inviteCode,
      inviteExpiration,
      selectedButtonId,
      selectedListOption,
      templateButtonSelectedId,
      nativeFlowResponse,
      orderId,
      orderHeadline,
      orderNote,
    });
  } catch (err) {
    return { skipped: true, messageId, sender, classified: false, dispatchInfo: null, error: err as Error };
  }

  // ── Dispatch classification ──────────────────────────────────
  let classified = false;
  let dispatchInfo: ProcessResult["dispatchInfo"] = null;

  if (dispatchEnabled && fullText) {
    try {
      const classification = classifyDispatch(fullText);

      console.log(
        `[Dispatch] Classification: isDispatch=${classification.isDispatch}, confidence=${classification.confidence}`,
      );

      if (classification.isDispatch) {
        let fields: ReturnType<typeof extractDispatchFields> | null =
          null;
        try {
          fields = extractDispatchFields(fullText);
        } catch {
          fields = null;
        }

        let match: { companyId: number; confidence: number } | null =
          null;
        if (fields?.destinationName) {
          try {
            match = matchCompany(fields.destinationName, companies);
          } catch {
            match = null;
          }
        }

        await db.insert(dispatchNotifications).values({
          chatJid,
          messageId,
          sender: sender || null,
          content,
          messageType,
          timestamp,
          createdAt: new Date(),
          text: fullText || null,
          senderName: msg.pushName || null,
          replyTo: replyTo || null,
          isForwarded: isForwarded ? true : false,
          isFromMe: isFromMe ? true : false,
          mimeType: mimeType || null,
          fileSize: fileSize || null,
          caption: caption || null,
          mediaUrl: null,
          latitude: latitude || null,
          longitude: longitude || null,
          contactName: contactName || null,
          contactPhone: contactPhone || null,
          fileName: fileName || null,
          documentUrl: null,
          reactionTo: reactionTo || null,
          reactionEmoji: reactionEmoji || null,
          forwardingScore: forwardingScore || null,
          isViewOnce: isViewOnce ? true : false,
          ephemeralExpiration: msg.ephemeralDuration ?? null,
          broadcast: broadcast ? true : false,
          pushName: msg.pushName || null,
          seconds: seconds || null,
          ptt: ptt ? true : false,
          isAnimated: isAnimated ? true : false,
          jpegThumbnail: null,
          pollName,
          pollValues,
          selectableCount,
          groupJid,
          groupName,
          inviteCode,
          inviteExpiration,
          selectedButtonId,
          selectedListOption,
          templateButtonSelectedId,
          nativeFlowResponse,
          orderId,
          orderHeadline,
          orderNote,
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

        classified = true;
        dispatchInfo = {
          confidence: classification.confidence,
          plate: fields?.plate ?? null,
          driverName: fields?.driverName ?? null,
          destinationName: fields?.destinationName ?? null,
          companyId: match?.companyId ?? null,
        };

        console.log(
          `[Dispatch] Saved dispatch ${messageId} (confidence: ${classification.confidence})`,
        );
        if (fields?.plate) console.log(`[Dispatch]   plate: ${fields.plate}`);
        if (fields?.driverName)
          console.log(`[Dispatch]   driver: ${fields.driverName}`);
        if (fields?.destinationName)
          console.log(`[Dispatch]   destination: ${fields.destinationName}`);
        if (match)
          console.log(
            `[Dispatch]   matched company #${match.companyId} (${match.confidence})`,
          );
      }
    } catch (err) {
      console.error(`[Dispatch] Classification error for ${messageId}:`, err);
    }
  }

  return {
    skipped: false,
    messageId,
    sender,
    classified,
    dispatchInfo,
    error: null,
  };
}
