import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { Logger } from "@/lib/logger";
import { RiskManager } from "@/lib/riskManager";
import { MarketService, SUPPORTED_ASSETS } from "@/lib/market";
import { PortfolioManager as OriginalPortfolioManager } from "@/lib/portfolio";
import { TelegramService } from "@/lib/telegram";
import { getEnv } from "@/lib/env";
import { Trade, OpenPosition } from "@/lib/types";

// Autonomous Architecture Imports
import { buildMarketFrame, isDataSafeForTrading } from "@/lib/data/freeDataMesh";
import { buildWorldModel } from "@/lib/ai/marketWorldModel";
import { AutonomousBrain } from "@/lib/ai/autonomousBrain";
import { PaperExchange } from "@/lib/execution/paperExchange";
import { ReflectionEngine } from "@/lib/memory/reflectionEngine";
import { TradeLedger } from "@/lib/memory/tradeLedger";
import { PositionManager } from "@/lib/ai/positionManager";

// Proxy PortfolioManager calls to the 'ai' portfolio context for the competition
const PortfolioManager = {
  getPortfolio: () => OriginalPortfolioManager.getPortfolio("ai"),
  updatePortfolio: (p: any) => OriginalPortfolioManager.updatePortfolio(p, "ai"),
  logTrade: (t: any) => OriginalPortfolioManager.logTrade(t, "ai"),
  saveSignal: (s: any) => OriginalPortfolioManager.saveSignal(s, "ai"),
  getTrades: () => OriginalPortfolioManager.getTrades("ai"),
  resetPortfolio: () => OriginalPortfolioManager.resetPortfolio("ai"),
  getRecentSignals: () => OriginalPortfolioManager.getRecentSignals("ai"),
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleTrade(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const targetAsset = searchParams.get("asset") || "BTC";

  if (targetAsset !== "all" && !SUPPORTED_ASSETS[targetAsset]) {
    return NextResponse.json({ error: `Asset ${targetAsset} is not supported` }, { status: 400 });
  }

  try {
    await Logger.info(`Trading Run Started for ${targetAsset} (${auth.source})`);
    const env = getEnv();
    const portfolio = await PortfolioManager.getPortfolio();

    // -----------------------------------------------------------------
    // Step 1: Institutional Stop Loss / Take Profit Sweeper
    // Iterate over all active positions and exit if levels are breached
    // -----------------------------------------------------------------
    const activeAssets = Object.keys(portfolio.openPositions || {});
    for (const assetKey of activeAssets) {
      const pos = portfolio.openPositions[assetKey];
      if (!pos) continue;

      try {
        const currentLivePrice = await MarketService.getCurrentPrice(assetKey);
        
        // ── AI Position Manager: Dynamic SL/TP Management ─────────────
        // Builds a quick world model for the asset and lets the AI
        // Position Manager decide whether to adjust stops.
        try {
          const posFrame = await buildMarketFrame(assetKey, "1h", 200, true);
          if (posFrame) {
            const posWorldModel = buildWorldModel(posFrame);
            const mgmt = PositionManager.evaluatePosition(pos, currentLivePrice, posWorldModel);
            
            if (mgmt.action !== 'NO_CHANGE') {
              // Apply the updated stop loss from Position Manager
              portfolio.openPositions[assetKey] = mgmt.updatedPosition;
              await PortfolioManager.updatePortfolio(portfolio);
              await Logger.info(`POSITION_MGR [${assetKey}]: ${mgmt.action} — ${mgmt.message}`);
            }
          }
        } catch (pmErr) {
          // Position management is non-critical — log and continue to SL/TP sweep
          console.error(`[PositionManager] Error managing ${assetKey}:`, pmErr);
        }

        const sltp = RiskManager.checkStopLossOrTakeProfit(pos, currentLivePrice);

        if (sltp.triggered) {
          const isShort = pos.direction === 'SHORT';
          const pnl = isShort 
            ? (pos.entryPrice - sltp.exitPrice) * pos.amount
            : (pos.amount * sltp.exitPrice) - pos.usdInvested;
          const proceeds = isShort ? pos.usdInvested + pnl : pos.amount * sltp.exitPrice;
          const pnlPercent = (pnl / pos.usdInvested) * 100;

          // Update balances
          portfolio.usd += isShort ? (pos.usdInvested + pnl) : proceeds;
          if (portfolio.balances && !isShort) {
            portfolio.balances[assetKey] = Math.max(0, (portfolio.balances[assetKey] || 0) - pos.amount);
          }
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

          // Clean legacy and multi-asset position slot
          delete portfolio.openPositions[assetKey];
          if (assetKey === "BTC") portfolio.openPosition = null;

          const closeTrade: Trade = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            asset: assetKey,
            action: isShort ? "COVER" : "SELL",
            direction: isShort ? 'SHORT' : 'LONG',
            amount: pos.amount,
            btcAmount: pos.amount,
            price: sltp.exitPrice,
            usdValue: proceeds,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            signalScore: pos.signalScore,
            reasoning: `Position closed: ${sltp.reason}`,
            pnl,
            pnlPercent,
            exitPrice: sltp.exitPrice,
            exitTime: new Date().toISOString(),
            exitReason: sltp.reason!
          };

          await PortfolioManager.updatePortfolio(portfolio);
          await PortfolioManager.logTrade(closeTrade);
          
          await Logger.info(`TRADE [${assetKey}] EXIT (${isShort ? 'SHORT' : 'LONG'}): ${sltp.reason} PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`);
          await TelegramService.sendTradeAlert(isShort ? "COVER" : "SELL", pos.amount, sltp.exitPrice, `${sltp.reason} | PnL: $${pnl.toFixed(2)}`, portfolio.usd, pos.signalScore, undefined, undefined, assetKey);
        }
      } catch (assetErr) {
        console.error(`Error sweeping levels for active asset ${assetKey}:`, assetErr);
      }
    }

    // -----------------------------------------------------------------
    // Step 2: Signal Generation & Strategy Evaluation
    // Loop through each target asset to analyze signals and execute trades
    // -----------------------------------------------------------------
    const assetsToScan = targetAsset === "all" ? Object.keys(SUPPORTED_ASSETS) : [targetAsset];
    const scanResults = [];

    // Fetch recent lessons from ReflectionEngine for the AI Brain
    const recentReflection = await ReflectionEngine.getLatestReflection();
    const lessons = recentReflection ? [recentReflection.actionableRule] : [];

    for (const asset of assetsToScan) {
      try {
        const config = SUPPORTED_ASSETS[asset];
        const day = new Date().getDay();
        const isWeekend = (day === 6 || day === 0); // 6 = Saturday, 0 = Sunday
        const isMarketClosed = isWeekend && config.category !== 'crypto';

        if (isMarketClosed) {
          scanResults.push({ asset, action: "HOLD", reason: "Market Closed (Weekend)" });
          continue;
        }

        // -----------------------------------------------------------------
        // Phase 1: Data Mesh & Market World Model
        // -----------------------------------------------------------------
        const frame = await buildMarketFrame(asset, "1h", 200, true);
        if (!frame) {
          await Logger.warn(`Could not build market frame for ${asset}`);
          scanResults.push({ asset, action: "ERROR", error: "Missing frame" });
          continue;
        }

        if (!isDataSafeForTrading(frame)) {
          await Logger.warn(`Data for ${asset} is unsafe for trading. Skipping.`);
          scanResults.push({ asset, action: "HOLD", reason: "Data unsafe" });
          continue;
        }

        const worldModel = buildWorldModel(frame);
        
        // Calculate current net liquid portfolio value dynamically
        let totalLiquidsValue = portfolio.usd;
        for (const key of Object.keys(portfolio.openPositions || {})) {
          const openPos = portfolio.openPositions[key];
          if (openPos) {
            try {
              const livePrice = await MarketService.getCurrentPrice(key);
              const isShort = openPos.direction === 'SHORT';
              if (isShort) {
                const pnl = (openPos.entryPrice - livePrice) * openPos.amount;
                totalLiquidsValue += openPos.usdInvested + pnl;
              } else {
                totalLiquidsValue += openPos.amount * livePrice;
              }
            } catch {
              totalLiquidsValue += openPos.usdInvested; // fallback
            }
          }
        }
        portfolio.peakValue = Math.max(portfolio.peakValue, totalLiquidsValue);
        const dd = (portfolio.peakValue - totalLiquidsValue) / portfolio.peakValue;
        portfolio.maxDrawdown = Math.max(portfolio.maxDrawdown, portfolio.peakValue - totalLiquidsValue);
        portfolio.maxDrawdownPercent = Math.max(portfolio.maxDrawdownPercent, dd * 100);

        // -----------------------------------------------------------------
        // Phase 2: Autonomous Brain & Risk Governor
        // -----------------------------------------------------------------
        const finalDecision = await AutonomousBrain.evaluateMarket(
          worldModel,
          portfolio,
          Object.values(portfolio.openPositions || {}),
          lessons
        );

        // Spacing delay to avoid Gemini API 429 Rate Limit (15 RPM)
        await new Promise(resolve => setTimeout(resolve, 4500));

        // -----------------------------------------------------------------
        // Phase 3: Realistic Paper Exchange Execution
        // -----------------------------------------------------------------
        const executionResult = await PaperExchange.executeDecision(finalDecision, worldModel, portfolio);

        if (!executionResult.success || finalDecision.action === 'HOLD') {
           await Logger.info(`HOLD [${asset}] | ${executionResult.message}`);
           scanResults.push({ asset, action: "HOLD", reason: executionResult.message });
           continue;
        }

        // -----------------------------------------------------------------
        // Phase 4: State Update & Ledger Memory
        // -----------------------------------------------------------------
        if (executionResult.trade) {
           await PortfolioManager.updatePortfolio(executionResult.updatedPortfolio);
           await PortfolioManager.logTrade(executionResult.trade);
           
           // Record in Ledger for future reflection only on exits
           if (executionResult.trade.action === 'SELL' || executionResult.trade.action === 'COVER') {
             await TradeLedger.recordTrade({
               tradeId: executionResult.trade.id,
               asset,
               entryTime: executionResult.trade.entryTime || new Date().toISOString(),
               exitTime: executionResult.trade.exitTime || new Date().toISOString(),
               regimeAtEntry: worldModel.regime,
               aiThesis: finalDecision.thesis,
               predictedDirection: executionResult.trade.direction || 'LONG',
               actualPnlUsd: executionResult.trade.pnl || 0,
               actualPnlPercent: executionResult.trade.pnlPercent || 0,
               wasPredictionCorrect: executionResult.trade.pnl !== undefined ? executionResult.trade.pnl > 0 : true,
               mistakesMade: [],
               lessonsLearned: []
             });
           }
           
           await Logger.info(`TRADE [${asset}] ${finalDecision.action} | ${executionResult.message}`);
           await TelegramService.sendTradeAlert(
             finalDecision.action,
             executionResult.trade.amount,
             executionResult.trade.price,
             finalDecision.thesis,
             portfolio.usd,
             finalDecision.confidence,
             executionResult.trade.stopLoss,
             executionResult.trade.takeProfit,
             asset
           );
           
           scanResults.push({ asset, action: finalDecision.action, trade: executionResult.trade });
        }

      } catch (assetError) {
        const msg = assetError instanceof Error ? assetError.message : String(assetError);
        await Logger.error(`Trading Run Crashed on ${asset}`, { error: msg });
        scanResults.push({ asset, action: "ERROR", error: msg });
      }
    }

    return NextResponse.json({
      success: true,
      action: targetAsset === "all" ? "MULTIPLE_SCAN" : scanResults[0]?.action || "HOLD",
      results: scanResults
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await Logger.error(`Trading Run Crashed on ${targetAsset}`, { error: msg });
    try { await TelegramService.sendAlert(`*CRASH [${targetAsset}]*: ${TelegramService.escapeMarkdown(msg)}`); } catch {}
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) { return handleTrade(request); }
export async function POST(request: Request) { return handleTrade(request); }
