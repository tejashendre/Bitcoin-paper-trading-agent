// Lazy environment validation — only runs when getEnv() is called at RUNTIME,
// never during next build. This prevents build crashes.

let cached: ReturnType<typeof validateEnv> | null = null;

function validateEnv() {
    const required = [
        "UPSTASH_REDIS_REST_URL",
        "UPSTASH_REDIS_REST_TOKEN",
        "PERPLEXITY_API_KEY",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_CHAT_ID",
    ] as const;

    const env: Record<string, string> = {};

    for (const key of required) {
        const value = process.env[key];
        if (!value) {
            throw new Error(`Missing required environment variable: ${key}`);
        }
        env[key] = value;
    }

    return {
        UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
        PERPLEXITY_API_KEY: env.PERPLEXITY_API_KEY,
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
        CRON_SECRET: process.env.CRON_SECRET || "",
    };
}

export function getEnv() {
    if (!cached) {
        cached = validateEnv();
    }
    return cached;
}
