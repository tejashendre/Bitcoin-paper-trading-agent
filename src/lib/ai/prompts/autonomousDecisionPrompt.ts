import { MarketWorldModel, OpenPosition, PredictionPerformanceSummary } from '@/lib/types';
import { getTradingKnowledge } from '../tradingKnowledge';

export function buildAutonomousPrompt(
  worldModel: MarketWorldModel,
  openPositions: OpenPosition[],
  availableUsd: number,
  recentLessons: string[] = [],
  predictionStats?: PredictionPerformanceSummary
): string {
  const {
    asset,
    regime,
    directionalBias,
    biasScore,
    volatilityRegime,
    tradeability,
    priceZones,
    nearestSupport,
    nearestResistance,
    trendStrength,
    momentumScore,
    meanReversionSignal,
    dataQuality,
    sentimentScore,
    keyLevels,
  } = worldModel;

  const regimePrinciples = getTradingKnowledge(regime);
  
  const positionContext = openPositions.length > 0
    ? `CURRENT OPEN POSITIONS:\n${openPositions.map(p => `- ${p.direction} ${p.asset} at $${p.entryPrice} (Size: $${p.usdInvested})`).join('\n')}`
    : `CURRENT OPEN POSITIONS: None.`;

  const memoryContext = recentLessons.length > 0
    ? `PAST LESSONS (DO NOT REPEAT THESE MISTAKES):\n${recentLessons.map(l => `- ${l}`).join('\n')}`
    : `PAST LESSONS: No relevant recent memory.`;

  return `You are a sovereign, ruthless, and purely rational quantitative AI trading agent.
Your objective is absolute return. You do not gamble. You manage risk aggressively.

Here is the current state of the world for ${asset}:

=== ACCOUNT CONTEXT ===
Available USD: $${availableUsd.toFixed(2)}
${positionContext}

=== PREDICTION ACCOUNTABILITY ===
Total Accuracy: ${predictionStats ? (predictionStats.accuracy * 100).toFixed(1) : 0}%
Recent Correct: ${predictionStats?.recentCorrect ?? 0}
Recent Wrong: ${predictionStats?.recentWrong ?? 0}
(If your accuracy is below 50%, you must lower your confidence and trade less frequently)

=== DATA QUALITY ===
Feed Health Score: ${dataQuality}/100 (If < 50, do not trade)
Fear & Greed Sentiment: ${sentimentScore !== null ? sentimentScore : 'Unknown'}

=== MARKET WORLD MODEL ===
Regime: ${regime}
Volatility: ${volatilityRegime}
Directional Bias: ${directionalBias} (Score: ${biasScore})
Trend Strength: ${trendStrength}/100
Momentum Score: ${momentumScore} (-100 to +100)
Mean Reversion Signal: ${meanReversionSignal} (-100 to +100)
Tradeability Score: ${tradeability}/100

=== KEY LEVELS ===
${keyLevels.join('\n')}
Nearest Support: ${nearestSupport ? '$' + nearestSupport : 'None'}
Nearest Resistance: ${nearestResistance ? '$' + nearestResistance : 'None'}

=== AI TRADING KNOWLEDGE ===
${regimePrinciples}

=== ${memoryContext} ===

INSTRUCTIONS:
1. Synthesize this data. Decide if a trade is warranted.
2. If tradeability is low (< 50) or data quality is bad (< 50), return HOLD.
3. If you have an open position, evaluate if you should CLOSE it (SELL to close long, COVER to close short) based on momentum/resistance/support.
4. If you enter a trade (BUY or SHORT), you MUST provide a logical Take Profit and Stop Loss based on the Nearest Support/Resistance levels.
5. If entering, suggest a position size in USD based on conviction (Max $10,000 usually, adjust down for low conviction).
6. Return your decision as a strict JSON object matching the requested schema.`;
}
