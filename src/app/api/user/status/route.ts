import { NextResponse } from "next/server";
import { PortfolioManager } from "@/lib/portfolio";
import { Logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const [portfolio, trades, logs] = await Promise.all([
            PortfolioManager.getPortfolio(),
            PortfolioManager.getTrades(),
            Logger.getLogs(),
        ]);

        return NextResponse.json({
            portfolio,
            trades,
            logs,
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
