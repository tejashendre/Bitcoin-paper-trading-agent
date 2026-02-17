import { z } from "zod";

const envSchema = z.object({
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    PERPLEXITY_API_KEY: z.string().min(1),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_CHAT_ID: z.string().min(1),
    CRON_SECRET: z.string().optional(), // Optional for local dev/testing
    // Public vars (if any)
});

export const env = envSchema.parse(process.env);
