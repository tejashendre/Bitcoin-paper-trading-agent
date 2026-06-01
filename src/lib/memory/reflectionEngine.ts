import { getEnv } from '@/lib/env';
import { TradeLedger } from './tradeLedger';
import { ReflectionSummary } from '@/lib/types';
import { getRedis } from '@/lib/redis';
import { z } from 'zod';
import { LLMProxy } from '@/lib/llmProxy';

const reflectionSchema = z.object({
  topMistake: z.string(),
  actionableRule: z.string(),
  optimizedParameters: z.object({
    rsiOverbought: z.number(),
    rsiOversold: z.number(),
    macdHistogramMin: z.number(),
    stochRsiOverbought: z.number(),
    stochRsiOversold: z.number(),
    vwapDeviationPercent: z.number()
  }).optional()
});

export class ReflectionEngine {
  private static readonly REFLECTION_KEY = 'ai:recent_reflection';

  /**
   * Reviews the last 20 trades. If win rate is low, the AI writes a new
   * actionable rule to avoid repeating mistakes. This rule is injected
   * back into the autonomous brain's prompt.
   */
  static async runReflectionCycle(): Promise<ReflectionSummary | null> {
    const recentTrades = await TradeLedger.getRecentTrades(20);
    if (recentTrades.length < 5) return null; // Not enough data to reflect

    const wins = recentTrades.filter(t => t.wasPredictionCorrect).length;
    const winRate = wins / recentTrades.length;

    // If we're crushing it, no need to reflect too hard
    if (winRate > 0.6) {
      return null;
    }

    const env = getEnv();
    const prompt = `You are a quantitative trading supervisor. Your AI agent has a recent win rate of ${(winRate * 100).toFixed(1)}%.
    
Here are the recent losing trades:
${JSON.stringify(recentTrades.filter(t => !t.wasPredictionCorrect), null, 2)}

Analyze these losses. Find the common denominator. Are the technical indicator thresholds too loose?
Output ONLY a strict JSON object with:
{
  "topMistake": "Brief 1 sentence description of the main error",
  "actionableRule": "A strict imperative rule to inject into future prompts to stop this.",
  "optimizedParameters": {
    "rsiOverbought": 65,
    "rsiOversold": 40,
    "macdHistogramMin": 0,
    "stochRsiOverbought": 85,
    "stochRsiOversold": 15,
    "vwapDeviationPercent": 0.5
  }
}
Adjust the parameters strictly between reasonable technical limits.`;

    try {
      const result = await LLMProxy.queryAndValidate(prompt, reflectionSchema, 20000);

      const summary: ReflectionSummary = {
        timestamp: new Date().toISOString(),
        tradesAnalyzed: recentTrades.length,
        winRate,
        topMistake: result.topMistake || "Unknown error",
        actionableRule: result.actionableRule || "Be more careful.",
        optimizedParameters: result.optimizedParameters
      };

      // Save to Redis so the Brain can read it on the next loop
      const redis = getRedis();
      await redis.set(this.REFLECTION_KEY, JSON.stringify(summary));

      return summary;
    } catch (e) {
      console.error("[ReflectionEngine] Failed to run reflection:", e);
      return null;
    }
  }

  static async getLatestReflection(): Promise<ReflectionSummary | null> {
    const redis = getRedis();
    const data = await redis.get(this.REFLECTION_KEY);
    if (!data) return null;
    try {
      return (typeof data === 'string' ? JSON.parse(data) : data) as ReflectionSummary;
    } catch (e) {
      return null;
    }
  }
}
