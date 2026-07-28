import type { WASocket } from "@whiskeysockets/baileys";
import type { Connection } from "mysql2/promise";

export async function performCatchUpSync(
  _socket: WASocket,
  _db: Connection,
  _chatJid: string
): Promise<void> {
  console.log("Backfill not supported for individual chats");
  console.log("Real-time message capture will collect new messages going forward");
}
