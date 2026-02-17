import axios from "axios";
import { env } from "./env";
import { Logger } from "./logger";

export interface SentimentResult {
    score: number; // 1-10
    sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    reasoning: string;
}

export class PerplexityService {
    private static readonly API_URL = "https://api.perplexity.ai/chat/completions";

    static async analyzeSentiment(): Promise<SentimentResult> {
        try {
            await Logger.info("Fetching market sentiment from Perplexity...");

            const response = await axios.post(
                this.API_URL,
                {
                    model: "sonar-reasoning", // or sonar-pro, depending on availability
                    messages: [
                        {
                            role: "system",
                            content: `You are a crypto market analyst. Analyze the current Bitcoin market sentiment based on recent news.
              Return a JSON object ONLY: { "score": number (1-10, 10 is very bullish), "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL", "reasoning": "short summary" }.
              Do not include markdown formatting.`
                        },
                        {
                            role: "user",
                            content: "What is the current Bitcoin market sentiment?"
                        }
                    ],
                    temperature: 0.2
                },
                {
                    headers: {
                        Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 20000 // 20s timeout
                }
            );

            const content = response.data.choices[0]?.message?.content;
            if (!content) throw new Error("Empty response from Perplexity");

            // Clean and parse JSON
            const jsonStr = content.replace(/```json/g, "").replace(/```/g, "").trim();
            const result = JSON.parse(jsonStr) as SentimentResult;

            // Validate range
            if (result.score < 1) result.score = 1;
            if (result.score > 10) result.score = 10;

            await Logger.info(`Sentiment Analysis Complete: ${result.sentiment} (${result.score}/10)`, result);
            return result;

        } catch (error) {
            await Logger.error("Perplexity Analysis Failed", { error: String(error) });
            // Fallback to NEUTRAL to prevent crash, but log error
            return {
                score: 5,
                sentiment: "NEUTRAL",
                reasoning: "Error fetching sentiment. Defaulting to Neutral."
            };
        }
    }
}
