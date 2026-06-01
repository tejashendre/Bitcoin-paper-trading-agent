import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { AgentCycleService } from "@/lib/execution/agentCycle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleCycle(request: Request) {
  const auth = verifyAuth(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  try {
    const cycleReport = await AgentCycleService.run();
    
    if (!cycleReport.success && cycleReport.lockStatus === 'BLOCKED') {
      return NextResponse.json({
        success: false,
        error: cycleReport.error,
      }, { status: 409 });
    }

    return NextResponse.json(cycleReport);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) { return handleCycle(request); }
export async function POST(request: Request) { return handleCycle(request); }
