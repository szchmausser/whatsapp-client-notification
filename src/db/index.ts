import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });

  // Run migrations
  migrate(db, { migrationsFolder: "./drizzle" });

  return db;
}
