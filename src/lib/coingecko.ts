import axios from "axios";
import { Logger } from "./logger";

export class PriceService {
    static async getBitcoinPrice(): Promise<number> {
        try {
            // Use CoinGecko simple price API (no key needed for low volume)
            const response = await axios.get(
                "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
                { timeout: 10000 }
            );

            const price = response.data?.bitcoin?.usd;
            if (!price) throw new Error("Invalid price data from CoinGecko");

            // await Logger.info(`Fetched BTC Price: $${price}`); // Detailed logging only if needed
            return price;
        } catch (error) {
            await Logger.error("Failed to fetch Bitcoin price", { error: String(error) });
            throw error; // Propagate error because we can't trade without price
        }
    }
}
