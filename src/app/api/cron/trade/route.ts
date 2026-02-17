import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { Logger } from "@/lib/logger";
import { PerplexityService } from "@/lib/perplexity";
import { PriceService } from "@/lib/coingecko";
import { PortfolioManager } from "@/lib/portfolio";
import { TelegramService } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
    // 1. Authorization Check
    const authHeader = request.headers.get("authorization");
    const url = new URL(request.url);
    const manualTrigger = url.searchParams.get("manual") === "true";

    // Allow manual trigger without CRON_SECRET, but block external cron calls in production
    if (!manualTrigger && process.env.NODE_ENV === "production") {
        const env = getEnv();
        if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    try {
        await Logger.info("🚀 Trading Run Started" + (manualTrigger ? " (Manual)" : " (Cron)"));

        // 2. Fetch Data in Parallel
        const [sentiment, price, portfolio] = await Promise.all([
            PerplexityService.analyzeSentiment(),
            PriceService.getBitcoinPrice(),
            PortfolioManager.getPortfolio(),
        ]);

        await Logger.info(`BTC Price: $${price.toLocaleString("en-US")}`);

        // 3. Decision Logic
        let action: "BUY" | "SELL" | "HOLD" = "HOLD";
        let tradeAmount = 0;

        if (sentiment.sentiment === "BULLISH" && sentiment.score >= 7) {
            if (portfolio.usd > 100) {
                action = "BUY";
                const investAmount = portfolio.usd * 0.98; // 2% safety margin
                tradeAmount = investAmount / price;

                portfolio.usd -= investAmount;
                portfolio.btc += tradeAmount;
            } else {
                await Logger.warn("Signal is BULLISH, but insufficient USD to buy.");
            }
        } else if (sentiment.sentiment === "BEARISH" && sentiment.score <= 4) {
            if (portfolio.btc > 0.0001) {
                action = "SELL";
                tradeAmount = portfolio.btc;
                const returnAmount = tradeAmount * price;

                portfolio.btc = 0;
                portfolio.usd += returnAmount;
            } else {
                await Logger.warn("Signal is BEARISH, but no BTC to sell.");
            }
        }

        // 4. Execute Trade
        if (action !== "HOLD") {
            await PortfolioManager.updatePortfolio(portfolio);
            await PortfolioManager.logTrade(action, tradeAmount, price, sentiment.reasoning);

            const totalValue = portfolio.usd + portfolio.btc * price;
            await TelegramService.sendTradeAlert(action, tradeAmount, price, sentiment.reasoning, totalValue);
        } else {
            await Logger.info(`Decision: HOLD (Score: ${sentiment.score}/10, ${sentiment.reasoning})`);
        }

        await Logger.success("✅ Trading Run Completed Successfully");

        return NextResponse.json({
            success: true,
            action,
            sentiment: sentiment.sentiment,
            score: sentiment.score,
            price,
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await Logger.error("❌ Trading Run Crashed", { error: msg });

        // Try to notify via Telegram even on crash
        try {
            await TelegramService.sendAlert(
                `⚠️ *CRASH ALERT*\n\nBot failed: ${TelegramService.escapeMarkdown(msg)}`
            );
        } catch {
            // If even Telegram fails, just continue
        }

        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
}
