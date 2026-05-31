// ================================================================
// Lazy Upstash Redis Client
// ================================================================

import { Redis } from "@upstash/redis";
import { getEnv } from "./env";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const env = getEnv();
    client = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return client;
}
