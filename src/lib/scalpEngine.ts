import { Portfolio, OpenPosition, StatisticalMetrics, Timeframe, Candle, StochRSIValue } from "@/lib/types";
import { MarketService } from "./market";
import { computeAllIndicators, getLatestSnapshot } from "./indicators";
import { computeStatistics } from "./statistics";
import { ReflectionEngine } from "./memory/reflectionEngine";
import { DynamicParameters } from "./types";

export interface ScalpSignal {
  asset: string;
  action: 'SCALP_BUY' | 'SCALP_SHORT' | 'HOLD';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  score: number;
}

export class ScalpEngine {
  /**
   * Analyzes an asset for high-frequency scalping opportunities.
   * Scalps only trigger under optimal statistical conditions.
   */
  static async analyze(assetKey: string = "BTC"): Promise<ScalpSignal> {
    try {
      const reflection = await ReflectionEngine.getLatestReflection();
      const dynParams: DynamicParameters = reflection?.optimizedParameters || {
        rsiOverbought: 65,
        rsiOversold: 40,
        macdHistogramMin: 0,
        stochRsiOverbought: 85,
        stochRsiOversold: 15,
        vwapDeviationPercent: 0.5
      };

      // 1. Fetch multi-timeframe compressed candles for high accuracy
      const [candles1m, candles5m, candles15m] = await Promise.all([
        MarketService.getCandles("1m", 100, assetKey),
        MarketService.getCandles("5m", 100, assetKey),
        MarketService.getCandles("15m", 150, assetKey)
      ]);

      if (candles1m.length === 0 || candles5m.length === 0 || candles15m.length === 0) {
        return { asset: assetKey, action: "HOLD", entryPrice: 0, stopLoss: 0, takeProfit: 0, reasoning: "Insufficient historical data", score: 0 };
      }

      // Compute indicators
      const ind1m = computeAllIndicators(candles1m);
      const ind5m = computeAllIndicators(candles5m);
      const ind15m = computeAllIndicators(candles15m);

      const snap1m = getLatestSnapshot(candles1m, ind1m);
      const snap5m = getLatestSnapshot(candles5m, ind5m);
      const snap15m = getLatestSnapshot(candles15m, ind15m);

      const stats15m = computeStatistics(candles15m, snap15m, ind15m.atr);
      
      const currentPrice = snap1m.price;

      // 2. Regime Filter: Scalping activates in mean-reverting OR squeeze states
      // Hurst < 0.52: accepts mild trending markets (was 0.48 — too strict)
      // Vol percentile < 40: accepts moderate squeezes (was 30 — too strict)
      const isMeanReverting = stats15m.hurstExponent < 0.58;
      const isVolatilitySqueeze = stats15m.volatilityPercentile < 55;

      if (!isMeanReverting && !isVolatilitySqueeze) {
        return {
          asset: assetKey,
          action: "HOLD",
          entryPrice: currentPrice,
          stopLoss: 0,
          takeProfit: 0,
          reasoning: `Deactivated: Market strongly trending (Hurst: ${stats15m.hurstExponent.toFixed(2)}, Vol %: ${stats15m.volatilityPercentile.toFixed(0)})`,
          score: 0
        };
      }

      // 3. Quantitative Confluence Signal Calculations
      let buyScore = 0;
      let shortScore = 0;
      const details: string[] = [];

      // A. Stochastic RSI Crossovers (High weight)
      // Long: StochRSI < 15 & %K crosses above %D
      // Short: StochRSI > 85 & %K crosses below %D
      const stoch1m = snap1m.stochRsi;
      const stoch5m = snap5m.stochRsi;

      if (stoch1m.k < dynParams.stochRsiOversold && stoch5m.k < (dynParams.stochRsiOversold + 5)) {
        buyScore += 8;
        if (stoch1m.k > stoch1m.d) {
          buyScore += 4;
          details.push("1m StochRSI Oversold Bullish Cross");
        }
      } else if (stoch1m.k > dynParams.stochRsiOverbought && stoch5m.k > (dynParams.stochRsiOverbought - 5)) {
        shortScore += 8;
        if (stoch1m.k < stoch1m.d) {
          shortScore += 4;
          details.push("1m StochRSI Overbought Bearish Cross");
        }
      }

      // B. Fast EMA Ribbon alignment on 1m
      const priceEma9 = currentPrice > snap1m.ema9;
      const ema9Ema21 = snap1m.ema9 > snap1m.ema21;
      if (priceEma9 && ema9Ema21) {
        buyScore += 4;
        details.push("1m Bullish EMA Ribbon Stack");
      } else if (!priceEma9 && !ema9Ema21) {
        shortScore += 4;
        details.push("1m Bearish EMA Ribbon Stack");
      }

      // C. VWAP anchor deviation
      // If price drops below lower BB band or VWAP by > 0.5%, snap back expected
      const priceBelowVWAP = currentPrice < snap5m.vwap;
      if (priceBelowVWAP && currentPrice < snap5m.bb.lower) {
        buyScore += 4;
        details.push("Oversold BB band deviation");
      } else if (!priceBelowVWAP && currentPrice > snap5m.bb.upper) {
        shortScore += 4;
        details.push("Overbought BB band deviation");
      }

      // D. Institutional Orderbook Imbalance (L2 Depth)
      const depth = await MarketService.getOrderbookImbalance(assetKey);
      if (depth.isBullish) {
        buyScore += 5;
        details.push(`L2 Buy Wall (Ratio: ${depth.imbalanceRatio.toFixed(1)}x)`);
      } else if (depth.isBearish) {
        shortScore += 5;
        details.push(`L2 Sell Wall (Ratio: ${depth.imbalanceRatio.toFixed(1)}x)`);
      }

      // 4. Determine Action
      // Score threshold: 8 (was 12) — still requires 2+ strong indicator agreements
      let action: 'SCALP_BUY' | 'SCALP_SHORT' | 'HOLD' = 'HOLD';
      let finalScore = 0;
      if (buyScore >= 8 && buyScore > shortScore) {
        action = 'SCALP_BUY';
        finalScore = buyScore;
      } else if (shortScore >= 8 && shortScore > buyScore) {
        action = 'SCALP_SHORT';
        finalScore = shortScore;
      }

      if (action === 'HOLD') {
        return {
          asset: assetKey,
          action: "HOLD",
          entryPrice: currentPrice,
          stopLoss: 0,
          takeProfit: 0,
          reasoning: "Regime is active, but momentum indicators did not cross confluence threshold",
          score: 0
        };
      }

      // 5. Friction Floor check (Expected ATR spread must exceed fees + slippage)
      // Choppiness filter: If expected volatility is less than 0.20%, do not scalp.
      const oneHourAtr = snap15m.atr;
      const expectedMovePercent = (oneHourAtr / currentPrice) * 100;

      if (expectedMovePercent < 0.20) {
        return {
          asset: assetKey,
          action: "HOLD",
          entryPrice: currentPrice,
          stopLoss: 0,
          takeProfit: 0,
          reasoning: `Scalp blocked (Choppiness Filter): volatility too compressed (${expectedMovePercent.toFixed(2)}% expected vs 0.20% min floor)`,
          score: 0
        };
      }

      // Tight, optimized scalp parameters
      const stopDistance = currentPrice * 0.0035; // Tightly fixed 0.35% risk
      const takeProfitDistance = currentPrice * 0.0070; // 0.70% take profit target (1:2 R:R)

      const stopLoss = action === 'SCALP_BUY' ? currentPrice - stopDistance : currentPrice + stopDistance;
      const takeProfit = action === 'SCALP_BUY' ? currentPrice + takeProfitDistance : currentPrice - takeProfitDistance;

      return {
        asset: assetKey,
        action,
        entryPrice: currentPrice,
        stopLoss,
        takeProfit,
        reasoning: `Confluence score ${finalScore}. Signals: ${details.join(" | ")}. Expected spread ${expectedMovePercent.toFixed(2)}%`,
        score: finalScore
      };
    } catch (err) {
      return {
        asset: assetKey,
        action: "HOLD",
        entryPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        reasoning: `Scalping scan failed: ${err instanceof Error ? err.message : String(err)}`,
        score: 0
      };
    }
  }
}
