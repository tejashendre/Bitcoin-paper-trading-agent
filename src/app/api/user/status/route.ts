import { NextResponse } from "next/server";
import { PortfolioManager } from "@/lib/portfolio";
import { Logger } from "@/lib/logger";
import { MarketService } from "@/lib/market";
import { ReflectionEngine } from "@/lib/memory/reflectionEngine";
import { TradeLedger } from "@/lib/memory/tradeLedger";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const [userPortfolio, userTrades, aiPortfolio, aiTrades, logs] = await Promise.all([
            PortfolioManager.getPortfolio("user"),
            PortfolioManager.getTrades("user"),
            PortfolioManager.getPortfolio("ai"),
            PortfolioManager.getTrades("ai"),
            Logger.getLogs(),
        ]);

        const calculateTrueValue = async (portfolio: any) => {
            let totalValue = portfolio.usd;
            const activeAssets = Object.keys(portfolio.openPositions || {});
            const prices: Record<string, number> = {};
            for (const asset of activeAssets) {
                try {
                    const price = await MarketService.getCurrentPrice(asset);
                    prices[asset] = price;
                    const pos = portfolio.openPositions[asset];
                    if (pos) {
                        const isShort = pos.direction === 'SHORT';
                        if (isShort) {
                            const pnl = (pos.entryPrice - price) * pos.amount;
                            totalValue += pos.usdInvested + pnl;
                        } else {
                            totalValue += pos.amount * price;
                        }
                    }
                } catch (err) {
                    console.error(`Error getting current price for ${asset} during sync:`, err);
                    const pos = portfolio.openPositions[asset];
                    if (pos) {
                        totalValue += pos.usdInvested; // fallback
                    }
                }
            }
            return { totalValue, prices };
        };

        const [userSync, aiSync] = await Promise.all([
            calculateTrueValue(userPortfolio),
            calculateTrueValue(aiPortfolio)
        ]);

        // Fetch BTC price as a baseline indicator price for dashboard header compatibility
        let btcPrice = 0;
        try {
            btcPrice = userSync.prices["BTC"] || aiSync.prices["BTC"] || await MarketService.getCurrentPrice("BTC");
        } catch {
            btcPrice = 0;
        }

        const calculateProfitByAsset = (trades: any[], portfolio: any, prices: any) => {
            const profitByAsset: Record<string, { realized: number; unrealized: number; total: number }> = {};
            const SUPPORTED_ASSETS_KEYS = ["BTC", "ETH", "SOL", "EURUSD", "GBPUSD", "USDJPY", "GOLD", "OIL", "SILVER"];
            
            for (const asset of SUPPORTED_ASSETS_KEYS) {
                profitByAsset[asset] = { realized: 0, unrealized: 0, total: 0 };
            }

            // Realized profits
            for (const trade of trades) {
                if (trade.asset && trade.pnl !== undefined) {
                    if (!profitByAsset[trade.asset]) {
                        profitByAsset[trade.asset] = { realized: 0, unrealized: 0, total: 0 };
                    }
                    profitByAsset[trade.asset].realized += trade.pnl;
                }
            }

            // Unrealized profits
            const activeAssets = Object.keys(portfolio.openPositions || {});
            for (const asset of activeAssets) {
                const pos = portfolio.openPositions[asset];
                if (pos) {
                    const currentPrice = prices[asset] || pos.entryPrice;
                    const isShort = pos.direction === 'SHORT';
                    const unrealizedPnl = isShort
                        ? (pos.entryPrice - currentPrice) * pos.amount
                        : (pos.amount * currentPrice) - pos.usdInvested;
                    
                    if (!profitByAsset[asset]) {
                        profitByAsset[asset] = { realized: 0, unrealized: 0, total: 0 };
                    }
                    profitByAsset[asset].unrealized = unrealizedPnl;
                }
            }

            // Sum up totals
            for (const asset of Object.keys(profitByAsset)) {
                profitByAsset[asset].total = profitByAsset[asset].realized + profitByAsset[asset].unrealized;
            }

            return profitByAsset;
        };

        const userProfitByAsset = calculateProfitByAsset(userTrades, userPortfolio, userSync.prices);
        const aiProfitByAsset = calculateProfitByAsset(aiTrades, aiPortfolio, aiSync.prices);

        // Fetch AI Brain Intelligence Data (non-blocking, failures return nulls)
        let aiReflection = null;
        let aiRecentJournal: any[] = [];
        try {
            const [reflection, journal] = await Promise.all([
                ReflectionEngine.getLatestReflection(),
                TradeLedger.getRecentTrades(5),
            ]);
            aiReflection = reflection;
            aiRecentJournal = journal;
        } catch (e) {
            console.error("Error fetching AI intelligence data:", e);
        }

        return NextResponse.json({
            // User (Human) Data
            portfolio: userPortfolio, // Left here for legacy compatibility fallback
            userPortfolio,
            userTrades,
            userTotalValue: userSync.totalValue,
            userProfitByAsset,

            // AI Data
            aiPortfolio,
            aiTrades,
            aiTotalValue: aiSync.totalValue,
            aiProfitByAsset,

            // AI Brain Intelligence
            aiReflection,
            aiRecentJournal,

            // Shared
            btcPrice,
            totalValue: userSync.totalValue, // Left here for legacy compatibility fallback
            profitByAsset: userProfitByAsset, // Left here for legacy compatibility fallback
            logs
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
