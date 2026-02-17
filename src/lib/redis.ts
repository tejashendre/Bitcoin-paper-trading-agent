import { Redis } from "@upstash/redis";

/**
 * Singleton Redis client for serverless (Upstash HTTP).
 * Uses UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
 */

let client: Redis | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function getRedis(): Redis {
  if (client === null) {
    const url = getRequiredEnv("UPSTASH_REDIS_REST_URL");
    const token = getRequiredEnv("UPSTASH_REDIS_REST_TOKEN");
    client = new Redis({ url, token });
  }
  return client;
}

/** Redis client singleton (alias for getRedis). */
export const redis = {
  get client(): Redis {
    return getRedis();
  },
};

export default redis;
