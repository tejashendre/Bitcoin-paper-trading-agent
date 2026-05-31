import { AutonomousDecision, Portfolio, Trade, OpenPosition, MarketWorldModel } from '@/lib/types';
import { FillSimulator } from './fillSimulator';

export class PaperExchange {
  /**
   * Executes a risk-approved autonomous decision on the paper exchange.
   * Simulates fills with slippage, updates the portfolio, and returns the modified objects.
   */
  static async executeDecision(
    decision: AutonomousDecision,
    worldModel: MarketWorldModel,
    portfolio: Portfolio
  ): Promise<{ success: boolean; message: string; fillDetails?: any; updatedPortfolio: Portfolio; trade?: Trade; }> {
    
    if (decision.blockedByRisk) {
      return { success: false, message: decision.riskBlockReason || 'Blocked by risk governor.', updatedPortfolio: portfolio };
    }

    if (decision.action === 'HOLD') {
      return { success: true, message: 'AI decided to HOLD.', updatedPortfolio: portfolio };
    }

    const { action, approvedSizeUsd, asset, riskAdjustedStopLoss, riskAdjustedTakeProfit } = decision;
    const currentPrice = worldModel.currentPrice;
    
    // Simulate realistic fill with slippage and fees based on volatility regime
    const simulatedFill = FillSimulator.simulateFill(
      action,
      currentPrice,
      approvedSizeUsd,
      worldModel.volatilityRegime
    );

    if (!simulatedFill.success || !simulatedFill.fillPrice) {
      return { success: false, message: `Execution failed: ${simulatedFill.rejectionReason}`, updatedPortfolio: portfolio };
    }

    const fillPrice = simulatedFill.fillPrice;
    const actualUsdInvested = approvedSizeUsd;
    const amount = actualUsdInvested / fillPrice;
    const currentPosition = portfolio.openPositions?.[asset] || null;

    let pnl = 0;
    let pnlPercent = 0;
    let trade: Trade | undefined;

    // Execute the trade state changes
    if (action === 'BUY' && !currentPosition) {
      // ── Open LONG ──────────────────────────────────────────────────────────
      if (actualUsdInvested > portfolio.usd) {
         return { success: false, message: `Insufficient margin for BUY`, updatedPortfolio: portfolio };
      }
      portfolio.usd -= actualUsdInvested;
      if (portfolio.balances) {
        portfolio.balances[asset] = (portfolio.balances[asset] || 0) + amount;
      }
      
      const newPos: OpenPosition = {
        asset,
        entryPrice: fillPrice,
        amount,
        btcAmount: amount, // legacy
        usdInvested: actualUsdInvested,
        stopLoss: riskAdjustedStopLoss || (fillPrice * 0.95), // Fallback
        takeProfit: riskAdjustedTakeProfit || (fillPrice * 1.05), // Fallback
        entryTime: new Date().toISOString(),
        signalScore: decision.confidence,
        reasoning: decision.thesis,
        direction: 'LONG'
      };

      if (!portfolio.openPositions) portfolio.openPositions = {};
      portfolio.openPositions[asset] = newPos;

      trade = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        asset,
        action: 'BUY',
        direction: 'LONG',
        amount,
        btcAmount: amount,
        price: fillPrice,
        usdValue: actualUsdInvested,
        stopLoss: newPos.stopLoss,
        takeProfit: newPos.takeProfit,
        signalScore: decision.confidence,
        reasoning: decision.thesis
      };

    } else if (action === 'SELL' && currentPosition && currentPosition.direction === 'LONG') {
      // ── Close LONG ─────────────────────────────────────────────────────────
      const proceeds = currentPosition.amount * fillPrice;
      pnl = proceeds - currentPosition.usdInvested;
      pnlPercent = (pnl / currentPosition.usdInvested) * 100;

      portfolio.usd += proceeds;
      if (portfolio.balances) {
        portfolio.balances[asset] = Math.max(0, (portfolio.balances[asset] || 0) - currentPosition.amount);
      }
      
      delete portfolio.openPositions[asset];
      
      trade = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        asset,
        action: 'SELL',
        direction: 'LONG',
        amount: currentPosition.amount,
        btcAmount: currentPosition.amount,
        price: fillPrice,
        usdValue: proceeds,
        stopLoss: currentPosition.stopLoss,
        takeProfit: currentPosition.takeProfit,
        signalScore: decision.confidence,
        reasoning: decision.thesis,
        pnl,
        pnlPercent,
        exitPrice: fillPrice,
        exitTime: new Date().toISOString(),
        exitReason: 'SIGNAL_REVERSAL'
      };

    } else if (action === 'SHORT' && !currentPosition) {
      // ── Open SHORT ─────────────────────────────────────────────────────────
      if (actualUsdInvested > portfolio.usd) {
         return { success: false, message: `Insufficient margin for SHORT`, updatedPortfolio: portfolio };
      }
      
      // Lock margin
      portfolio.usd -= actualUsdInvested;

      const newPos: OpenPosition = {
        asset,
        entryPrice: fillPrice,
        amount,
        btcAmount: amount, // legacy
        usdInvested: actualUsdInvested,
        stopLoss: riskAdjustedStopLoss || (fillPrice * 1.05),
        takeProfit: riskAdjustedTakeProfit || (fillPrice * 0.95),
        entryTime: new Date().toISOString(),
        signalScore: decision.confidence,
        reasoning: decision.thesis,
        direction: 'SHORT'
      };

      if (!portfolio.openPositions) portfolio.openPositions = {};
      portfolio.openPositions[asset] = newPos;

      trade = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        asset,
        action: 'SHORT',
        direction: 'SHORT',
        amount,
        btcAmount: amount,
        price: fillPrice,
        usdValue: actualUsdInvested,
        stopLoss: newPos.stopLoss,
        takeProfit: newPos.takeProfit,
        signalScore: decision.confidence,
        reasoning: decision.thesis
      };

    } else if (action === 'COVER' && currentPosition && currentPosition.direction === 'SHORT') {
      // ── Close SHORT ────────────────────────────────────────────────────────
      // Profit is made when exit price is LOWER than entry price.
      pnl = (currentPosition.entryPrice - fillPrice) * currentPosition.amount;
      pnlPercent = (pnl / currentPosition.usdInvested) * 100;

      // Return margin + profit (or minus loss)
      portfolio.usd += currentPosition.usdInvested + pnl;

      delete portfolio.openPositions[asset];

      trade = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        asset,
        action: 'COVER',
        direction: 'SHORT',
        amount: currentPosition.amount,
        btcAmount: currentPosition.amount,
        price: fillPrice,
        usdValue: currentPosition.usdInvested + pnl, // return value
        stopLoss: currentPosition.stopLoss,
        takeProfit: currentPosition.takeProfit,
        signalScore: decision.confidence,
        reasoning: decision.thesis,
        pnl,
        pnlPercent,
        exitPrice: fillPrice,
        exitTime: new Date().toISOString(),
        exitReason: 'SIGNAL_REVERSAL'
      };

    } else {
      return { success: false, message: `Invalid action sequence: ${action} with position state`, updatedPortfolio: portfolio };
    }

    // Update global portfolio metrics if a trade was closed
    if (action === 'SELL' || action === 'COVER') {
      portfolio.totalPnl += pnl;
      portfolio.totalTrades++;
      portfolio.returns.push(pnlPercent);

      if (pnl >= 0) {
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
    }

    // Keep legacy single-position key in sync for backwards compatibility
    if (asset === 'BTC') {
      portfolio.openPosition = portfolio.openPositions?.[asset] || null;
      if (action === 'BUY' || action === 'SHORT') {
        portfolio.btc = amount;
      } else {
        portfolio.btc = 0;
      }
    }

    return {
      success: true,
      message: `Order filled via PaperExchange: ${action} $${actualUsdInvested.toFixed(2)} with ${simulatedFill.quality} quality.`,
      fillDetails: simulatedFill,
      updatedPortfolio: portfolio,
      trade
    };
  }
}
