import { getMarketAnalysis } from "@/lib/perplexity";
import { getRedis } from "@/lib/redis";
import { sendTradeAlert } from "@/lib/telegram";
import { type NextRequest, NextResponse } from "next/server";

/* ── Vercel config ────────────────────────────────────────── */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ── Constants ────────────────────────────────────────────── */
const PORTFOLIO_USD_KEY = "portfolio:usd";
const PORTFOLIO_BTC_KEY = "portfolio:btc";
const TRADE_HISTORY_KEY = "trade:history";

// Initial state
const INITIAL_USD = 10_000;
const INITIAL_BTC = 0;

// Trading parameters
const MIN_USD_TO_BUY = 100;
const MIN_BTC_TO_SELL = 0.001;
const BUY_SENTIMENT_THRESHOLD = 70;
const SELL_SENTIMENT_THRESHOLD = 30;
const BUY_CASH_FRACTION = 0.5;
const MAX_TRADE_HISTORY = 100;

/* ── Helpers ──────────────────────────────────────────────── */

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/trade] CRON_SECRET not configured");
    return false;
  }
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function getPortfolio(): Promise<{ usd: number; btc: number }> {
  const r = getRedis();
  const [usdRaw, btcRaw] = await Promise.all([
    r.get(PORTFOLIO_USD_KEY),
    r.get(PORTFOLIO_BTC_KEY),
  ]);

  const usd = usdRaw == null ? null : Number(usdRaw);
  const btc = btcRaw == null ? null : Number(btcRaw);

  // Initialize portfolio on first run
  if (usd === null || btc === null) {
    const initialUsd = usd !== null ? usd : INITIAL_USD;
    const initialBtc = btc !== null ? btc : INITIAL_BTC;

    await Promise.all([
      r.set(PORTFOLIO_USD_KEY, initialUsd),
      r.set(PORTFOLIO_BTC_KEY, initialBtc),
    ]);
    console.log(`[cron/trade] Portfolio initialized: $${initialUsd} USD, ${initialBtc} BTC`);
    return { usd: initialUsd, btc: initialBtc };
  }

  return {
    usd: Number.isFinite(usd) ? usd : INITIAL_USD,
    btc: Number.isFinite(btc) ? btc : INITIAL_BTC,
  };
}

async function logTrade(trade: {
  action: "BUY" | "SELL";
  price: number;
  sentiment: number;
  reason: string;
  btcAmount: number;
  usdAmount: number;
  newUsd: number;
  newBtc: number;
}): Promise<void> {
  const r = getRedis();
  const entry = {
    ...trade,
    timestamp: new Date().toISOString(),
  };
  await r.lpush(TRADE_HISTORY_KEY, JSON.stringify(entry));
  await r.ltrim(TRADE_HISTORY_KEY, 0, MAX_TRADE_HISTORY - 1);
}

/* ── Main handler ─────────────────────────────────────────── */

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Authorization Check
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[cron/trade] Starting autonomous trading cycle…");

    // 2. Get portfolio state
    const portfolio = await getPortfolio();
    console.log(
      `[cron/trade] Portfolio: USD=$${portfolio.usd.toFixed(2)}, BTC=${portfolio.btc.toFixed(6)}`
    );

    // 3. Fetch market analysis from Perplexity
    let analysis: Awaited<ReturnType<typeof getMarketAnalysis>>;
    try {
      analysis = await getMarketAnalysis();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cron/trade] Market analysis failed:", msg);
      return NextResponse.json(
        { success: false, error: "Market analysis failed: " + msg },
        { status: 500 }
      );
    }

    const { price, sentiment, reason } = analysis;
    console.log(
      `[cron/trade] Analysis: Price=$${price.toFixed(2)}, Sentiment=${sentiment}/100`
    );

    // 4. Make trading decision
    let action: "BUY" | "SELL" | "HOLD" = "HOLD";
    let newUsd = portfolio.usd;
    let newBtc = portfolio.btc;
    let btcAmount = 0;
    let usdAmount = 0;

    // BUY Logic: High sentiment + sufficient cash
    if (sentiment >= BUY_SENTIMENT_THRESHOLD && portfolio.usd >= MIN_USD_TO_BUY) {
      usdAmount = portfolio.usd * BUY_CASH_FRACTION;
      btcAmount = usdAmount / price;
      newUsd = portfolio.usd - usdAmount;
      newBtc = portfolio.btc + btcAmount;
      action = "BUY";
    }
    // SELL Logic: Low sentiment + sufficient BTC
    else if (
      sentiment <= SELL_SENTIMENT_THRESHOLD &&
      portfolio.btc >= MIN_BTC_TO_SELL
    ) {
      btcAmount = portfolio.btc;
      usdAmount = portfolio.btc * price;
      newUsd = portfolio.usd + usdAmount;
      newBtc = 0;
      action = "SELL";
    }

    console.log(`[cron/trade] Decision: ${action}`);

    // 5. Execute trade if needed
    if (action !== "HOLD") {
      const r = getRedis();
      await Promise.all([
        r.set(PORTFOLIO_USD_KEY, newUsd),
        r.set(PORTFOLIO_BTC_KEY, newBtc),
      ]);

      // Log trade to Redis history
      await logTrade({
        action,
        price,
        sentiment,
        reason,
        btcAmount,
        usdAmount,
        newUsd,
        newBtc,
      });

      // Send Telegram notification
      // Note: We await this to ensure it's sent, but catch errors so we don't fail the request if Telegram is down
      try {
        await sendTradeAlert({
          action,
          price,
          sentiment,
          reason,
          btcAmount,
          newUsd,
          newBtc,
        });
        console.log(`[cron/trade] Telegram alert sent for ${action}`);
      } catch (err) {
        console.error("[cron/trade] Failed to send Telegram alert:", err);
      }

      console.log(`[cron/trade] ${action} executed successfully`);
    }

    // 6. Return result
    const data = {
      success: true,
      timestamp: new Date().toISOString(),
      action,
      analysis: { price, sentiment, reason },
      portfolio: {
        before: portfolio,
        after: { usd: newUsd, btc: newBtc }
      },
      tradeDetails: action !== "HOLD" ? { btcAmount, usdAmount } : null,
    };

    console.log("[cron/trade] Cycle completed successfully.");
    return NextResponse.json(data);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/trade] Unexpected error:", msg);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
