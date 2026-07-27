import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import type { Page } from "playwright";
import { config } from "./config.js";
import { readControlState, clearTrigger, setWorkerStatus, readDataRows, writeRowResult, type ControlState } from "./google/jobs.js";
import { RunLogger } from "./logging/logger.js";
import { normalizeMobile } from "./domain/mobile.js";
import type { CandidateResult, RunStage, SheetRow } from "./domain/types.js";
import { maskMobile } from "./utils/mask.js";
import { randomDelay, sleep } from "./utils/sleep.js";
import { resolveWithCache } from "./utils/cache.js";
import { launchNaukriBrowser, type NaukriBrowser } from "./naukri/browser.js";
import { ensureLoggedIn } from "./naukri/login.js";
import { ResetSubuserHandler } from "./naukri/resetSubuser.js";
import { searchByMobile } from "./naukri/search.js";
import { extractTimeline } from "./naukri/extract.js";
import { installStopHandler, tally, summarize, finishRun, startHeartbeatTicker } from "./workerShared.js";

/**
 * Fully-automated Playwright path. BLOCKED as of the local pilot: Naukri's
 * Resdex login does not recognize a Playwright-controlled Chrome session as
 * authenticated, even with a real Chrome channel and a manually-paired
 * profile (confirmed via a direct resdex.naukri.com redirect back to
 * /recruit/login). See README "Known limitation" section. Kept in place in
 * case Naukri grants authorized automated access later; humanAgent.ts is
 * the currently-supported path.
 */

const stop = installStopHandler();

let currentRunId = "idle";
let currentStage: RunStage = "IDLE";

export async function processCandidate(
  page: Page,
  digits10: string,
  resetHandler: ResetSubuserHandler,
  logger: RunLogger,
  row: SheetRow,
): Promise<CandidateResult> {
  const state = await searchByMobile(page, digits10, resetHandler, logger);

  if (state === "blocked" || state === "unknown") {
    return { status: "Manual Intervention" };
  }
  if (state === "no-results") {
    return { status: "Not Found" };
  }
  if (state === "list") {
    // Spec 9: never guess between ambiguous matches, even with Column B as a hint.
    return { status: "Multiple Matches" };
  }

  // single-profile
  let timeline = await extractTimeline(page);
  if (!timeline.modified || !timeline.active) {
    await page.waitForTimeout(1500);
    timeline = await extractTimeline(page);
  }
  if (!timeline.modified || !timeline.active) {
    await logger.event("PROCESSING_ROW", "Missing Modified/Active phrase after retry.", {
      level: "WARN",
      candidateRow: row.rowNumber,
      candidateName: row.name,
      errorCode: "MISSING_TIMELINE_PHRASE",
    });
    return { status: "Manual Intervention" };
  }
  return { status: "Completed", modified: timeline.modified, active: timeline.active };
}

async function runOnce(control: ControlState): Promise<void> {
  const runId = uuidv4();
  currentRunId = runId;
  currentStage = "TRIGGER_CLAIMED";
  const logger = new RunLogger(runId);

  await clearTrigger();
  await setWorkerStatus(`Running ${runId}`);
  await logger.event("TRIGGER_CLAIMED", "Worker claimed run.");

  let browser: NaukriBrowser | null = null;
  const cache = new Map<string, CandidateResult>();
  const counts: Record<string, number> = {};
  let processed = 0;

  try {
    browser = await launchNaukriBrowser();
    const page = browser.page;

    currentStage = "LOGIN_CHECK";
    const loginOutcome = await ensureLoggedIn(page, logger);
    if (loginOutcome === "timeout") {
      await logger.event("WAITING_FOR_LOGIN", "Run aborted: Naukri login not completed in time.", { level: "ERROR" });
      await finishRun(runId, "Failed", "login timeout", stop);
      return;
    }

    const allRows = await readDataRows();
    // B4 "Maximum rows per run" is respected as a safety cap on this batch;
    // eligibility itself follows the spec's "recheck every valid row" rule
    // rather than skipping previously-processed rows.
    const rows = allRows.slice(0, control.maxRows);
    if (allRows.length > rows.length) {
      await logger.event(
        "PROCESSING_ROW",
        `Capping this run to the first ${rows.length} of ${allRows.length} rows per "Maximum rows per run".`,
      );
    }
    const resetHandler = new ResetSubuserHandler();

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
      const { value: result, fromCache } = await resolveWithCache(cache, digits10, (d) =>
        processCandidate(page, d, resetHandler, logger, row),
      );

      await writeRowResult(row.rowNumber, result);
      tally(counts, result.status);
      processed++;

      const elapsed = (Date.now() - started) / 1000;
      await logger.event(
        "PROCESSING_ROW",
        `Row ${row.rowNumber} (${maskMobile(digits10)}) -> ${result.status}${fromCache ? " (cached)" : ""}.`,
        { candidateRow: row.rowNumber, candidateName: row.name, elapsedSeconds: elapsed },
      );

      if (!fromCache) {
        await randomDelay(config.searchDelayMinMs, config.searchDelayMaxMs);
      }
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
    if (browser) await browser.close();
    currentRunId = "idle";
    currentStage = "IDLE";
  }
}

async function mainLoop(): Promise<void> {
  console.log(`Naukri automation agent starting.`);
  console.log(`  Control tab: "${config.controlTabName}"`);
  console.log(`  Data tab:    "${config.dataTabName}"`);
  if (config.dataTabName.toLowerCase() === "sheet1") {
    console.log(`  WARNING: targeting "Sheet1" directly - this is the production tab, not a test tab.`);
  }
  console.log("  WARNING: this fully-automated path is currently blocked - Naukri does not");
  console.log('  recognize a Playwright-controlled session as logged in. Use "npm run agent:manual" instead.');

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
