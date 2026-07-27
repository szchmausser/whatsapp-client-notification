import "dotenv/config";

export interface Config {
  chatJid: string;
  dbPath: string;
  logLevel: string;
  authDir: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    chatJid: requireEnv("CHAT_JID"),
    dbPath: process.env.DB_PATH || "./data/collector.db",
    logLevel: process.env.LOG_LEVEL || "info",
    authDir: process.env.AUTH_DIR || "./auth",
  };
}
