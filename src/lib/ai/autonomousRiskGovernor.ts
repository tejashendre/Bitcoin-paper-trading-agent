import { BrainDecision, AutonomousDecision, RiskGovernorLimits, Portfolio, MarketWorldModel, PredictionPerformanceSummary } from '@/lib/types';

// Default conservative risk parameters
const DEFAULT_LIMITS: RiskGovernorLimits = {
  maxLeverage: 1.0,
  maxDrawdownPercent: 15.0, // Stop all trading if portfolio drops 15% from peak
  maxPositionSizeUsd: 10000,
  minStopLossPercent: 0.5,
  maxStopLossPercent: 10.0,
  maxDailyTrades: 50,
  haltTradingIfDataBad: true,
};

export class AutonomousRiskGovernor {
  /**
   * Evaluates the Brain's raw decision against immutable risk laws.
   * Modifies sizes, enforces stops, or outright blocks the trade if unsafe.
   */
  static enforceRiskLimits(
    brainDecision: BrainDecision,
    worldModel: MarketWorldModel,
    portfolio: Portfolio,
    predictionStats?: PredictionPerformanceSummary,
    limits: RiskGovernorLimits = DEFAULT_LIMITS,
    btcWorldModel?: MarketWorldModel
  ): AutonomousDecision {
    const { action, suggestedSizeUsd, stopLossPrice, takeProfitPrice } = brainDecision;
    const currentPrice = worldModel.currentPrice;

    let blocked = false;
    let blockReason: string | null = null;
    let approvedSizeUsd = 0;
    let adjustedStopLoss = stopLossPrice;
    let adjustedTakeProfit = takeProfitPrice;

    // 1. Data Quality Halt
    if (limits.haltTradingIfDataBad && worldModel.dataQuality < 50) {
      if (action === 'BUY' || action === 'SHORT') {
        blocked = true;
        blockReason = `Data quality too low (${worldModel.dataQuality}/100) to safely enter a new position.`;
      }
    }

    // 2. Drawdown Halt
    if (portfolio.maxDrawdownPercent > limits.maxDrawdownPercent) {
      if (action === 'BUY' || action === 'SHORT') {
        blocked = true;
        blockReason = `Max drawdown exceeded (${portfolio.maxDrawdownPercent.toFixed(2)}% > ${limits.maxDrawdownPercent}%). Trading halted to protect capital.`;
      }
    }

    // 2.5 Macro-Correlation Matrix (Bitcoin Anchor)
    if (btcWorldModel && worldModel.asset !== 'BTC') {
      const btcBearish = btcWorldModel.regime === 'PANIC' || btcWorldModel.regime === 'STRONG_TREND_DOWN' || btcWorldModel.regime === 'WEAK_TREND_DOWN';
      const btcBullish = btcWorldModel.regime === 'STRONG_TREND_UP' || btcWorldModel.regime === 'WEAK_TREND_UP' || btcWorldModel.regime === 'BREAKOUT';
      
      if (action === 'BUY' && btcBearish) {
        blocked = true;
        blockReason = `Macro Correlation Block: BTC is ${btcWorldModel.regime}. Altcoin LONGs are vetoed to prevent fakeout losses.`;
      }
      
      if (action === 'SHORT' && btcBullish) {
        blocked = true;
        blockReason = `Macro Correlation Block: BTC is ${btcWorldModel.regime}. Altcoin SHORTs are vetoed to prevent short-squeeze losses.`;
      }
    }

    // 3. Size Limits (Kelly Criterion Integration)
    if (!blocked && (action === 'BUY' || action === 'SHORT')) {
      let riskPercent = 0.10; // Default 10%

      // Apply True Kelly Sizing if we have enough prediction data
      if (predictionStats && predictionStats.totalResolved >= 10) {
        // Kelly = W - ((1 - W) / R)
        // Assume R (Reward/Risk) = 2.0 based on our general targets
        const w = Math.max(0.01, Math.min(0.99, predictionStats.accuracy));
        const r = 2.0;
        let kelly = w - ((1 - w) / r);
        
        // Cap Kelly to avoid over-leveraging on hot streaks
        kelly = Math.max(0.01, Math.min(0.20, kelly)); // Max 20% of portfolio
        
        // Use Half-Kelly for safety
        riskPercent = kelly * 0.5;
        
        if (kelly <= 0.01) {
           // If edge is gone, heavily restrict sizing
           riskPercent = 0.02; // Minimum 2%
        }
      }

      let targetSize = portfolio.usd * riskPercent;

      // If AI specifically suggested a smaller size, respect its caution
      if (suggestedSizeUsd && suggestedSizeUsd < targetSize) {
        targetSize = suggestedSizeUsd;
      }

      // Cap at Risk Limits
      if (targetSize > limits.maxPositionSizeUsd) {
        targetSize = limits.maxPositionSizeUsd;
      }

      // Cap at available USD
      if (targetSize > portfolio.usd) {
        targetSize = portfolio.usd * 0.95; // Leave 5% buffer
      }

      // If available is too small, block
      if (targetSize < 10) {
        blocked = true;
        blockReason = "Insufficient USD balance to execute meaningful trade.";
      }

      approvedSizeUsd = targetSize;
    }

    // 4. Enforce Stop Loss Presence for New Positions
    if (!blocked && (action === 'BUY' || action === 'SHORT')) {
      if (!stopLossPrice) {
        blocked = true;
        blockReason = "AI proposed a trade without a stop loss. Denied by Risk Governor.";
      }
    }

    // Convert to Autonomous Decision
    return {
      ...brainDecision,
      id: crypto.randomUUID(),
      asset: worldModel.asset,
      approvedSizeUsd,
      riskAdjustedStopLoss: adjustedStopLoss,
      riskAdjustedTakeProfit: adjustedTakeProfit,
      blockedByRisk: blocked,
      riskBlockReason: blockReason,
      timestamp: new Date().toISOString()
    };
  }
}
