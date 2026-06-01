import { getEnv } from "./env";
import { CompositeSignal, RiskParameters } from "./types";
import { getRedis } from "./redis";
import { Logger } from "./logger";

export class GeminiService {
  static async validateSignal(signal: CompositeSignal, risk: RiskParameters | null): Promise<{ confidence: number; reasoning: string }> {
    const env = getEnv();
    const redis = getRedis();
    const rateLimitKey = `ai:rate_limit:gemini`;
    
    // Check if we are currently rate limited
    const isRateLimited = await redis.get(rateLimitKey);
    if (isRateLimited) {
      if (signal.totalScore >= 60) {
        return { confidence: signal.confidence, reasoning: "AI rate limited. Exceptional math score bypassed LLM validation." };
      }
      return { confidence: Math.max(0, signal.confidence - 0.2), reasoning: "AI rate limited. Math score too low to bypass without LLM." };
    }

    try {
      // Set 45 second cooldown to protect Free Tier quotas
      await redis.set(rateLimitKey, "1", { ex: 45 });
      
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 15000);
      const prompt = `You are an elite quantitative trading analyst at a top-tier hedge fund. Review this algorithmic trading signal and provide your assessment.

SIGNAL DATA:
- Action: ${signal.action}
- Confluence Score: ${signal.totalScore}/100
- Market Regime: ${signal.regime}
- Confidence: ${(signal.confidence * 100).toFixed(1)}%

TIMEFRAME BREAKDOWN:
${signal.timeframes.map(tf => `${tf.timeframe}: ${tf.score}/${tf.maxScore} points`).join('\n')}

KEY INDICATORS (1H):
${JSON.stringify(signal.timeframes.find(t => t.timeframe === '1h')?.snapshot || {}, null, 2)}

${risk ? `RISK PARAMETERS:
- Position Size: $${risk.positionSizeUsd.toFixed(2)}
- Stop Loss: $${risk.stopLoss.toFixed(2)}
- Take Profit: $${risk.takeProfit.toFixed(2)}
- Risk/Reward: 1:${risk.riskRewardRatio.toFixed(1)}
- Kelly Fraction: ${(risk.halfKellyFraction * 100).toFixed(2)}%` : 'No position (HOLD signal)'}

Respond with ONLY a JSON object:
{"confidence_adjustment": <number -0.2 to +0.2>, "reasoning": "<1-2 sentence professional assessment>"}`;

      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        signal: controller.signal
      });
      clearTimeout(id);
      
      if (!res.ok) throw new Error("Gemini API Error");
      const data = await res.json();
      let text = data.candidates[0].content.parts[0].text;
      
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);
      
      const adjustment = typeof parsed.confidence_adjustment === 'number' ? parsed.confidence_adjustment : 0;
      const reasoning = parsed.reasoning || "AI validated.";
      
      let newConf = signal.confidence + adjustment;
      if (newConf < 0) newConf = 0;
      if (newConf > 1) newConf = 1;
      
      return { confidence: newConf, reasoning };
    } catch (e: any) {
      console.error("Gemini validation failed", e);
      if (e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED")) {
        // Enforce a longer 5-minute timeout if we actually hit the provider's hard rate limit
        await getRedis().set(`ai:rate_limit:gemini`, "1", { ex: 300 });
      }
      return { confidence: signal.confidence, reasoning: "AI validation unavailable. Using raw signal." };
    }
  }
}
