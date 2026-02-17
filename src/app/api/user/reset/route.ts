import { NextResponse } from "next/server";
import { PortfolioManager } from "@/lib/portfolio";
import { Logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST() {
    try {
        await PortfolioManager.resetPortfolio();
        await Logger.info("User manually reset the portfolio.");
        return NextResponse.json({ success: true, message: "Portfolio reset to $10,000" });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
