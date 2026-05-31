import { getEnv } from "./env";
import { Logger } from "./logger";

export class TelegramService {
    // Escape special characters for Telegram MarkdownV2
    static escapeMarkdown(text: string): string {
        return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
    }

    static async sendAlert(message: string): Promise<void> {
        try {
            const env = getEnv();
            if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
                console.warn("Telegram bot token or chat ID is missing. Skipping notification.");
                return;
            }
            const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
            await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: env.TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: "MarkdownV2",
                }),
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            await Logger.error("Failed to send Telegram alert", { error: msg });
        }
    }

    static async sendTradeAlert(
        action: string,
        amount: number,
        price: number,
        reason: string,
        portfolioValue: number,
        signalScore?: number,
        sl?: number,
        tp?: number,
        assetKey: string = "BTC"
    ) {
        const icon = action === "BUY" ? "🟢" : action === "SELL" ? "🔴" : "⚪";
        const esc = this.escapeMarkdown;

        const message = [
            `${icon} *${esc(action)} ALERT \\- ${esc(assetKey)}*`,
            ``,
            `*Price*: ${esc(price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 }))}`,
            `*Amount*: ${esc(amount.toLocaleString("en-US", { maximumFractionDigits: 6 }))} ${esc(assetKey)}`,
            `*Reason*: ${esc(reason)}`,
            signalScore ? `*Signal Score*: ${esc(signalScore.toString())}/100` : "",
            sl ? `*Stop Loss*: ${esc(sl.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 }))}` : "",
            tp ? `*Take Profit*: ${esc(tp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 }))}` : "",
            ``,
            `*Portfolio PnL Value*: ${esc("$" + portfolioValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}`,
        ].filter(Boolean).join("\n");

        await this.sendAlert(message);
    }
}
