import * as ccxt from 'ccxt';
import { Logger } from '../logger';
import { getEnv } from '../env';
import { Portfolio, Trade } from '../types';

export class LiveExchange {
    private static binanceClient: ccxt.binance | null = null;
    private static bybitClient: ccxt.bybit | null = null;
    private static isInitialized = false;

    private static init() {
        if (this.isInitialized) return;
        const env = getEnv();

        if (env.BINANCE_API_KEY && env.BINANCE_API_SECRET) {
            this.binanceClient = new ccxt.binance({
                apiKey: env.BINANCE_API_KEY,
                secret: env.BINANCE_API_SECRET,
                enableRateLimit: true,
                options: { defaultType: 'future' }
            });
            // If testnet:
            // this.binanceClient.setSandboxMode(true);
        }

        if (env.BYBIT_API_KEY && env.BYBIT_API_SECRET) {
            this.bybitClient = new ccxt.bybit({
                apiKey: env.BYBIT_API_KEY,
                secret: env.BYBIT_API_SECRET,
                enableRateLimit: true,
                options: { defaultType: 'future' }
            });
            // If testnet:
            // this.bybitClient.setSandboxMode(true);
        }

        this.isInitialized = true;
    }

    /**
     * Executes a real market order on the designated exchange.
     */
    public static async executeTrade(
        exchange: 'BINANCE' | 'BYBIT',
        asset: string,
        direction: 'LONG' | 'SHORT',
        action: 'BUY' | 'SELL' | 'SHORT' | 'COVER' | 'SCALP_BUY' | 'SCALP_SHORT' | 'SCALP_SELL' | 'SCALP_COVER',
        amount: number, // asset amount (e.g. BTC)
        currentPrice: number
    ): Promise<{ success: boolean; executedPrice?: number; feeUsd?: number; orderId?: string; error?: string }> {
        this.init();

        try {
            const client = exchange === 'BINANCE' ? this.binanceClient : this.bybitClient;
            if (!client) {
                return { success: false, error: `${exchange} API keys not configured.` };
            }

            const symbol = `${asset}/USDT:USDT`;
            
            // CCXT Market Order Side logic:
            // Opening Long -> buy
            // Closing Long -> sell
            // Opening Short -> sell
            // Closing Short -> buy
            
            let side: 'buy' | 'sell';
            if (action.includes('BUY') || action === 'COVER') {
                side = 'buy';
            } else {
                side = 'sell';
            }

            // In production HFT, you might use limit orders to save fees. We use market for guaranteed fills on paper.
            // For live, we stick to market but should upgrade to limit chasing later.
            await Logger.info(`🚀 [LIVE EXECUTION] Routing ${side.toUpperCase()} ${amount.toFixed(6)} ${symbol} to ${exchange}...`);

            const order = await client.createMarketOrder(symbol, side, amount);

            const executedPrice = order.average || order.price || currentPrice;
            let feeUsd = 0;
            if (order.fee && order.fee.cost) {
                feeUsd = order.fee.cost;
            } else {
                // Estimate taker fee if not provided (Binance is ~0.04%, Bybit is ~0.05%)
                const feeRate = exchange === 'BINANCE' ? 0.0004 : 0.0005;
                feeUsd = (amount * executedPrice) * feeRate;
            }

            await Logger.info(`✅ [LIVE EXECUTION] ${exchange} Filled at $${executedPrice.toFixed(2)} (Fee: $${feeUsd.toFixed(4)})`);

            return {
                success: true,
                executedPrice,
                feeUsd,
                orderId: order.id
            };

        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await Logger.error(`❌ [LIVE EXECUTION] ${exchange} Error: ${msg}`);
            return { success: false, error: msg };
        }
    }
}
