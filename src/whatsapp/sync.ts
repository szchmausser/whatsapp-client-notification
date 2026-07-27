import type { WASocket } from "@whiskeysockets/baileys";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

type Database = BetterSQLite3Database<typeof import("../db/schema.js")>;

export async function performCatchUpSync(
  _socket: WASocket,
  _db: Database,
  _chatJid: string
): Promise<void> {
  console.log("Backfill not supported for individual chats");
  console.log("Real-time message capture will collect new messages going forward");
}
