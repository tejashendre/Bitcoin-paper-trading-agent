import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { Logger } from "@/lib/logger";
import { PerplexityService } from "@/lib/perplexity";
import { PriceService } from "@/lib/coingecko";
import { PortfolioManager } from "@/lib/portfolio";
import { TelegramService } from "@/lib/telegram";

export const dynamic = "force-dynamic"; // Ensure not cached
export const maxDuration = 60; // Allow 60s execution

export async function GET(request: Request) {
    // 1. Authorization Check (Vercel Cron)
    const authHeader = request.headers.get("authorization");
    if (process.env.NODE_ENV === "production" && authHeader !== `Bearer ${env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await Logger.info("🚀 Trading Run Started");

        // 2. Fetch Data (Parallel for speed)
        const [sentiment, price, portfolio] = await Promise.all([
            PerplexityService.analyzeSentiment(),
            PriceService.getBitcoinPrice(),
            PortfolioManager.getPortfolio(),
        ]);

        // 3. Decision Logic
        let action: "BUY" | "SELL" | "HOLD" = "HOLD";
        let tradeAmount = 0;

        // BUY Logic
        if (sentiment.sentiment === "BULLISH" && sentiment.score >= 7) {
            if (portfolio.usd > 100) { // Min $100 to buy
                action = "BUY";
                const investAmount = portfolio.usd * 0.98; // Use 98% of cash (safety margin)
                tradeAmount = investAmount / price;

                portfolio.usd -= investAmount;
                portfolio.btc += tradeAmount;
            } else {
                await Logger.warn("Signal is BULLISH, but insufficient USD to buy.");
            }
        }
        // SELL Logic
        else if (sentiment.sentiment === "BEARISH" && sentiment.score <= 4) {
            if (portfolio.btc > 0.0001) { // Min dust to sell
                action = "SELL";
                tradeAmount = portfolio.btc;
                const returnAmount = tradeAmount * price;

                portfolio.btc = 0;
                portfolio.usd += returnAmount;
            } else {
                await Logger.warn("Signal is BEARISH, but no BTC to sell.");
            }
        }

        // 4. Execute Trade & Update State
        if (action !== "HOLD") {
            await PortfolioManager.updatePortfolio(portfolio);
            await PortfolioManager.logTrade(action, tradeAmount, price, sentiment.reasoning);

            const totalValue = portfolio.usd + (portfolio.btc * price);
            await TelegramService.sendTradeAlert(action, tradeAmount, price, sentiment.reasoning, totalValue);
        } else {
            await Logger.info(`Decision: HOLD (Sentiment Score: ${sentiment.score})`);
        }

        await Logger.success("✅ Trading Run Completed Successfully");

        return NextResponse.json({
            success: true,
            action,
            sentiment: sentiment.sentiment,
            score: sentiment.score
        });

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await Logger.error("❌ Trading Run Crashed", { error: msg });

        // Attempt to notify admin via Telegram even on crash
        await TelegramService.sendAlert(`⚠️ *CRASH ALERT*\n\nBot failed to run: ${TelegramService.escapeMarkdown(msg)}`);

        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
}
