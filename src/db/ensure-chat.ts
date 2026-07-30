import { chats } from "./schema.js";
import type { Database } from "./index.js";

/**
 * Idempotent chat registration. Inserts the chat row if it doesn't exist.
 * Safe to call multiple times — duplicate key errors are silently ignored.
 */
export async function ensureChat(db: Database, chatJid: string): Promise<void> {
  try {
    await db.insert(chats).values({
      jid: chatJid,
      createdAt: new Date(),
    });
    console.log(`Chat ${chatJid} registered in database`);
  } catch (err: unknown) {
    const isDuplicate =
      err instanceof Error && "code" in err && (err as any).code === "ER_DUP_ENTRY";
    if (!isDuplicate) throw err;
  }
}
