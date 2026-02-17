import { redis } from "./redis";
import { Logger } from "./logger";

export interface Portfolio {
    usd: number;
    btc: number;
    lastUpdated: string;
}

export class PortfolioManager {
    private static readonly KEY = "user:portfolio";

    static async getPortfolio(): Promise<Portfolio> {
        const data = await redis.get<Portfolio>(this.KEY);
        if (!data) {
            // Initialize if not exists
            return this.resetPortfolio();
        }
        return data;
    }

    static async resetPortfolio(): Promise<Portfolio> {
        const initial: Portfolio = {
            usd: 10000, // $10k start
            btc: 0,
            lastUpdated: new Date().toISOString(),
        };
        await redis.set(this.KEY, initial);
        await Logger.info("Portfolio reset to initial state ($10,000 USD)");
        return initial;
    }

    static async updatePortfolio(portfolio: Portfolio): Promise<void> {
        portfolio.lastUpdated = new Date().toISOString();
        await redis.set(this.KEY, portfolio);
    }

    static async logTrade(action: "BUY" | "SELL", amount: number, price: number, reason: string) {
        const trade = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            action,
            amount,
            price,
            reason,
            totalValue: amount * price
        };
        await redis.lpush("user:trades", JSON.stringify(trade));
        await Logger.success(`Trade Executed: ${action} ${amount} BTC @ $${price}`, trade);
    }

    static async getTrades() {
        return await redis.lrange("user:trades", 0, 99); // Last 100 trades
    }
}
