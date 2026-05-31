import { getEnv } from '@/lib/env';
import { MarketWorldModel, OpenPosition, BrainDecision, AutonomousDecision, Portfolio } from '@/lib/types';
import { getPredictionPerformanceSummary, savePredictionFromDecision } from './predictionLedger';
import { buildAutonomousPrompt } from './prompts/autonomousDecisionPrompt';
import { brainDecisionSchema } from './schemas';
import { AutonomousRiskGovernor } from './autonomousRiskGovernor';

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

    // 1. Build the prompt
    const prompt = buildAutonomousPrompt(
      worldModel,
      openPositions,
      portfolio.usd,
      recentLessons,
      predictionStats
    );

    // 2. Query LLM
    let rawDecision: BrainDecision;
    try {
      const llmOutput = await this.queryGemini(prompt);
      
      // 3. Validate output against Schema
      const parsed = JSON.parse(llmOutput);
      rawDecision = brainDecisionSchema.parse(parsed) as BrainDecision;
      
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

  private static async queryGemini(prompt: string): Promise<string> {
    const env = getEnv();
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 35000); // 35s timeout
    
    // Using Gemini 2.0 Flash with JSON mode
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json",
        }
      }),
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API HTTP ${res.status}: ${errorText}`);
    }
    
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
  }
}
