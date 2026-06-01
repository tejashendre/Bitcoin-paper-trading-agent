import { AgentCycleService } from "../lib/execution/agentCycle";
import { Logger } from "../lib/logger";
import { WebsocketDataMesh } from "./websocketDataMesh";

const CYCLE_INTERVAL_MS = 60000; // Run every 60 seconds

// Start WebSocket Mesh
const wsMesh = new WebsocketDataMesh();
wsMesh.start();

async function runDaemonLoop() {
  try {
    const cycleReport = await AgentCycleService.run();
    if (!cycleReport.success && cycleReport.lockStatus === 'BLOCKED') {
      // Normal behavior: another cycle (e.g. cron) is running
      console.log(`[Daemon] ${cycleReport.error}`);
    } else if (!cycleReport.success) {
      await Logger.error("Daemon cycle reported failure.", { error: cycleReport.error });
    }
  } catch (err) {
    console.error("[Daemon] Cycle failed with exception:", err);
  }
}

// Start the daemon loop
console.log("🚀 Starting Persistent Trading Daemon...");
runDaemonLoop(); // Initial run
setInterval(runDaemonLoop, CYCLE_INTERVAL_MS);
