import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { dispatchNotifications, messages, chats, syncState } from "./src/db/schema.js";

async function main() {
  const pool = mysql.createPool("mysql://reader_notification:password123@localhost:3306/client_notification");
  const db = drizzle(pool);

  // Delete in reverse dependency order
  await db.delete(dispatchNotifications);
  await db.delete(syncState);
  await db.delete(messages);
  await db.delete(chats);

  console.log("All data cleared");
  await pool.end();
}

main().catch(e => console.error("Error:", e.message));
