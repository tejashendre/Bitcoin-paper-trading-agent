// ================================================================
// Autonomous Agent Cycle Route — The AI's Independent Heartbeat
//
// This is the dedicated cron-driven endpoint that runs the full
// autonomous trading lifecycle, independent of the dashboard.
//
// Flow:
//   1. Authenticate (Bearer token from DASHBOARD_SECRET / CRON_SECRET)
//   2. Acquire Redis lock (prevent concurrent cycles)
//   3. Load portfolio
//   4. Run Reflection Engine (learn from past mistakes)
//   5. Sweep all open positions (Position Manager + SL/TP exits)
//   6. Scan all assets: Data Mesh → World Model → Brain → Execute
//   7. Journal decisions for memory
//   8. Release lock, return AutonomyCycleReport
// ================================================================

import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { Logger } from "@/lib/logger";
import { RiskManager } from "@/lib/riskManager";
import { MarketService, SUPPORTED_ASSETS } from "@/lib/market";
import { PortfolioManager as OriginalPortfolioManager } from "@/lib/portfolio";
import { TelegramService } from "@/lib/telegram";
import { Trade, OpenPosition } from "@/lib/types";

// Autonomous Architecture
import { buildMarketFrame, isDataSafeForTrading } from "@/lib/data/freeDataMesh";
import { buildWorldModel } from "@/lib/ai/marketWorldModel";
import { AutonomousBrain } from "@/lib/ai/autonomousBrain";
import { MarketWorldModel } from "@/lib/types";
import { NewsSentimentEngine, NewsCatalystReport } from "@/lib/data/newsSentiment";
import { PaperExchange } from "@/lib/execution/paperExchange";
import { ReflectionEngine } from "@/lib/memory/reflectionEngine";
import { TradeLedger } from "@/lib/memory/tradeLedger";
import { PositionManager } from "@/lib/ai/positionManager";
import { getRedis } from "@/lib/redis";
import { ScalpEngine } from "@/lib/scalpEngine";
import { resolvePendingPredictions } from "@/lib/ai/predictionLedger";

// Use the AI portfolio context
const PortfolioManager = {
  getPortfolio: () => OriginalPortfolioManager.getPortfolio("ai"),
  updatePortfolio: (p: any) => OriginalPortfolioManager.updatePortfolio(p, "ai"),
  logTrade: (t: any) => OriginalPortfolioManager.logTrade(t, "ai"),
  getTrades: () => OriginalPortfolioManager.getTrades("ai"),
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CYCLE_LOCK_KEY = "agent:cycle:lock";
const CYCLE_LOCK_TTL = 55; // seconds — slightly less than maxDuration

async function handleCycle(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const cycleStart = Date.now();
  const redis = getRedis();

  // ── Distributed Lock: Prevent concurrent cycles ──────────────
  const lockAcquired = await redis.set(CYCLE_LOCK_KEY, "1", { ex: CYCLE_LOCK_TTL, nx: true });
  if (!lockAcquired) {
    return NextResponse.json({
      success: false,
      error: "Another autonomous cycle is currently in flight. Skipping.",
    }, { status: 409 });
  }

  try {
    await Logger.info("🧠 Autonomous Agent Cycle Started");

    const portfolio = await PortfolioManager.getPortfolio();
    const cycleReport: CycleReport = {
      success: true,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      reflectionRan: false,
      positionsSwept: 0,
      positionsManaged: [],
      assetsScanned: [],
      tradesExecuted: [],
      decisionsLogged: [],
      warnings: [],
    };

    // ══════════════════════════════════════════════════════════════
    // Phase 1: Reflection — Learn from recent failures
    // ══════════════════════════════════════════════════════════════
    try {
      const reflection = await ReflectionEngine.runReflectionCycle();
      if (reflection) {
        cycleReport.reflectionRan = true;
        await Logger.info(`🔄 Reflection: "${reflection.actionableRule}" (WR: ${(reflection.winRate * 100).toFixed(0)}%)`);
      }
    } catch (refErr) {
      console.error("[AgentCycle] Reflection failed:", refErr);
      cycleReport.warnings.push("Reflection engine failed — proceeding without fresh lessons.");
    }

    // Load lessons for the brain
    const recentReflection = await ReflectionEngine.getLatestReflection();
    const lessons = recentReflection ? [recentReflection.actionableRule] : [];

    // Resolve predictions
    try {
      await resolvePendingPredictions();
    } catch (err) {
      console.error("[AgentCycle] Failed to resolve predictions:", err);
    }

    // ── Catalyst AI News Engine ──────────────────────────────────
    let newsCatalyst: NewsCatalystReport | undefined;
    try {
      newsCatalyst = await NewsSentimentEngine.getMacroSentiment();
      if (newsCatalyst.sentiment === 'PANIC') {
        await Logger.warn(`🚨 MACRO PANIC DETECTED: ${newsCatalyst.reasoning} — Risk limits tightening!`);
        cycleReport.warnings.push(`MACRO PANIC: ${newsCatalyst.reasoning}`);
      }
    } catch (e) {
      console.error("[AgentCycle] Failed to fetch Macro News Sentiment:", e);
    }

    // ══════════════════════════════════════════════════════════════
    // Phase 2: Position Sweep — Manage open positions + exits
    // ══════════════════════════════════════════════════════════════
    const activeAssets = Object.keys(portfolio.openPositions || {});
    for (const assetKey of activeAssets) {
      const pos = portfolio.openPositions[assetKey];
      if (!pos) continue;

      try {
        const currentLivePrice = await MarketService.getCurrentPrice(assetKey);
        cycleReport.positionsSwept++;

        // ── AI Position Manager ──────────────────────────────────
        try {
          const posFrame = await buildMarketFrame(assetKey, "1h", 200, true);
          if (posFrame) {
            const posWorldModel = buildWorldModel(posFrame);
            if (newsCatalyst) posWorldModel.newsCatalyst = newsCatalyst;
            
            const mgmt = PositionManager.evaluatePosition(pos, currentLivePrice, posWorldModel);

            if (mgmt.action !== 'NO_CHANGE') {
              portfolio.openPositions[assetKey] = mgmt.updatedPosition;
              await PortfolioManager.updatePortfolio(portfolio);
              await Logger.info(`POSITION_MGR [${assetKey}]: ${mgmt.action} — ${mgmt.message}`);
              cycleReport.positionsManaged.push({ asset: assetKey, action: mgmt.action, message: mgmt.message });
            }
          }
        } catch (pmErr) {
          console.error(`[PositionManager] Error for ${assetKey}:`, pmErr);
        }

        // ── SL/TP Exit Check ─────────────────────────────────────
        const sltp = RiskManager.checkStopLossOrTakeProfit(pos, currentLivePrice);

        if (sltp.triggered) {
          const isShort = pos.direction === 'SHORT';
          const pnl = isShort
            ? (pos.entryPrice - sltp.exitPrice) * pos.amount
            : (pos.amount * sltp.exitPrice) - pos.usdInvested;
          const proceeds = isShort ? pos.usdInvested + pnl : pos.amount * sltp.exitPrice;
          const pnlPercent = (pnl / pos.usdInvested) * 100;

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
            exitReason: sltp.reason!,
          };

          await PortfolioManager.updatePortfolio(portfolio);
          await PortfolioManager.logTrade(closeTrade);
          await Logger.info(`TRADE [${assetKey}] EXIT (${isShort ? 'SHORT' : 'LONG'}): ${sltp.reason} PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`);
          await TelegramService.sendTradeAlert(isShort ? "COVER" : "SELL", pos.amount, sltp.exitPrice, `${sltp.reason} | PnL: $${pnl.toFixed(2)}`, portfolio.usd, pos.signalScore, undefined, undefined, assetKey);

          // Journal the exit for reflection
          await TradeLedger.recordTrade({
            tradeId: closeTrade.id,
            asset: assetKey,
            entryTime: pos.entryTime,
            exitTime: new Date().toISOString(),
            regimeAtEntry: 'RANDOM', // We don't have the original regime, use fallback
            aiThesis: pos.reasoning,
            predictedDirection: isShort ? 'SHORT' : 'LONG',
            actualPnlUsd: pnl,
            actualPnlPercent: pnlPercent,
            wasPredictionCorrect: pnl > 0,
            mistakesMade: [],
            lessonsLearned: [],
          });

          cycleReport.tradesExecuted.push({ asset: assetKey, action: closeTrade.action, pnl });
        } else if (sltp.trailed && sltp.newStopLoss) {
          pos.stopLoss = sltp.newStopLoss;
          await PortfolioManager.updatePortfolio(portfolio);
          cycleReport.decisionsLogged.push({
            asset: assetKey,
            action: "TRAIL_STOP",
            thesis: `Stop-Loss dynamically trailed to $${sltp.newStopLoss.toFixed(2)} to lock in profit.`,
            confidence: 1.0
          });
        }
      } catch (assetErr) {
        console.error(`Error sweeping ${assetKey}:`, assetErr);
        cycleReport.warnings.push(`Sweep error on ${assetKey}: ${assetErr instanceof Error ? assetErr.message : String(assetErr)}`);
      }
    }

    // Phase 2b: Sweep Scalp Positions
    const activeScalps = Object.keys(portfolio.scalpPositions || {});
    for (const assetKey of activeScalps) {
      if (!portfolio.scalpPositions) break;
      const pos = portfolio.scalpPositions[assetKey];
      if (!pos) continue;

      try {
        const currentLivePrice = await MarketService.getCurrentPrice(assetKey);
        
        const sltp = RiskManager.checkStopLossOrTakeProfit(pos, currentLivePrice);
        if (sltp.triggered) {
          const isShort = pos.direction === 'SHORT';
          const pnl = isShort
            ? (pos.entryPrice - sltp.exitPrice) * pos.amount
            : (pos.amount * sltp.exitPrice) - pos.usdInvested;
          const proceeds = isShort ? pos.usdInvested + pnl : pos.amount * sltp.exitPrice;

          portfolio.usd += isShort ? (pos.usdInvested + pnl) : proceeds;
          if (portfolio.balances && !isShort) {
            portfolio.balances[assetKey] = Math.max(0, (portfolio.balances[assetKey] || 0) - pos.amount);
          }
          portfolio.totalPnl += pnl;
          portfolio.totalTrades++;
          
          if (pnl > 0) {
            portfolio.winningTrades++;
            portfolio.grossProfit += pnl;
          } else {
            portfolio.losingTrades++;
            portfolio.grossLoss += Math.abs(pnl);
          }

          delete portfolio.scalpPositions[assetKey];

          const closeTrade: Trade = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            asset: assetKey,
            action: isShort ? "SCALP_COVER" : "SCALP_SELL",
            direction: isShort ? 'SHORT' : 'LONG',
            amount: pos.amount,
            btcAmount: pos.amount,
            price: sltp.exitPrice,
            usdValue: proceeds,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            signalScore: pos.signalScore,
            reasoning: `Scalp closed: ${sltp.reason}`,
            pnl,
            pnlPercent: (pnl / pos.usdInvested) * 100,
            exitPrice: sltp.exitPrice,
            exitTime: new Date().toISOString(),
            exitReason: sltp.reason === 'TAKE_PROFIT' ? 'SCALP_TARGET' : 'SCALP_STOP',
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
            actualPnlPercent: closeTrade.pnlPercent || 0,
            wasPredictionCorrect: pnl > 0,
            mistakesMade: [],
            lessonsLearned: [],
          });

          await Logger.info(`SCALP EXIT [${assetKey}]: ${sltp.reason} PnL: $${pnl.toFixed(2)}`);
          cycleReport.tradesExecuted.push({ asset: assetKey, action: closeTrade.action, pnl });
        } else if (sltp.trailed && sltp.newStopLoss) {
          pos.stopLoss = sltp.newStopLoss;
          await PortfolioManager.updatePortfolio(portfolio);
          cycleReport.decisionsLogged.push({
            asset: assetKey,
            action: "SCALP_TRAIL_STOP",
            thesis: `Scalp Stop-Loss dynamically trailed to $${sltp.newStopLoss.toFixed(2)}.`,
            confidence: 1.0
          });
        }
      } catch (e) {
         console.error(`Error sweeping scalp ${assetKey}:`, e);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // Phase 3: Market Scan — Evaluate all assets for new trades
    // ══════════════════════════════════════════════════════════════
    const assetsToScan = Object.keys(SUPPORTED_ASSETS);

    // Calculate net liquidation value for drawdown tracking
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
          totalLiquidsValue += openPos.usdInvested;
        }
      }
    }
    for (const key of Object.keys(portfolio.scalpPositions || {})) {
      const openPos = portfolio.scalpPositions![key];
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
          totalLiquidsValue += openPos.usdInvested;
        }
      }
    }
    portfolio.peakValue = Math.max(portfolio.peakValue, totalLiquidsValue);
    const dd = (portfolio.peakValue - totalLiquidsValue) / portfolio.peakValue;
    portfolio.maxDrawdown = Math.max(portfolio.maxDrawdown, portfolio.peakValue - totalLiquidsValue);
    portfolio.maxDrawdownPercent = Math.max(portfolio.maxDrawdownPercent, dd * 100);

    // ── Macro Bitcoin Anchor ────────────────────────────────────
    let btcWorldModel: MarketWorldModel | null = null;
    try {
      const btcFrame = await buildMarketFrame("BTC", "1h", 200, true);
      if (btcFrame && isDataSafeForTrading(btcFrame)) {
        btcWorldModel = buildWorldModel(btcFrame);
      }
    } catch (e) {
      console.error("[AgentCycle] Failed to build BTC Macro Anchor:", e);
    }

    // ── Phase 3a: Pre-Scan Data Mesh & Math Filter ─────────────────
    const candidateModels: { asset: string; model: MarketWorldModel; score: number }[] = [];

    for (const asset of assetsToScan) {
      try {
        const config = SUPPORTED_ASSETS[asset];
        const day = new Date().getDay();
        const isWeekend = (day === 6 || day === 0);
        const isMarketClosed = isWeekend && config.category !== 'crypto';

        if (isMarketClosed) {
          cycleReport.assetsScanned.push({ asset, action: "SKIP", reason: "Market Closed (Weekend)" });
          continue;
        }

        const frame = await buildMarketFrame(asset, "1h", 200, true);
        if (!frame || !isDataSafeForTrading(frame)) {
          cycleReport.assetsScanned.push({ asset, action: "SKIP", reason: "No frame / unsafe data" });
          continue;
        }

        const worldModel = buildWorldModel(frame);
        if (newsCatalyst) worldModel.newsCatalyst = newsCatalyst;
        
        // Use bias score as the mathematical filter (-100 to +100)
        const score = Math.abs(worldModel.biasScore);
        candidateModels.push({ asset, model: worldModel, score });

      } catch (assetError) {
        const msg = assetError instanceof Error ? assetError.message : String(assetError);
        cycleReport.warnings.push(`Pre-scan error on ${asset}: ${msg}`);
      }
    }

    // Sort by most explosive/actionable mathematical setups
    candidateModels.sort((a, b) => b.score - a.score);

    // Filter: Only take the top 2 that have a decent mathematical setup (e.g., > 30 confluence)
    // Most of the time, this will reduce 9 API calls down to 0, 1, or 2.
    const topCandidates = candidateModels.filter(c => c.score >= 30).slice(0, 2);
    const skippedCandidates = candidateModels.filter(c => c.score < 30 || !topCandidates.includes(c));

    for (const skipped of skippedCandidates) {
       cycleReport.assetsScanned.push({ asset: skipped.asset, action: "HOLD", reason: `Pre-Filter: Confluence (${skipped.model.biasScore}) below action threshold.` });
    }

    // ── Phase 3b: Autonomous Brain (LLM Deep Dive on Top Candidates) 
    for (const candidate of topCandidates) {
      const asset = candidate.asset;
      const worldModel = candidate.model;
      try {
        const openPositions = Object.values(portfolio.openPositions || {});
        const finalDecision = await AutonomousBrain.evaluateMarket(
          worldModel,
          portfolio,
          openPositions,
          lessons,
          btcWorldModel || undefined
        );

        // Minimal delay since we are making max 2 calls per cycle
        await new Promise(resolve => setTimeout(resolve, 2000));

        // ── Paper Exchange ─────────────────────────────────────────
        const executionResult = await PaperExchange.executeDecision(finalDecision, worldModel, portfolio);

        if (!executionResult.success || finalDecision.action === 'HOLD') {
          cycleReport.assetsScanned.push({ asset, action: "HOLD", reason: executionResult.message });
          cycleReport.decisionsLogged.push({ asset, action: finalDecision.action, thesis: finalDecision.thesis, confidence: finalDecision.confidence });
        } else if (executionResult.trade) {
          // ── State Update ───────────────────────────────────────────
          await PortfolioManager.updatePortfolio(executionResult.updatedPortfolio);
          await PortfolioManager.logTrade(executionResult.trade);

          // Journal for reflection memory
          await TradeLedger.recordTrade({
            tradeId: executionResult.trade.id,
            asset,
            entryTime: new Date().toISOString(),
            exitTime: executionResult.trade.exitTime || new Date().toISOString(),
            regimeAtEntry: worldModel.regime,
            aiThesis: finalDecision.thesis,
            predictedDirection: executionResult.trade.direction || 'LONG',
            actualPnlUsd: executionResult.trade.pnl || 0,
            actualPnlPercent: executionResult.trade.pnlPercent || 0,
            wasPredictionCorrect: executionResult.trade.pnl !== undefined ? executionResult.trade.pnl > 0 : true,
            mistakesMade: [],
            lessonsLearned: [],
          });

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

          cycleReport.tradesExecuted.push({ asset, action: finalDecision.action, pnl: executionResult.trade.pnl || 0 });
          cycleReport.assetsScanned.push({ asset, action: finalDecision.action, reason: executionResult.message });
        }

        // ── Phase 3b: Micro Scalp Scan ─────────────────────────────
        if (!portfolio.scalpPositions) portfolio.scalpPositions = {};
        if (!portfolio.scalpPositions[asset]) {
          const scalpSignal = await ScalpEngine.analyze(asset);
          if (scalpSignal.action !== 'HOLD') {
            const currentLivePrice = scalpSignal.entryPrice;
            const isShort = scalpSignal.action === 'SCALP_SHORT';
            
            // Progressive risk: 2% up to 5% based on account size
            const riskPercent = portfolio.usd > 50000 ? 0.05 : 0.02;
            const usdInvested = portfolio.usd * riskPercent;
            
            if (usdInvested >= 10) { // Minimum trade size
              const amount = usdInvested / currentLivePrice;
              
              portfolio.usd -= usdInvested;
              if (!isShort) {
                portfolio.balances[asset] = (portfolio.balances[asset] || 0) + amount;
              }

              const newScalp: OpenPosition = {
                asset,
                entryPrice: currentLivePrice,
                amount,
                btcAmount: amount,
                usdInvested,
                stopLoss: scalpSignal.stopLoss,
                takeProfit: scalpSignal.takeProfit,
                entryTime: new Date().toISOString(),
                signalScore: scalpSignal.score,
                reasoning: scalpSignal.reasoning,
                direction: isShort ? 'SHORT' : 'LONG'
              };

              portfolio.scalpPositions[asset] = newScalp;
              
              const entryTrade: Trade = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                asset,
                action: scalpSignal.action,
                direction: isShort ? 'SHORT' : 'LONG',
                amount,
                btcAmount: amount,
                price: currentLivePrice,
                usdValue: usdInvested,
                stopLoss: scalpSignal.stopLoss,
                takeProfit: scalpSignal.takeProfit,
                signalScore: scalpSignal.score,
                reasoning: scalpSignal.reasoning
              };

              await PortfolioManager.updatePortfolio(portfolio);
              await PortfolioManager.logTrade(entryTrade);
              await Logger.info(`SCALP ENTRY [${asset}]: ${scalpSignal.action} | ${scalpSignal.reasoning}`);
              await TelegramService.sendTradeAlert(
                scalpSignal.action,
                amount,
                currentLivePrice,
                scalpSignal.reasoning,
                portfolio.usd,
                scalpSignal.score,
                scalpSignal.stopLoss,
                scalpSignal.takeProfit,
                asset
              );
              cycleReport.tradesExecuted.push({ asset, action: scalpSignal.action, pnl: 0 });
            }
          }
        }
      } catch (assetError) {
        const msg = assetError instanceof Error ? assetError.message : String(assetError);
        cycleReport.warnings.push(`Scan error on ${asset}: ${msg}`);
        cycleReport.assetsScanned.push({ asset, action: "ERROR", reason: msg });
      }
    }

    // ══════════════════════════════════════════════════════════════
    // Finalize
    // ══════════════════════════════════════════════════════════════
    cycleReport.durationMs = Date.now() - cycleStart;
    await Logger.info(`🧠 Autonomous Cycle Complete in ${(cycleReport.durationMs / 1000).toFixed(1)}s — ${cycleReport.tradesExecuted.length} trades, ${cycleReport.assetsScanned.length} scanned`);

    return NextResponse.json(cycleReport);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await Logger.error("Autonomous Cycle Crashed", { error: msg });
    try { await TelegramService.sendAlert(`*AGENT CRASH*: ${TelegramService.escapeMarkdown(msg)}`); } catch {}
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    // Always release the lock
    await redis.del(CYCLE_LOCK_KEY);
  }
}

// ── Types ────────────────────────────────────────────────────────────

interface CycleReport {
  success: boolean;
  timestamp: string;
  durationMs: number;
  reflectionRan: boolean;
  positionsSwept: number;
  positionsManaged: { asset: string; action: string; message: string }[];
  assetsScanned: { asset: string; action: string; reason: string }[];
  tradesExecuted: { asset: string; action: string; pnl: number }[];
  decisionsLogged: { asset: string; action: string; thesis: string; confidence: number }[];
  warnings: string[];
}

// ── HTTP Handlers ────────────────────────────────────────────────────

export async function GET(request: Request) { return handleCycle(request); }
export async function POST(request: Request) { return handleCycle(request); }
