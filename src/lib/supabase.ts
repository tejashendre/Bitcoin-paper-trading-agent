import { createClient } from '@supabase/supabase-js';
import { getEnv } from './env';
import { Logger } from './logger';

let supabaseClient: ReturnType<typeof createClient> | null = null;

export const getSupabase = () => {
    if (supabaseClient) return supabaseClient;

    const env = getEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
        throw new Error("Supabase is not configured. Missing SUPABASE_URL or SUPABASE_KEY in environment.");
    }

    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
    return supabaseClient;
};

export class SupabaseDatabase {
    /**
     * Persist a closed trade to the permanent ledger.
     */
    static async insertTrade(tradeData: any): Promise<boolean> {
        try {
            const sb = getSupabase();
            const { error } = await sb
                .from('trade_ledger')
                // @ts-ignore
                .insert([tradeData]);
            
            if (error) {
                console.error("[Supabase] Failed to insert trade:", error);
                return false;
            }
            return true;
        } catch (e) {
            console.warn("[Supabase] Skipping trade insert (not configured).");
            return false;
        }
    }

    /**
     * Persist a new optimized parameter reflection.
     */
    static async insertReflection(reflectionData: any): Promise<boolean> {
        try {
            const sb = getSupabase();
            const { error } = await sb
                .from('reflections')
                // @ts-ignore
                .insert([reflectionData as any]);

            if (error) {
                console.error("[Supabase] Failed to insert reflection:", error);
                return false;
            }
            return true;
        } catch (e) {
            console.warn("[Supabase] Skipping reflection insert (not configured).");
            return false;
        }
    }
}
