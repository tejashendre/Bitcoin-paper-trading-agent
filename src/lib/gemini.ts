import { getEnv } from "./env";
import { CompositeSignal, RiskParameters } from "./types";
import { getRedis } from "./redis";
import { Logger } from "./logger";

export class GeminiService {
  private static async validateWithGroq(prompt: string, apiKey: string): Promise<{ adjustment: number; reasoning: string }> {
    // Attempt with Groq's high-performance Llama 3.3 70B model
    const models = ["llama-3.3-70b-versatile", "llama3-8b-8192", "gemma2-9b-it"];
    let lastError: any = null;

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
        }

        const data = await res.json();
        let text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error("Empty response from Groq");

        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);

        const adjustment = typeof parsed.confidence_adjustment === 'number' ? parsed.confidence_adjustment : 0;
        const reasoning = parsed.reasoning || "Groq validated.";
        return { adjustment, reasoning };
      } catch (err: any) {
        lastError = err;
        console.warn(`Groq model ${model} failed, trying next...`, err);
      }
    }
    throw lastError || new Error("All Groq models failed");
  }

  private static async validateWithOpenRouter(prompt: string, apiKey: string): Promise<{ adjustment: number; reasoning: string }> {
    // OpenRouter Free Models
    const models = [
      "meta-llama/llama-3-8b-instruct:free",
      "google/gemma-2-9b-it:free",
      "qwen/qwen-2.5-72b-instruct:free"
    ];
    let lastError: any = null;

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://ai-quant-trader.duckdns.org",
            "X-Title": "AI Paper Trading Agent"
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
        }

        const data = await res.json();
        let text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error("Empty response from OpenRouter");

        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);

        const adjustment = typeof parsed.confidence_adjustment === 'number' ? parsed.confidence_adjustment : 0;
        const reasoning = parsed.reasoning || "OpenRouter validated.";
        return { adjustment, reasoning };
      } catch (err: any) {
        lastError = err;
        console.warn(`OpenRouter model ${model} failed, trying next...`, err);
      }
    }
    throw lastError || new Error("All OpenRouter models failed");
  }

  static async validateSignal(signal: CompositeSignal, risk: RiskParameters | null): Promise<{ confidence: number; reasoning: string }> {
    const env = getEnv();
    const redis = getRedis();
    const rateLimitKey = `ai:rate_limit:gemini`;

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

    // ── Primary: Gemini (if not rate limited) ────────────────────────
    const isRateLimited = await redis.get(rateLimitKey);
    if (!isRateLimited && env.GEMINI_API_KEY) {
      try {
        await redis.set(rateLimitKey, "1", { ex: 45 }); // Cooldown to protect free quota
        
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 12000);
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
        
        if (res.ok) {
          const data = await res.json();
          let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(text);
            const adjustment = typeof parsed.confidence_adjustment === 'number' ? parsed.confidence_adjustment : 0;
            const reasoning = parsed.reasoning || "Gemini validated.";
            let newConf = Math.min(1, Math.max(0, signal.confidence + adjustment));
            return { confidence: newConf, reasoning };
          }
        } else if (res.status === 429) {
          console.warn("Gemini 429 rate limit hit, flagging cooldown...");
          await redis.set(rateLimitKey, "1", { ex: 300 }); // Longer timeout
        }
      } catch (geminiErr) {
        console.warn("Gemini validation failed, moving to secondary fallbacks...", geminiErr);
      }
    }

    // ── Secondary: Groq (llama-3.3-70b-versatile free tier) ──────────
    if (env.GROQ_API_KEY) {
      try {
        const groqResult = await this.validateWithGroq(prompt, env.GROQ_API_KEY);
        await Logger.info(`AI Validation: Successfully validated via Groq fallback`);
        let newConf = Math.min(1, Math.max(0, signal.confidence + groqResult.adjustment));
        return { confidence: newConf, reasoning: groqResult.reasoning };
      } catch (groqErr) {
        console.warn("Groq validation failed, checking next option...", groqErr);
      }
    }

    // ── Tertiary: OpenRouter (meta-llama/llama-3-8b-instruct:free) ─────
    if (env.OPENROUTER_API_KEY) {
      try {
        const orResult = await this.validateWithOpenRouter(prompt, env.OPENROUTER_API_KEY);
        await Logger.info(`AI Validation: Successfully validated via OpenRouter fallback`);
        let newConf = Math.min(1, Math.max(0, signal.confidence + orResult.adjustment));
        return { confidence: newConf, reasoning: orResult.reasoning };
      } catch (orErr) {
        console.warn("OpenRouter validation failed...", orErr);
      }
    }

    // ── Quaternary Fallback: Mathematical Quant Model Bypass ─────────
    if (signal.totalScore >= 60) {
      return { confidence: signal.confidence, reasoning: "All LLM APIs unavailable. Exceptional math score bypassed LLM validation." };
    }
    return { confidence: Math.max(0, signal.confidence - 0.2), reasoning: "All LLM APIs rate limited. Math score too low to bypass without LLM." };
  }
}
