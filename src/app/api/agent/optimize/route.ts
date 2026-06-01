import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { HyperbolicTimeChamber } from '@/lib/ai/hyperbolicTimeChamber';

export const maxDuration = 30; // Vercel timeout
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const env = getEnv();
    
    // Read authorization credentials from the Authorization header
    const authHeader = req.headers.get('authorization');
    let token = searchParams.get('token');
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // In a real cron, use a secure header or pre-shared key. 
    // For Vercel cron, we can use CRON_SECRET if configured.
    if (token !== env.ADMIN_SECRET && token !== env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const start = Date.now();
    
    // Run the optimization simulation
    const optimizedParams = await HyperbolicTimeChamber.runOptimization();
    
    const duration = Date.now() - start;

    return NextResponse.json({
      success: true,
      message: "Hyperbolic Time Chamber optimization complete.",
      optimizedParams,
      durationMs: duration
    });
  } catch (error: any) {
    console.error("[Optimize Route] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
