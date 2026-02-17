import { getRedis } from "./redis";
import { Logger } from "./logger";

export interface Portfolio {
    usd: number;
    btc: number;
    lastUpdated: string;
}

export interface Trade {
    id: string;
    timestamp: string;
    action: "BUY" | "SELL";
    amount: number;
    price: number;
    reason: string;
    totalValue: number;
}

export class PortfolioManager {
    private static readonly KEY = "user:portfolio";
    private static readonly TRADE_KEY = "user:trades";

    static async getPortfolio(): Promise<Portfolio> {
        const redis = getRedis();
        const data = await redis.get<Portfolio>(this.KEY);
        if (!data) {
            return this.resetPortfolio();
        }
        return data;
    }

    static async resetPortfolio(): Promise<Portfolio> {
        const redis = getRedis();
        const initial: Portfolio = {
            usd: 10000,
            btc: 0,
            lastUpdated: new Date().toISOString(),
        };
        await redis.set(this.KEY, initial);
        await Logger.info("Portfolio reset to initial state ($10,000 USD)");
        return initial;
    }

    static async updatePortfolio(portfolio: Portfolio): Promise<void> {
        const redis = getRedis();
        portfolio.lastUpdated = new Date().toISOString();
        await redis.set(this.KEY, portfolio);
    }

    static async logTrade(
        action: "BUY" | "SELL",
        amount: number,
        price: number,
        reason: string
    ) {
        const redis = getRedis();
        const trade: Trade = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            action,
            amount,
            price,
            reason,
            totalValue: amount * price,
        };
        await redis.lpush(this.TRADE_KEY, JSON.stringify(trade));
        await Logger.success(`Trade Executed: ${action} ${amount.toFixed(6)} BTC @ $${price.toLocaleString("en-US")}`, trade);
    }

    static async getTrades(): Promise<Trade[]> {
        const redis = getRedis();
        const rawTrades = await redis.lrange(this.TRADE_KEY, 0, 99);
        // @upstash/redis may auto-parse; handle both string and object
        return rawTrades.map((t) => {
            if (typeof t === "string") {
                try { return JSON.parse(t) as Trade; } catch { return t as unknown as Trade; }
            }
            return t as Trade;
        });
    }
}
