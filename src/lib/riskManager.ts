import { RiskParameters, Portfolio, OpenPosition, StatisticalMetrics } from "@/lib/types";

export class RiskManager {
  static calculatePosition(
    capital: number,
    riskPercent: number,
    entryPrice: number,
    atr: number,
    portfolio: Portfolio,
    assetKey: string = "BTC",
    direction: 'LONG' | 'SHORT' = 'LONG',
    stats?: StatisticalMetrics
  ): RiskParameters {
    const isForex = assetKey.includes("USD") && assetKey !== "GOLD" && assetKey !== "OIL";
    
    // Stop distance based on volatility (ATR). Squeezed tightly for Forex to match typical pips.
    let atrMultiplier = isForex ? 1.2 : 1.5;
    
    if (stats) {
      if (stats.hurstExponent > 0.55) {
        // High trend structure: tighten stops by 15% to lock in early momentum breakout
        atrMultiplier = atrMultiplier * 0.85;
      } else if (stats.hurstExponent < 0.45 || stats.volatilityPercentile > 75) {
        // High random noise or extreme volatility spike: expand stops by 35% to withstand spikes
        atrMultiplier = atrMultiplier * 1.35;
      }
    }

    const stopDistance = atr * atrMultiplier;
    const stopLoss = direction === 'SHORT' ? entryPrice + stopDistance : entryPrice - stopDistance;
    const takeProfit = direction === 'SHORT' ? entryPrice - (stopDistance * 2.0) : entryPrice + (stopDistance * 2.0);
    
    const riskAmount = capital * (riskPercent / 100);

    // Dynamic Equity Curve Drawdown Guard
    let adjustedRiskPercent = riskPercent;
    if (portfolio.peakValue > 0) {
      const currentDrawdown = (portfolio.peakValue - capital) / portfolio.peakValue;
      if (currentDrawdown > 0.08) {
        adjustedRiskPercent = riskPercent * 0.25; // 75% size reduction in severe drawdown
      } else if (currentDrawdown > 0.05) {
        adjustedRiskPercent = riskPercent * 0.5;  // 50% size reduction in moderate drawdown
      } else if (currentDrawdown > 0.03) {
        adjustedRiskPercent = riskPercent * 0.75; // 25% size reduction in mild drawdown
      }
    }

    // Correlation & Concentration Sizing Modifier
    let correlationMultiplier = 1.0;
    if (portfolio.openPositions) {
      const openKeys = Object.keys(portfolio.openPositions);
      if (openKeys.length > 0) {
        // 1. Sector correlation check (e.g., multi-crypto exposure)
        const isNewCrypto = assetKey === "BTC" || assetKey === "ETH" || assetKey === "SOL";
        const hasExistingCrypto = openKeys.some(k => k === "BTC" || k === "ETH" || k === "SOL");
        
        const isNewCommodity = assetKey === "GOLD" || assetKey === "SILVER";
        const hasExistingCommodity = openKeys.some(k => k === "GOLD" || k === "SILVER");
        
        if ((isNewCrypto && hasExistingCrypto) || (isNewCommodity && hasExistingCommodity)) {
          correlationMultiplier = correlationMultiplier * 0.65; // 35% risk reduction for sector concentration
        }
        
        // 2. Over-exposure scaling cap
        if (openKeys.length >= 3) {
          correlationMultiplier = correlationMultiplier * 0.60; // 40% risk reduction for broad overexposure
        } else if (openKeys.length === 2) {
          correlationMultiplier = correlationMultiplier * 0.80; // 20% risk reduction for moderate overexposure
        }
      }
    }
    
    adjustedRiskPercent = adjustedRiskPercent * correlationMultiplier;
    const dynamicRiskAmount = capital * (adjustedRiskPercent / 100);

    const positionSizeUsd = dynamicRiskAmount / (stopDistance / entryPrice);
    
    let amount = positionSizeUsd / entryPrice;
    let actualPositionUsd = positionSizeUsd;
    
    // Hard ceiling sizing per asset (Institutional risk parity allocation)
    const maxAllocationPercent = isForex ? 0.15 : 0.10; // Capped to ensure multi-asset diversification and prevent cash locks
    if (actualPositionUsd > capital * maxAllocationPercent) {
      actualPositionUsd = capital * maxAllocationPercent;
      amount = actualPositionUsd / entryPrice;
    }

    // Cap at available cash to prevent insufficient margin errors
    if (actualPositionUsd > portfolio.usd) {
      actualPositionUsd = portfolio.usd;
      amount = actualPositionUsd / entryPrice;
    }

    // Initialize Kelly Fraction calculations
    let kellyFraction = riskPercent / 100;
    const p = portfolio.totalTrades > 0 ? portfolio.winningTrades / portfolio.totalTrades : 0;
    const avgWin = portfolio.winningTrades > 0 ? portfolio.grossProfit / portfolio.winningTrades : 0;
    const avgLoss = portfolio.losingTrades > 0 ? portfolio.grossLoss / portfolio.losingTrades : 0;
    
    if (portfolio.totalTrades >= 8 && avgLoss > 0) {
      const b = avgWin / avgLoss;
      const f = (p * b - (1 - p)) / b;
      if (f > 0) {
        kellyFraction = f;
      } else {
        kellyFraction = 0;
      }
    }
    const halfKellyFraction = kellyFraction / 2;
    const var95 = capital * 0.05 * 1.645; // 95% Daily Value at Risk

    return {
      positionSizeBtc: amount, // Keep for backward type compatibility
      positionSizeUsd: actualPositionUsd,
      stopLoss,
      takeProfit,
      riskRewardRatio: 2.0,
      riskAmount,
      riskPercent,
      kellyFraction,
      halfKellyFraction,
      var95
    };
  }

  static shouldTrade(portfolio: Portfolio, currentValue: number, assetKey: string = "BTC"): { allowed: boolean; reason: string } {
    // 1. Max portfolio drawdown guard (Institutional 10% draw cap)
    if (portfolio.peakValue > 0) {
      const dd = (portfolio.peakValue - currentValue) / portfolio.peakValue;
      if (dd > 0.10) {
        return { allowed: false, reason: "10% maximum portfolio drawdown reached" };
      }
    }

    // 2. Dynamic capital floor (lowered to $0.50 to allow micro-fractional trades)
    if (portfolio.usd < 0.50) {
      return { allowed: false, reason: "Insufficient USD capital (below $0.50 floor)" };
    }

    // 3. Prevent overlapping trades in the exact same asset
    if (portfolio.openPositions && portfolio.openPositions[assetKey]) {
      return { allowed: false, reason: `Active position in ${assetKey} already open` };
    }

    return { allowed: true, reason: "" };
  }

  static checkStopLossOrTakeProfit(
    position: OpenPosition,
    currentPrice: number
  ): { 
    triggered: boolean; 
    reason: "STOP_LOSS" | "TAKE_PROFIT" | null; 
    exitPrice: number;
    trailed?: boolean;
    newStopLoss?: number;
  } {
    const originalRiskPercent = Math.abs(position.entryPrice - position.stopLoss) / position.entryPrice;
    const activationThreshold = originalRiskPercent * 1.5; // Start trailing after 1.5R profit
    const trailDistancePercent = originalRiskPercent * 0.8; // Trail at 0.8R behind price

    if (position.direction === 'SHORT') {
      if (currentPrice >= position.stopLoss) {
        return { triggered: true, reason: "STOP_LOSS", exitPrice: position.stopLoss };
      }
      if (currentPrice <= position.takeProfit) {
        return { triggered: true, reason: "TAKE_PROFIT", exitPrice: position.takeProfit };
      }

      // Dynamic Trailing Stop (Short)
      const profitPercent = (position.entryPrice - currentPrice) / position.entryPrice;
      if (profitPercent > activationThreshold) {
        const trailingStopLevel = currentPrice * (1 + trailDistancePercent);
        if (trailingStopLevel < position.stopLoss) {
          return { triggered: false, reason: null, exitPrice: currentPrice, trailed: true, newStopLoss: trailingStopLevel };
        }
      }
    } else {
      if (currentPrice <= position.stopLoss) {
        return { triggered: true, reason: "STOP_LOSS", exitPrice: position.stopLoss };
      }
      if (currentPrice >= position.takeProfit) {
        return { triggered: true, reason: "TAKE_PROFIT", exitPrice: position.takeProfit };
      }

      // Dynamic Trailing Stop (Long)
      const profitPercent = (currentPrice - position.entryPrice) / position.entryPrice;
      if (profitPercent > activationThreshold) {
        const trailingStopLevel = currentPrice * (1 - trailDistancePercent);
        if (trailingStopLevel > position.stopLoss) {
          return { triggered: false, reason: null, exitPrice: currentPrice, trailed: true, newStopLoss: trailingStopLevel };
        }
      }
    }
    return { triggered: false, reason: null, exitPrice: currentPrice };
  }
}
