import axios from "axios";
import { env } from "./env";
import { Logger } from "./logger";

export class TelegramService {
    private static readonly API_URL = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    // Escape special characters for MarkdownV2
    static escapeMarkdown(text: string): string {
        return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
    }

    static async sendAlert(message: string): Promise<void> {
        try {
            await axios.post(this.API_URL, {
                chat_id: env.TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: "MarkdownV2",
            });
            // await Logger.info("Telegram alert sent");
        } catch (error) {
            await Logger.error("Failed to send Telegram alert", { error: String(error) });
            // Don't throw, just log. Notifications shouldn't crash the bot.
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
        const escapedAction = this.escapeMarkdown(action);
        const escapedAmount = this.escapeMarkdown(amount.toFixed(6));
        const escapedPrice = this.escapeMarkdown(`$${price.toLocaleString()}`);
        const escapedReason = this.escapeMarkdown(reason);
        const escapedValue = this.escapeMarkdown(`$${portfolioValue.toLocaleString()}`);

        const message = `
${icon} *${escapedAction} ALERT*

*Price*: ${escapedPrice}
*Amount*: ${escapedAmount} BTC
*Reason*: ${escapedReason}

*Portfolio Value*: ${escapedValue}
    `;

        await this.sendAlert(message.trim());
    }
}
