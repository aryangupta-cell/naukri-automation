import { appendLog, setWorkerStatus } from "./google/jobs.js";
import { sleep } from "./utils/sleep.js";
import type { RowStatus } from "./domain/statuses.js";
import type { RunStage } from "./domain/types.js";

/** Ctrl+C once: stop cleanly before the next candidate. Twice: force exit. */
export interface StopController {
  isStopRequested(): boolean;
  reset(): void;
}

export function installStopHandler(): StopController {
  let stopRequested = false;
  process.on("SIGINT", () => {
    if (stopRequested) {
      console.log("\nForce exiting.");
      process.exit(1);
    }
    stopRequested = true;
    console.log("\nStop requested - finishing the current candidate, then halting this run. Press Ctrl+C again to force exit.");
  });
  return {
    isStopRequested: () => stopRequested,
    reset: () => {
      stopRequested = false;
    },
  };
}

export function tally(counts: Record<string, number>, status: RowStatus): void {
  counts[status] = (counts[status] ?? 0) + 1;
}

export function summarize(processed: number, counts: Record<string, number>): string {
  return (
    `${processed} rows processed - ` +
    Object.entries(counts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")
  );
}

/** Writes the run's terminal status to B5, briefly, then returns the sheet to READY for the next trigger. */
export async function finishRun(
  runId: string,
  kind: "Completed" | "Failed" | "Cancelled",
  detail: string,
  stop: StopController,
): Promise<void> {
  // Prefix must match the Health formula's regex (^Running/^Completed/^Failed|^Cancelled|^Rejected/^READY).
  await setWorkerStatus(`${kind} ${runId}: ${detail}`);
  await sleep(5000);
  await setWorkerStatus("READY");
  stop.reset();
}

export function startHeartbeatTicker(getRunId: () => string, getStage: () => RunStage): void {
  setInterval(() => {
    appendLog({
      timestamp: new Date(),
      runId: getRunId(),
      type: "HEARTBEAT",
      level: "INFO",
      stage: getStage(),
      message: "heartbeat",
    }).catch((err) => console.error("Heartbeat write failed:", err instanceof Error ? err.message : err));
  }, 60000);
}
