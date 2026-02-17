import axios from "axios";
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
            const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
            await axios.post(url, {
                chat_id: env.TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: "MarkdownV2",
            });
        } catch (error: unknown) {
            // Log but never throw — notifications should not crash the bot.
            const msg = error instanceof Error ? error.message : String(error);
            await Logger.error("Failed to send Telegram alert", { error: msg });
        }
    }

    static async sendTradeAlert(
        action: "BUY" | "SELL" | "HOLD",
        amount: number,
        price: number,
        reason: string,
        portfolioValue: number
    ) {
        const icon = action === "BUY" ? "🟢" : action === "SELL" ? "🔴" : "⚪";
        const esc = this.escapeMarkdown;

        const message = [
            `${icon} *${esc(action)} ALERT*`,
            ``,
            `*Price*: ${esc("$" + price.toLocaleString("en-US"))}`,
            `*Amount*: ${esc(amount.toFixed(6))} BTC`,
            `*Reason*: ${esc(reason)}`,
            ``,
            `*Portfolio Value*: ${esc("$" + portfolioValue.toLocaleString("en-US"))}`,
        ].join("\n");

        await this.sendAlert(message);
    }
}
