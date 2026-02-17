/**
 * Perplexity API – Bitcoin market analysis.
 * Uses model "sonar". Strips markdown code blocks before JSON.parse to avoid crashes.
 */

export interface MarketAnalysis {
  price: number;
  sentiment: number;
  reason: string;
}

const MARKDOWN_JSON_BLOCK = /^```(?:json)?\s*\n?([\s\S]*?)```\s*$/m;

function stripMarkdownCodeBlocks(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(MARKDOWN_JSON_BLOCK);
  if (match !== null && match[1] != null) {
    return match[1].trim();
  }
  return trimmed.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
}

function parseAnalysis(content: string): MarketAnalysis {
  const cleaned = stripMarkdownCodeBlocks(content);
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse Perplexity JSON:", cleaned);
    throw new Error(`Perplexity response is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Perplexity response is not a JSON object");
  }

  const obj = data as Record<string, unknown>;
  const price = typeof obj.price === "number" ? obj.price : Number(obj.price);
  const sentiment = typeof obj.sentiment === "number" ? obj.sentiment : Number(obj.sentiment);
  const reason = typeof obj.reason === "string" ? obj.reason : String(obj.reason ?? "No reason provided");

  if (Number.isNaN(price) || price <= 0) {
    throw new Error("Invalid or missing price in Perplexity response");
  }

  // Clamp sentiment to 0-100
  const clampedSentiment = Math.max(0, Math.min(100, Number.isNaN(sentiment) ? 50 : sentiment));

  return { price, sentiment: clampedSentiment, reason };
}

/**
 * Fetches Bitcoin price and last 4h news sentiment from Perplexity.
 * Returns { price, sentiment (0–100), reason }.
 */
export async function getMarketAnalysis(): Promise<MarketAnalysis> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("Missing PERPLEXITY_API_KEY");
  }

  // Enhanced prompt to ensure JSON output
  const prompt = `Analyze current Bitcoin price and news from the last 4 hours.
  Return STRICTLY valid JSON with no markdown formatting.
  Format: { "price": number, "sentiment": number (0-100), "reason": string }
  Example: { "price": 45000, "sentiment": 75, "reason": "ETF approval rumors driving price up." }`;

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error("Perplexity request timed out after 15s");
    }
    throw new Error(`Perplexity request failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Perplexity API error ${res.status}: ${text.slice(0, 200)}`);
  }

  let body: { choices?: Array<{ message?: { content?: string } }> };
  try {
    body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  } catch {
    throw new Error("Perplexity response is not JSON");
  }

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Perplexity response missing choices[0].message.content");
  }

  return parseAnalysis(content);
}
