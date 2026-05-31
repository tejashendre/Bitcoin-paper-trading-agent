// ================================================================
// Lazy Environment Validation
// Only validates when getEnv() is first called — NOT at build time.
// ================================================================

export interface Env {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  GEMINI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  DASHBOARD_SECRET: string;
  QSTASH_CURRENT_SIGNING_KEY: string;
  QSTASH_NEXT_SIGNING_KEY: string;
  TRADING_TIMEFRAME: string;
  RISK_PER_TRADE: number;
  ADMIN_SECRET: string;
  CRON_SECRET: string;
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const required = [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "GEMINI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "DASHBOARD_SECRET",
  ] as const;

  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  cached = {
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL!,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN!,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY!,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID!,
    DASHBOARD_SECRET: process.env.DASHBOARD_SECRET!,
    QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
    QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY || "",
    TRADING_TIMEFRAME: process.env.TRADING_TIMEFRAME || "1h",
    RISK_PER_TRADE: parseFloat(process.env.RISK_PER_TRADE || "1"),
    ADMIN_SECRET: process.env.ADMIN_SECRET || "admin123@",
    CRON_SECRET: process.env.CRON_SECRET || "",
  };

  return cached;
}
