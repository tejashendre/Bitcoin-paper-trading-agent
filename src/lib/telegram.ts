/**
 * Telegram Bot API – send trade alerts to TELEGRAM_CHAT_ID.
 * Uses MarkdownV2 for formatted messages.
 */

function getTelegramConfig(): { botToken: string; chatId: string } | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken?.trim() || !chatId?.trim()) {
    return null;
  }
  return { botToken: botToken.trim(), chatId: chatId.trim() };
}

/**
 * Escape special characters for Telegram MarkdownV2.
 * Characters to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

/**
 * Sends a plain-text alert message to the configured Telegram chat.
 * No-op if TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.
 */
export async function sendAlert(message: string, parseMode: "MarkdownV2" | undefined = "MarkdownV2"): Promise<void> {
  const config = getTelegramConfig();
  if (!config) {
    console.warn("Telegram credentials missing – skipping notification.");
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Telegram API error ${res.status}: ${errText}`);
    } else {
      console.log("Telegram alert sent successfully.");
    }
  } catch (e) {
    console.error(
      "Telegram sendAlert failed:",
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Sends a formatted trade alert with all details.
 */
export async function sendTradeAlert(params: {
  action: "BUY" | "SELL";
  price: number;
  sentiment: number;
  reason: string;
  btcAmount: number;
  newUsd: number;
  newBtc: number;
}): Promise<void> {
  const emoji = params.action === "BUY" ? "🟢" : "🔴";

  // Escape all dynamic values for MarkdownV2
  const action = escapeMarkdownV2(params.action);
  const price = escapeMarkdownV2(`$${params.price.toFixed(2)}`);
  const sentiment = escapeMarkdownV2(`${params.sentiment}/100`);
  const reason = escapeMarkdownV2(params.reason);
  const btcAmount = escapeMarkdownV2(params.btcAmount.toFixed(6));
  const newUsd = escapeMarkdownV2(`$${params.newUsd.toFixed(2)}`);
  const newBtc = escapeMarkdownV2(params.newBtc.toFixed(6));

  const message = [
    `${emoji} *TRADE EXECUTED: ${action}*`,
    ``,
    `Price: ${price}`,
    `Sentiment: ${sentiment}`,
    `Reason: ${reason}`,
    `BTC Amount: ${btcAmount}`,
    ``,
    `New USD Balance: ${newUsd}`,
    `New BTC Balance: ${newBtc}`,
  ].join("\n");

  await sendAlert(message, "MarkdownV2");
}
