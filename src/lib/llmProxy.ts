import { z } from "zod";
import { getEnv } from "./env";
import { Logger } from "./logger";

export class LLMProxy {
  /**
   * Queries LLM providers with sequential failover (Gemini -> Groq -> OpenRouter)
   * and enforces strict Zod schema validation on the JSON output.
   */
  static async queryAndValidate<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    timeoutMs: number = 30000
  ): Promise<T> {
    const env = getEnv();

    const providers = [
      {
        name: "Gemini",
        key: env.GEMINI_API_KEY,
        fn: () => this.queryGemini(prompt, env.GEMINI_API_KEY!, timeoutMs)
      },
      {
        name: "Groq",
        key: env.GROQ_API_KEY,
        fn: () => this.queryGroq(prompt, env.GROQ_API_KEY!, timeoutMs)
      },
      {
        name: "OpenRouter",
        key: env.OPENROUTER_API_KEY,
        fn: () => this.queryOpenRouter(prompt, env.OPENROUTER_API_KEY!, timeoutMs)
      }
    ];

    let lastError = new Error("No LLM providers configured or available.");

    for (const provider of providers) {
      if (!provider.key) continue;

      try {
        const textOutput = await provider.fn();
        const parsedJson = JSON.parse(textOutput);
        
        // Zod validation acts as a strict schema gate
        const validatedData = schema.parse(parsedJson);
        
        return validatedData;
      } catch (err: any) {
        lastError = err;
        console.warn(`[LLMProxy] ${provider.name} failed:`, err.message);
        
        // If it was a rate limit or schema parsing error, seamlessly failover to the next provider.
        // We log the failover silently.
      }
    }

    // If all providers fail, throw the last error (triggering circuit breakers up the stack)
    throw lastError;
  }

  private static async queryGemini(prompt: string, apiKey: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json"
        }
      }),
      signal: controller.signal
    });

    clearTimeout(id);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty response from Gemini");
    return text.replace(/```json/g, "").replace(/```/g, "").trim();
  }

  private static async queryGroq(prompt: string, apiKey: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    // Using Llama 3.3 70B for strong reasoning capabilities
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    clearTimeout(id);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from Groq");
    return text.replace(/```json/g, "").replace(/```/g, "").trim();
  }

  private static async queryOpenRouter(prompt: string, apiKey: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://ai-quant-trader.duckdns.org",
        "X-Title": "AI Paper Trading Agent"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3-8b-instruct:free",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    clearTimeout(id);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from OpenRouter");
    return text.replace(/```json/g, "").replace(/```/g, "").trim();
  }
}
