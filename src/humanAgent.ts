import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { readControlState, clearTrigger, setWorkerStatus, readDataRows, writeRowResult, type ControlState } from "./google/jobs.js";
import { RunLogger } from "./logging/logger.js";
import { normalizeMobile } from "./domain/mobile.js";
import type { CandidateResult, RunStage, SheetRow } from "./domain/types.js";
import type { RowStatus } from "./domain/statuses.js";
import { maskMobile } from "./utils/mask.js";
import { sleep } from "./utils/sleep.js";
import { resolveWithCache } from "./utils/cache.js";
import { installStopHandler, tally, summarize, finishRun, startHeartbeatTicker } from "./workerShared.js";

/**
 * Human-in-the-loop worker. Naukri's Resdex login does not recognize a
 * Playwright-controlled session as authenticated (confirmed - see README),
 * so this path keeps every other piece of the design (Sheet trigger,
 * Automation Control protocol, Execution Log, row read/write, dedupe cache)
 * automated, but asks a person to do the actual Resdex search and read the
 * result back, in their own already-logged-in browser.
 */

const stop = installStopHandler();

let currentRunId = "idle";
let currentStage: RunStage = "IDLE";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const STATUS_MENU: Array<{ key: string; status: RowStatus }> = [
  { key: "1", status: "Completed" },
  { key: "2", status: "Not Found" },
  { key: "3", status: "Multiple Matches" },
  { key: "4", status: "Manual Intervention" },
  { key: "5", status: "Failed" },
];

async function promptForResult(row: SheetRow, digits10: string): Promise<CandidateResult> {
  console.log("");
  // Shown in full deliberately - you need to type this exact number into Resdex.
  // (Execution Log / other console lines still mask it - see logger.ts.)
  console.log(`Row ${row.rowNumber}: ${row.name} - ${digits10}`);
  console.log("  Search this number in Resdex > Search Resumes in your own browser, then report the result.");
  console.log("  [1] Completed   [2] Not Found   [3] Multiple Matches   [4] Manual Intervention   [5] Failed   [s] Stop this run");

  for (;;) {
    const answer = (await rl.question("  Result: ")).trim().toLowerCase();

    if (answer === "s") {
      return { status: "Stopped" };
    }

    const choice = STATUS_MENU.find((o) => o.key === answer);
    if (!choice) {
      console.log('  Please enter 1-5, or "s" to stop.');
      continue;
    }

    if (choice.status === "Completed") {
      const modified = (await rl.question("  Exact 'Modified ...' text: ")).trim();
      const active = (await rl.question("  Exact 'Active ...' text: ")).trim();
      if (!modified || !active) {
        console.log("  Both Modified and Active are required for Completed - try again.");
        continue;
      }
      return { status: "Completed", modified, active };
    }

    return { status: choice.status };
  }
}

async function runOnce(control: ControlState): Promise<void> {
  const runId = uuidv4();
  currentRunId = runId;
  currentStage = "TRIGGER_CLAIMED";
  const logger = new RunLogger(runId);

  await clearTrigger();
  await setWorkerStatus(`Running ${runId}`);
  await logger.event("TRIGGER_CLAIMED", "Worker claimed run (human-in-the-loop mode).");

  const cache = new Map<string, CandidateResult>();
  const counts: Record<string, number> = {};
  let processed = 0;

  try {
    const allRows = await readDataRows();
    const rows = allRows.slice(0, control.maxRows);
    if (allRows.length > rows.length) {
      await logger.event(
        "PROCESSING_ROW",
        `Capping this run to the first ${rows.length} of ${allRows.length} rows per "Maximum rows per run".`,
      );
    }

    console.log("");
    console.log(`=== Run ${runId}: ${rows.length} row(s) to process ===`);

    for (const row of rows) {
      if (stop.isStopRequested()) {
        await logger.event("STOPPED", `Stop requested; halted before row ${row.rowNumber}.`, { level: "WARN" });
        break;
      }

      currentStage = "PROCESSING_ROW";
      const started = Date.now();
      await writeRowResult(row.rowNumber, { status: "Processing" });

      const normalized = normalizeMobile(row.mobileRaw);
      if (!normalized.valid || !normalized.digits10) {
        const result: CandidateResult = { status: "Invalid Mobile" };
        await writeRowResult(row.rowNumber, result);
        await logger.event("PROCESSING_ROW", `Invalid mobile (${normalized.reason}).`, {
          level: "WARN",
          candidateRow: row.rowNumber,
          candidateName: row.name,
        });
        tally(counts, result.status);
        processed++;
        continue;
      }

      const digits10 = normalized.digits10;
      const { value: result, fromCache } = await resolveWithCache(cache, digits10, (d) => promptForResult(row, d));
      if (fromCache) {
        console.log(`  (Same mobile number already looked up this run - reusing result: ${result.status})`);
      }
      if (result.status === "Stopped") {
        await writeRowResult(row.rowNumber, result);
        await logger.event("STOPPED", `Operator stopped at row ${row.rowNumber}.`, { level: "WARN" });
        break;
      }

      await writeRowResult(row.rowNumber, result);
      tally(counts, result.status);
      processed++;

      const elapsed = (Date.now() - started) / 1000;
      await logger.event(
        "PROCESSING_ROW",
        `Row ${row.rowNumber} (${maskMobile(digits10)}) -> ${result.status}${fromCache ? " (cached)" : ""}.`,
        { candidateRow: row.rowNumber, candidateName: row.name, elapsedSeconds: elapsed },
      );
    }

    const summary = summarize(processed, counts);

    if (stop.isStopRequested()) {
      await logger.event("STOPPED", `Run stopped by operator. ${summary}`, { level: "WARN" });
      await finishRun(runId, "Cancelled", summary, stop);
    } else {
      await logger.event("COMPLETED", `Run completed. ${summary}`);
      await finishRun(runId, "Completed", summary, stop);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logger.event("FAILED", `Run failed: ${message}`, { level: "ERROR" });
    await finishRun(runId, "Failed", message, stop);
  } finally {
    currentRunId = "idle";
    currentStage = "IDLE";
  }
}

async function mainLoop(): Promise<void> {
  console.log("Naukri automation - HUMAN-IN-THE-LOOP mode");
  console.log(`  Control tab: "${config.controlTabName}"`);
  console.log(`  Data tab:    "${config.dataTabName}"`);
  if (config.dataTabName.toLowerCase() === "sheet1") {
    console.log(`  WARNING: targeting "Sheet1" directly - this is the production tab, not a test tab.`);
  }
  console.log("  You'll be prompted to search each candidate yourself in Resdex and report the result.");

  await setWorkerStatus("READY");
  startHeartbeatTicker(
    () => currentRunId,
    () => currentStage,
  );
  console.log(`Watching for the run trigger every ${config.pollIntervalMs}ms. Press Ctrl+C to stop.`);

  for (;;) {
    try {
      const state = await readControlState();
      if (state.triggered) {
        await runOnce(state);
      }
    } catch (err) {
      console.error("Poll error:", err instanceof Error ? err.message : err);
    }
    await sleep(config.pollIntervalMs);
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  mainLoop().catch((err) => {
    console.error("Fatal agent error:", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
