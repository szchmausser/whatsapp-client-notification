import "dotenv/config";

export interface Config {
  channelJid: string;
  dbPath: string;
  logLevel: string;
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
    channelJid: requireEnv("CHANNEL_JID"),
    dbPath: process.env.DB_PATH || "./data/collector.db",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
