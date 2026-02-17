import axios from "axios";
import { getEnv } from "./env";
import { Logger } from "./logger";

export interface SentimentResult {
    score: number; // 1-10
    sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    reasoning: string;
}

export class PerplexityService {
    private static readonly API_URL = "https://api.perplexity.ai/chat/completions";

    /**
     * Extract JSON from a string that may contain markdown, thinking tokens, or extra text.
     */
    private static extractJSON(text: string): string {
        // Try to find JSON between code fences first
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) return fenceMatch[1].trim();

        // Try to find a JSON object directly
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return jsonMatch[0];

        return text.trim();
    }

    static async analyzeSentiment(): Promise<SentimentResult> {
        try {
            await Logger.info("Fetching market sentiment from Perplexity...");
            const env = getEnv();

            const response = await axios.post(
                this.API_URL,
                {
                    model: "sonar",
                    messages: [
                        {
                            role: "system",
                            content:
                                'You are a crypto market analyst. Analyze the current Bitcoin (BTC) market sentiment based on recent news, social media, and market data. Respond with ONLY a JSON object in this exact format, no other text: {"score": <number 1-10 where 10 is very bullish>, "sentiment": "<BULLISH|BEARISH|NEUTRAL>", "reasoning": "<one sentence summary>"}',
                        },
                        {
                            role: "user",
                            content: "What is the current Bitcoin market sentiment? Respond ONLY with JSON.",
                        },
                    ],
                    temperature: 0.1,
                },
                {
                    headers: {
                        Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 25000, // 25s timeout
                }
            );

            const content = response.data?.choices?.[0]?.message?.content;
            if (!content) throw new Error("Empty response from Perplexity");

            await Logger.info("Raw Perplexity response received", { content: content.substring(0, 200) });

            // Extract and parse JSON robustly
            const jsonStr = this.extractJSON(content);
            const parsed = JSON.parse(jsonStr);

            // Validate and normalize
            const result: SentimentResult = {
                score: Math.min(10, Math.max(1, Number(parsed.score) || 5)),
                sentiment: ["BULLISH", "BEARISH", "NEUTRAL"].includes(parsed.sentiment)
                    ? parsed.sentiment
                    : "NEUTRAL",
                reasoning: String(parsed.reasoning || "No reasoning provided."),
            };

            await Logger.info(
                `Sentiment: ${result.sentiment} (${result.score}/10) — ${result.reasoning}`
            );
            return result;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            await Logger.error("Perplexity Analysis Failed", { error: msg });

            // Return neutral fallback — NEVER crash the trading run
            return {
                score: 5,
                sentiment: "NEUTRAL",
                reasoning: `Analysis error: ${msg}. Defaulting to Neutral.`,
            };
        }
    }
}
