import { NextResponse } from "next/server";
import { PortfolioManager } from "@/lib/portfolio";
import { Logger } from "@/lib/logger";
import { PriceService } from "@/lib/coingecko";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const [portfolio, trades, logs] = await Promise.all([
            PortfolioManager.getPortfolio(),
            PortfolioManager.getTrades(),
            Logger.getLogs(),
        ]);

        // Fetch live BTC price for accurate portfolio valuation
        let btcPrice = 0;
        try {
            btcPrice = await PriceService.getBitcoinPrice();
        } catch {
            btcPrice = 0; // Will show "N/A" on dashboard
        }

        const totalValue = portfolio.usd + portfolio.btc * btcPrice;

        return NextResponse.json({
            portfolio,
            trades,
            logs,
            btcPrice,
            totalValue,
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
