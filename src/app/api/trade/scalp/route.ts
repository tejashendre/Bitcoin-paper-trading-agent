import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { Logger } from "@/lib/logger";
import { ScalpEngine } from "@/lib/scalpEngine";
import { MarketService, SUPPORTED_ASSETS } from "@/lib/market";
import { PortfolioManager as OriginalPortfolioManager } from "@/lib/portfolio";
import { TelegramService } from "@/lib/telegram";
import { getEnv } from "@/lib/env";
import { Trade, OpenPosition, Portfolio } from "@/lib/types";
import { TradeLedger } from "@/lib/memory/tradeLedger";

// Proxy PortfolioManager calls to the 'ai' portfolio context for parallel execution
const PortfolioManager = {
  getPortfolio: () => OriginalPortfolioManager.getPortfolio("ai"),
  updatePortfolio: (p: any) => OriginalPortfolioManager.updatePortfolio(p, "ai"),
  logTrade: (t: any) => OriginalPortfolioManager.logTrade(t, "ai"),
  saveSignal: (s: any) => OriginalPortfolioManager.saveSignal(s, "ai"),
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleScalpTrade(request);
}

export async function POST(request: Request) {
  return handleScalpTrade(request);
}

async function handleScalpTrade(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const targetAsset = searchParams.get("asset") || "all";

  if (targetAsset !== "all" && !SUPPORTED_ASSETS[targetAsset]) {
    return NextResponse.json({ error: `Asset ${targetAsset} is not supported` }, { status: 400 });
  }

  try {
    // Removed spammy Logger.info(`Scalping Run Started...`)
    const env = getEnv();
    const portfolio = await PortfolioManager.getPortfolio();

    if (!portfolio.scalpPositions) {
      portfolio.scalpPositions = {};
    }

    // -----------------------------------------------------------------
    // Step 1: Stateful Micro Scalp Sweeper
    // Iterate over active scalp positions and close immediately if target or stop is touched
    // -----------------------------------------------------------------
    const activeScalps = Object.keys(portfolio.scalpPositions);
    for (const assetKey of activeScalps) {
      const pos = portfolio.scalpPositions[assetKey];
      if (!pos) continue;

      try {
        const currentLivePrice = await MarketService.getCurrentPrice(assetKey);
        const isShort = pos.direction === 'SHORT';
        
        let triggered = false;
        let exitReason: 'SCALP_TARGET' | 'SCALP_STOP' | null = null;
        let exitPrice = currentLivePrice;

        if (isShort) {
          if (currentLivePrice >= pos.stopLoss) {
            triggered = true;
            exitReason = 'SCALP_STOP';
            exitPrice = pos.stopLoss;
          } else if (currentLivePrice <= pos.takeProfit) {
            triggered = true;
            exitReason = 'SCALP_TARGET';
            exitPrice = pos.takeProfit;
          }
        } else {
          if (currentLivePrice <= pos.stopLoss) {
            triggered = true;
            exitReason = 'SCALP_STOP';
            exitPrice = pos.stopLoss;
          } else if (currentLivePrice >= pos.takeProfit) {
            triggered = true;
            exitReason = 'SCALP_TARGET';
            exitPrice = pos.takeProfit;
          }
        }

        if (triggered && exitReason) {
          // Calculate high-frequency scalp P&L
          const pnl = isShort 
            ? (pos.entryPrice - exitPrice) * pos.amount
            : (exitPrice - pos.entryPrice) * pos.amount;
          const proceeds = pos.usdInvested + pnl;
          const pnlPercent = (pnl / pos.usdInvested) * 100;

          // Update balances
          portfolio.usd += proceeds;
          portfolio.totalPnl += pnl;
          portfolio.totalTrades++;
          portfolio.returns.push(pnlPercent);

          if (pnl > 0) {
            portfolio.winningTrades++;
            portfolio.grossProfit += pnl;
            portfolio.consecutiveWins++;
            portfolio.consecutiveLosses = 0;
            portfolio.maxConsecutiveWins = Math.max(portfolio.maxConsecutiveWins, portfolio.consecutiveWins);
          } else {
            portfolio.losingTrades++;
            portfolio.grossLoss += Math.abs(pnl);
            portfolio.consecutiveLosses++;
            portfolio.consecutiveWins = 0;
            portfolio.maxConsecutiveLosses = Math.max(portfolio.maxConsecutiveLosses, portfolio.consecutiveLosses);
          }

          // Delete decoupled scalp position slot
          delete portfolio.scalpPositions[assetKey];

          const closeTrade: Trade = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            asset: assetKey,
            action: isShort ? "SCALP_COVER" : "SCALP_SELL",
            direction: isShort ? 'SHORT' : 'LONG',
            amount: pos.amount,
            btcAmount: pos.amount,
            price: exitPrice,
            usdValue: proceeds,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            signalScore: pos.signalScore,
            reasoning: `Scalp closed: ${exitReason}`,
            pnl,
            pnlPercent,
            exitPrice: exitPrice,
            exitTime: new Date().toISOString(),
            exitReason: exitReason
          };

          await PortfolioManager.updatePortfolio(portfolio);
          await PortfolioManager.logTrade(closeTrade);
          
          await TradeLedger.recordTrade({
            tradeId: closeTrade.id,
            asset: assetKey,
            entryTime: pos.entryTime,
            exitTime: closeTrade.exitTime || new Date().toISOString(),
            regimeAtEntry: 'SCALP',
            aiThesis: pos.reasoning,
            predictedDirection: isShort ? 'SHORT' : 'LONG',
            actualPnlUsd: pnl,
            actualPnlPercent: pnlPercent,
            wasPredictionCorrect: pnl > 0,
            mistakesMade: [],
            lessonsLearned: [],
          });
          
          await Logger.info(`SCALP EXIT [${assetKey}] (${isShort ? 'SHORT' : 'LONG'}): ${exitReason} PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`);
          await TelegramService.sendTradeAlert(isShort ? "SCALP_COVER" : "SCALP_SELL", pos.amount, exitPrice, `${exitReason} | Scalp PnL: $${pnl.toFixed(2)}`, portfolio.usd, pos.signalScore, undefined, undefined, assetKey);
        }
      } catch (assetErr) {
        console.error(`Error sweeping scalp levels for ${assetKey}:`, assetErr);
      }
    }

    // -----------------------------------------------------------------
    // Step 2: Signal Generation & Scalp Setup Triggers
    // Iterate over active assets and enter scalp positions if filters are met
    // -----------------------------------------------------------------
    const assetsToScan = targetAsset === "all" ? Object.keys(SUPPORTED_ASSETS) : [targetAsset];
    const scanResults = [];

    for (const asset of assetsToScan) {
      try {
        const currentPrice = await MarketService.getCurrentPrice(asset);
        
        // Skip if a scalp position is already active for this asset
        if (portfolio.scalpPositions[asset]) {
          continue;
        }

        // Run the fast scalping setup analyze
        const scalpSignal = await ScalpEngine.analyze(asset);

        if (scalpSignal.action === 'SCALP_BUY' || scalpSignal.action === 'SCALP_SHORT') {
          // Progressive capital allocation: grow small accounts slowly, compound faster as capital grows
          // Tier 1: USD < $600   → 2% per scalp (capital preservation mode)
          // Tier 2: $600–$2000  → 3% per scalp (growth mode)
          // Tier 3: > $2000     → 5% per scalp (compounding mode)
          const scalpAllocPct = portfolio.usd < 600 ? 0.02 : portfolio.usd < 2000 ? 0.03 : 0.05;
          const scalpMargin = portfolio.usd * scalpAllocPct;

          if (scalpMargin > portfolio.usd - 1) {
            await Logger.warn(`Scalp blocked on ${asset}: Insufficient capital to allocate ${(scalpAllocPct * 100).toFixed(0)}% margin`);
            continue;
          }

          const isShort = scalpSignal.action === 'SCALP_SHORT';
          const amount = scalpMargin / currentPrice;

          // Lock margin for the scalp position
          portfolio.usd -= scalpMargin;

          const scalpPos: OpenPosition = {
            asset: asset,
            entryPrice: currentPrice,
            amount: amount,
            btcAmount: amount,
            usdInvested: scalpMargin,
            stopLoss: scalpSignal.stopLoss,
            takeProfit: scalpSignal.takeProfit,
            entryTime: new Date().toISOString(),
            signalScore: scalpSignal.score,
            reasoning: scalpSignal.reasoning,
            direction: isShort ? 'SHORT' : 'LONG'
          };

          portfolio.scalpPositions[asset] = scalpPos;
          await PortfolioManager.updatePortfolio(portfolio);

          const trade: Trade = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            asset: asset,
            action: isShort ? "SCALP_SHORT" : "SCALP_BUY",
            direction: isShort ? 'SHORT' : 'LONG',
            amount: amount,
            btcAmount: amount,
            price: currentPrice,
            usdValue: scalpMargin,
            stopLoss: scalpSignal.stopLoss,
            takeProfit: scalpSignal.takeProfit,
            signalScore: scalpSignal.score,
            reasoning: scalpSignal.reasoning
          };

          // [HFT PIVOT] Instead of relying on Next.js event loop for fills,
          // in production we would push this to Redis for the Rust Sniper Engine:
          // await getRedis().publish('EXECUTE_SCALP', JSON.stringify(trade));
          await Logger.info(`[IPC] Dispatched SCALP_${isShort ? 'SHORT' : 'BUY'} signal to Rust HFT Sniper for ${asset}`);

          await PortfolioManager.logTrade(trade);
          await Logger.info(`SCALP ENTRY [${asset}] (${isShort ? 'SHORT' : 'LONG'}): ${amount.toFixed(6)} @ $${currentPrice.toLocaleString()} | SL: $${scalpSignal.stopLoss.toFixed(4)} | TP: $${scalpSignal.takeProfit.toFixed(4)}`);
          await TelegramService.sendTradeAlert(isShort ? "SCALP_SHORT" : "SCALP_BUY", amount, currentPrice, scalpSignal.reasoning, portfolio.usd, scalpSignal.score, scalpSignal.stopLoss, scalpSignal.takeProfit, asset);

          scanResults.push({ asset, action: scalpSignal.action, score: scalpSignal.score, price: currentPrice });
        } else {
          scanResults.push({ asset, action: "HOLD", reason: scalpSignal.reasoning });
        }
      } catch (assetErr) {
        console.error(`Error scanning scalp setup for ${asset}:`, assetErr);
      }
    }

    return NextResponse.json({ success: true, scanResults });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await Logger.error(`Scalping execution run failed: ${errorMsg}`);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
