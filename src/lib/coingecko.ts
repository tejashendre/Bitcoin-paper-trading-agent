import axios from "axios";
import { getRedis } from "./redis";
import { Logger } from "./logger";

const CACHE_KEY = "cache:btc_price";
const CACHE_TTL_SECONDS = 120; // Cache price for 2 minutes

export class PriceService {
    /**
     * Get Bitcoin price with Redis caching to avoid CoinGecko rate limits.
     * The free CoinGecko API allows ~10-30 req/min. Dashboard polls every 10s,
     * so we cache the price for 2 minutes.
     */
    static async getBitcoinPrice(): Promise<number> {
        const redis = getRedis();

        // 1. Check cache first
        try {
            const cached = await redis.get<number>(CACHE_KEY);
            if (cached && cached > 0) {
                return cached;
            }
        } catch {
            // Cache miss or Redis error — fall through to API
        }

        // 2. Fetch from CoinGecko
        try {
            const response = await axios.get(
                "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
                { timeout: 10000 }
            );

            const price = response.data?.bitcoin?.usd;
            if (!price || typeof price !== "number") {
                throw new Error("Invalid price data from CoinGecko");
            }

            // 3. Store in cache with TTL
            try {
                await redis.set(CACHE_KEY, price, { ex: CACHE_TTL_SECONDS });
            } catch {
                // Non-critical — price was fetched successfully
            }

            return price;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);

            // 4. If API fails (429 rate limit), try returning stale cache
            try {
                const stale = await redis.get<number>(CACHE_KEY);
                if (stale && stale > 0) {
                    await Logger.warn(`CoinGecko rate limited, using cached price: $${stale}`);
                    return stale;
                }
            } catch {
                // No cache available either
            }

            await Logger.error("Failed to fetch Bitcoin price", { error: msg });
            throw new Error(`Cannot get BTC price: ${msg}`);
        }
    }
}
