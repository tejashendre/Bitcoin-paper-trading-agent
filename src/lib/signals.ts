import { CompositeSignal, TimeframeSignal, SignalComponent, Timeframe, Candle } from "@/lib/types";
import { MarketService } from "./market";
import {
  computeAllIndicators,
  getLatestSnapshot,
  detectPatterns,
  detectMarketStructure,
  detectFairValueGap,
  detectDivergence
} from "./indicators";
import { computeStatistics } from "./statistics";
import { ReflectionEngine } from "./memory/reflectionEngine";
import { DynamicParameters } from "./types";
import { HyperbolicTimeChamber } from "./ai/hyperbolicTimeChamber";

export class SignalEngine {
  static async analyze(assetKey: string = "BTC"): Promise<CompositeSignal> {
    const dynParams: DynamicParameters = await HyperbolicTimeChamber.getOptimizedParameters();

    const timeframes: Timeframe[] = ["4h", "1h", "15m", "5m"];
    const results = await Promise.all(timeframes.map(tf => this.analyzeTimeframe(tf, assetKey, dynParams)));
    
    let totalScore = 0;
    let maxPossibleScore = 0;
    for (const res of results) {
      totalScore += res.score;
      maxPossibleScore += res.maxScore;
    }

    const oneHour = results.find(r => r.timeframe === "1h");
    const regime = oneHour ? oneHour.statistics.regime : "RANDOM";

    // Dynamic Regime Allocation (Hedge-fund style regime switching)
    if (regime === "MEAN_REVERTING") {
      // Invert score since mean-reverting markets behave opposite to trend following
      totalScore = -totalScore;
    } else if (regime === "RANDOM") {
      // Scale down confidence due to lack of statistical edge
      totalScore = totalScore * 0.4;
    }

    // Scale raw totalScore dynamically to [-100, 100] range based on max possible score
    const scaledScore = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;

    // Convert from [-100, 100] to [0, 100] for confidence, and determine action
    let action: 'BUY' | 'SELL' | 'SHORT' | 'COVER' | 'HOLD' = 'HOLD';
    let normalizedScore = 50 + (scaledScore / 2);

    if (scaledScore >= 12) {
      action = 'BUY';
      normalizedScore = Math.min(100, 50 + (scaledScore / 2));
    } else if (scaledScore <= -12) {
      action = 'SHORT';
      normalizedScore = Math.min(100, 50 + (Math.abs(scaledScore) / 2));
    } else if (scaledScore <= -6) {
      action = 'SELL';  // Close any existing long positions
      normalizedScore = Math.min(100, 50 + (Math.abs(scaledScore) / 2));
    } else if (scaledScore >= 6) {
      action = 'COVER'; // Close any existing short positions
      normalizedScore = Math.min(100, 50 + (scaledScore / 2));
    } else {
      action = 'HOLD';
      normalizedScore = 50;
    }

    const reasoning = `Regime is ${regime}. Raw Ensemble Score: ${totalScore.toFixed(1)} / ${maxPossibleScore} (${scaledScore.toFixed(1)}%).`;

    return {
      totalScore: normalizedScore,
      action,
      confidence: normalizedScore / 100,
      regime,
      timeframes: results,
      reasoning,
      timestamp: new Date().toISOString()
    };
  }

  private static async analyzeTimeframe(tf: Timeframe, assetKey: string, dynParams: DynamicParameters): Promise<TimeframeSignal> {
    const limit = tf === "4h" ? 200 : tf === "1h" ? 200 : 100;
    const candles = await MarketService.getCandles(tf, limit, assetKey);
    const indicators = computeAllIndicators(candles);
    const snapshot = getLatestSnapshot(candles, indicators);
    const stats = computeStatistics(candles, snapshot, indicators.atr);
    const patterns = detectPatterns(candles);

    let score = 0;
    let maxScore = 0;
    const components: SignalComponent[] = [];

    const addComp = (name: string, pts: number, maxPts: number, fired: boolean, desc: string) => {
      score += pts;
      maxScore += maxPts;
      components.push({ name, score: pts, maxScore: maxPts, fired, description: desc });
    };

    const price = snapshot.price;

    if (tf === "4h") {
      maxScore = 38; // Increased from 30 to include Price Action & Market Structure
      // 1. Trend Following Stack (Momentum Strategy)
      const c1 = price > snapshot.ema50;
      addComp("EMA50", c1 ? 8 : (price < snapshot.ema50 ? -8 : 0), 8, c1, "Price vs EMA50");
      
      const c2 = snapshot.ema9 > snapshot.ema21 && snapshot.ema21 > snapshot.ema50;
      addComp("EMA Stack", c2 ? 7 : -7, 7, c2, "EMA alignment");

      const c3 = snapshot.macd.line > snapshot.macd.signal;
      addComp("MACD", c3 ? 8 : -8, 8, c3, "MACD Line > Signal");

      const c4 = stats.regressionR2 > 0.4 && stats.regressionSlope > 0;
      addComp("Linear Regression", c4 ? 7 : -7, 7, c4, "OLS Trend Line");

      // Market Structure Pivot Analysis
      const struct = detectMarketStructure(candles);
      const isBullishStruct = struct.structure === 'HH' || struct.structure === 'HL';
      const isBearishStruct = struct.structure === 'LH' || struct.structure === 'LL';
      addComp("SMC Structure", isBullishStruct ? 3 : (isBearishStruct ? -3 : 0), 3, isBullishStruct, `Market Structure: ${struct.structure || 'Unknown'}`);

      const hasBullishBos = struct.bos === 'BULLISH';
      const hasBearishBos = struct.bos === 'BEARISH';
      addComp("BOS Breakout", hasBullishBos ? 5 : (hasBearishBos ? -5 : 0), 5, hasBullishBos, `Break of Structure (BOS): ${struct.bos || 'None'}`);

    } else if (tf === "1h") {
      maxScore = 40; // Increased from 30 to include FVG imbalances and RSI Divergences
      // 2. Mean Reversion Stack (Z-Score & RSI extremes)
      const c1 = snapshot.rsi >= dynParams.rsiOversold && snapshot.rsi <= dynParams.rsiOverbought;
      addComp("RSI Momentum", c1 ? 7 : (snapshot.rsi < dynParams.rsiOversold ? -7 : -7), 7, c1, "RSI Healthy Zone");

      const c2 = price > snapshot.vwap;
      addComp("VWAP Anchor", c2 ? 6 : -6, 6, c2, "Price vs Volume Anchor");

      const c3 = stats.volatilityPercentile < 25;
      addComp("Volatility Squeeze", c3 ? 7 : 0, 7, c3, "BB Squeeze detection");

      const c4 = snapshot.macd.histogram > dynParams.macdHistogramMin;
      addComp("MACD Hist", c4 ? 5 : -5, 5, c4, "MACD Momentum Shift");

      const c5 = stats.volumePercentile > 60;
      addComp("Institutional Vol", c5 ? 5 : -5, 5, c5, "Volume Aggression");

      // Fair Value Gap Imbalance Check
      const fvgInfo = detectFairValueGap(candles);
      const hasBullishFvg = fvgInfo.fvg === 'BULLISH';
      const hasBearishFvg = fvgInfo.fvg === 'BEARISH';
      addComp("SMC Imbalance (FVG)", hasBullishFvg ? 5 : (hasBearishFvg ? -5 : 0), 5, hasBullishFvg, `Fair Value Gap: ${fvgInfo.fvg || 'None'} (Size: $${fvgInfo.gapSize.toFixed(2)})`);

      // RSI Divergence Check
      const divInfo = detectDivergence(candles, indicators.rsi);
      const hasBullDiv = divInfo.divergence === 'BULLISH';
      const hasBearDiv = divInfo.divergence === 'BEARISH';
      addComp("RSI Divergence", hasBullDiv ? 5 : (hasBearDiv ? -5 : 0), 5, hasBullDiv, divInfo.description || "No Divergence");

    } else if (tf === "15m") {
      maxScore = 25;
      // 3. Short Term Multi-Indicator Confluence
      const c1 = snapshot.rsi > 50; 
      addComp("RSI Bullish", c1 ? 8 : -8, 8, c1, "RSI > 50");

      const c2 = snapshot.macd.histogram > 0;
      addComp("MACD Fast", c2 ? 7 : -7, 7, c2, "MACD Fast Positive");

      const c3 = price > snapshot.ema21;
      addComp("EMA21 Support", c3 ? 5 : -5, 5, c3, "Short Term Support");

      const c4 = snapshot.stochRsi.k > snapshot.stochRsi.d;
      addComp("StochRSI Crossover", c4 ? 5 : -5, 5, c4, "StochRSI Fast Momentum");

    } else if (tf === "5m") {
      maxScore = 25;
      // 4. Volume Spread Analysis & Microstructure Candlestick Patterns
      let hasBullPattern = patterns.some(p => p.bullish);
      let hasBearPattern = patterns.some(p => !p.bullish);
      addComp("Micro Pattern", hasBullPattern ? 8 : (hasBearPattern ? -8 : 0), 8, hasBullPattern, "Candlestick Action");

      // VSA (Volume Spread Analysis) volume spike filter
      const avgVolume20 = candles.length > 20 
        ? candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20 
        : 0;
      const c2 = candles.length > 0 && candles[candles.length - 1].volume > avgVolume20 * 1.6;
      addComp("VSA Spike", c2 ? 7 : -7, 7, c2, "Volume Climactic Action");

      // Institutional Orderbook Imbalance (L2 Depth)
      const depth = await MarketService.getOrderbookImbalance(assetKey);
      addComp("Orderbook Imbalance", depth.isBullish ? 10 : (depth.isBearish ? -10 : 0), 10, depth.isBullish, `L2 Depth Ratio: ${depth.imbalanceRatio.toFixed(1)}x`);
    }

    return {
      timeframe: tf,
      score,
      maxScore,
      components,
      snapshot,
      statistics: stats,
      patterns
    };
  }
}
