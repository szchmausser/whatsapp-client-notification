import "dotenv/config";

export type CaptureDirection = "incoming" | "outgoing" | "both";

export interface Config {
  chatJid: string;
  dbPath: string;
  logLevel: string;
  authDir: string;
  captureDirection: CaptureDirection;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  const direction = process.env.CAPTURE_DIRECTION || "both";
  if (!["incoming", "outgoing", "both"].includes(direction)) {
    throw new Error(`Invalid CAPTURE_DIRECTION: ${direction}. Must be: incoming, outgoing, or both`);
  }

  return {
    chatJid: requireEnv("CHAT_JID"),
    dbPath: process.env.DB_PATH || "./data/collector.db",
    logLevel: process.env.LOG_LEVEL || "info",
    authDir: process.env.AUTH_DIR || "./auth",
    captureDirection: direction as CaptureDirection,
  };
}
