import "dotenv/config";

export type CaptureDirection = "incoming" | "outgoing" | "both";

export interface Config {
  chatJid: string;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
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
    db: {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "3306", 10),
      user: process.env.DB_USER || "reader_notification",
      password: process.env.DB_PASSWORD || "password123",
      database: process.env.DB_NAME || "hj-app",
    },
    logLevel: process.env.LOG_LEVEL || "info",
    authDir: process.env.AUTH_DIR || "./auth",
    captureDirection: direction as CaptureDirection,
  };
}
