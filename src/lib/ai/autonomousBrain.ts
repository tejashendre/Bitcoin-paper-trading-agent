import { getEnv } from '@/lib/env';
import { MarketWorldModel, OpenPosition, BrainDecision, AutonomousDecision, Portfolio } from '@/lib/types';
import { getPredictionPerformanceSummary, savePredictionFromDecision } from './predictionLedger';
import { buildAutonomousPrompt } from './prompts/autonomousDecisionPrompt';
import { brainDecisionSchema } from './schemas';
import { AutonomousRiskGovernor } from './autonomousRiskGovernor';
import { LLMProxy } from '@/lib/llmProxy';
import { MarketService } from '@/lib/market';
import { computeAllIndicators, getLatestSnapshot } from '@/lib/indicators';

export class AutonomousBrain {
  /**
   * The core cognitive loop.
   * 1. Reads the world model
   * 2. Prompts Gemini 2.0 Flash
   * 3. Parses and validates the strict JSON output
   * 4. Passes the raw decision through the Risk Governor
   */
  static async evaluateMarket(
    worldModel: MarketWorldModel,
    portfolio: Portfolio,
    openPositions: OpenPosition[],
    recentLessons: string[] = [],
    btcWorldModel?: MarketWorldModel
  ): Promise<AutonomousDecision> {
    
    const predictionStats = await getPredictionPerformanceSummary();

    // 2. Query LLM & Validate (Failover Proxy with strict Zod parsing)
    let rawDecision: BrainDecision | null = null;
    let turnCount = 0;
    let requestedContext = '';

    while (turnCount < 2) {
      const prompt = buildAutonomousPrompt(
        worldModel,
        openPositions,
        portfolio.usd,
        recentLessons,
        predictionStats,
        requestedContext
      );

      try {
        rawDecision = await LLMProxy.queryAndValidate<BrainDecision>(prompt, brainDecisionSchema as any, 45000);
        
        if (rawDecision.action === 'REQUEST_DATA') {
          turnCount++;
          const timeframe = (rawDecision.dataRequest?.timeframe || '1d') as any;
          try {
            console.log(`[AutonomousBrain] AI requested deeper context: ${timeframe}`);
            const candles = await MarketService.getCandles(timeframe, 100, worldModel.asset);
            const series = computeAllIndicators(candles);
            const latest = getLatestSnapshot(candles, series);
            requestedContext = `Requested Timeframe (${timeframe}):\nClose: $${candles[candles.length - 1].close}\nRSI: ${latest.rsi.toFixed(2)}\nMACD: ${latest.macd.line.toFixed(2)}\nEMA 20: $${latest.ema21.toFixed(2)}\nATR: ${latest.atr.toFixed(2)}`;
          } catch (e: any) {
            requestedContext = `Failed to fetch data for ${timeframe}: ${e.message}`;
          }
          continue; // Loop back and query again
        } else {
          break; // Final decision reached
        }
      } catch (err: any) {
        console.error("[AutonomousBrain] Critical LLM failure:", err);
        // Fallback: Panic HOLD
        rawDecision = {
          action: 'HOLD',
          confidence: 0,
          conviction: 'LOW',
          thesis: `LLM parsing or network failure: ${err.message}. Defaulting to HOLD for safety.`,
          takeProfitPrice: null,
          stopLossPrice: null,
          suggestedSizeUsd: null,
          timeHorizon: 'DAY',
          expected15mDirection: 'SIDEWAYS',
          expected1hDirection: 'SIDEWAYS',
          expected4hDirection: 'SIDEWAYS',
        };
        break;
      }
    }

    if (!rawDecision || rawDecision.action === 'REQUEST_DATA') {
      rawDecision = {
        action: 'HOLD',
        confidence: 0,
        conviction: 'LOW',
        thesis: `AI stuck in data request loop. Defaulting to HOLD.`,
        takeProfitPrice: null,
        stopLossPrice: null,
        suggestedSizeUsd: null,
        timeHorizon: 'DAY',
        expected15mDirection: 'SIDEWAYS',
        expected1hDirection: 'SIDEWAYS',
        expected4hDirection: 'SIDEWAYS',
      };
    }

    // 4. Pass through Risk Governor
    const finalDecision = AutonomousRiskGovernor.enforceRiskLimits(
      rawDecision,
      worldModel,
      portfolio,
      predictionStats,
      undefined,
      btcWorldModel
    );

    // 5. Log prediction to ledger
    if (finalDecision.action !== 'HOLD') {
      // Don't await to avoid blocking the main execution path
      savePredictionFromDecision(finalDecision, worldModel.currentPrice).catch(console.error);
    }

    return finalDecision;
  }
}
