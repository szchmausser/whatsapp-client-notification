import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export async function createDb(config: DbConfig) {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30_000,
    waitForConnections: true,
  });

  const db = drizzle(pool, { schema, mode: "default" });
  return db;
}

export type Database = ReturnType<typeof createDb> extends Promise<infer T> ? T : never;
