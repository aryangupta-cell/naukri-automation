import http from "node:http";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import {
  readSheet1ControlState,
  clearSheet1Trigger,
  setWorkerStatus,
  readDataRows,
  writeChannelResult,
  writeLinkedInResult,
  type Sheet1ControlState,
} from "./google/jobs.js";
import { RunLogger } from "./logging/logger.js";
import { normalizeMobile } from "./domain/mobile.js";
import type { CandidateResult, DecoyChannel, LinkedInResult, RunStage, SearchChannel, SheetRow } from "./domain/types.js";
import { maskMobile } from "./utils/mask.js";
import { sleep } from "./utils/sleep.js";
import { resolveWithCache } from "./utils/cache.js";
import { installStopHandler, tally, summarize, finishRun, startHeartbeatTicker } from "./workerShared.js";

/**
 * Human-in-the-loop worker with a local web page instead of a terminal
 * prompt. Same automated protocol as humanAgent.ts (Sheet trigger, claim,
 * Execution Log, row read/write, dedupe cache) - only the "ask a person for
 * the Resdex result" step changes, from readline to a browser page.
 *
 * Per row, the Naukri sequence (name decoy -> phone -> department decoy ->
 * email) and the LinkedIn "Open to Work" check run concurrently, since
 * LinkedIn doesn't depend on the Naukri results at all - see
 * processNaukriSequence/processLinkedIn below.
 */

const PORT = Number(process.env.WEB_PORT) || 4545;
const stop = installStopHandler();

let currentRunId = "idle";
let currentStage: RunStage = "IDLE";

type Channel = SearchChannel | "linkedin" | DecoyChannel;
/** The "Stop run" button can interrupt any channel, so every wait path can resolve with this. */
type StoppedSignal = { status: "Stopped" };
/** Decoy searches (name/department) only ever need an ack that the search happened - the result is never read. */
type DecoyAck = { status: "Done" };
type PendingResult = CandidateResult | LinkedInResult | DecoyAck | StoppedSignal;

interface PendingPrompt {
  runId: string;
  rowNumber: number;
  name: string;
  value: string;
  channel: Channel;
}
interface PendingState extends PendingPrompt {
  resolve: (result: PendingResult) => void;
}

// Two independent pending slots instead of one shared one, so the Resdex
// side (phone/email/decoys) and the LinkedIn side can each have their own
// candidate in flight at the same time - the extension's two content
// scripts (content.js on resdex.naukri.com, linkedin.js on linkedin.com)
// poll and resolve these independently, letting a row's Naukri sequence
// and LinkedIn check run concurrently instead of one waiting on the other.
let pendingNaukri: PendingState | null = null;
let pendingLinkedin: PendingState | null = null;
let lastRunSummary: string | null = null;

function waitForHuman(runId: string, row: SheetRow, value: string, channel: SearchChannel): Promise<CandidateResult> {
  return new Promise((resolve) => {
    pendingNaukri = { runId, rowNumber: row.rowNumber, name: row.name, value, channel, resolve: resolve as (result: PendingResult) => void };
  });
}

function waitForLinkedIn(runId: string, row: SheetRow): Promise<LinkedInResult | StoppedSignal> {
  return new Promise((resolve) => {
    pendingLinkedin = {
      runId,
      rowNumber: row.rowNumber,
      name: row.name,
      value: row.linkedinUrl,
      channel: "linkedin",
      resolve: resolve as (result: PendingResult) => void,
    };
  });
}

/** Decoy search (name/department) - searched purely to break up the phone/email search pattern; result is discarded. */
function waitForDecoy(runId: string, row: SheetRow, value: string, channel: DecoyChannel): Promise<DecoyAck | StoppedSignal> {
  return new Promise((resolve) => {
    pendingNaukri = { runId, rowNumber: row.rowNumber, name: row.name, value, channel, resolve: resolve as (result: PendingResult) => void };
  });
}

function currentStateJson(): string {
  const pn = pendingNaukri;
  const pl = pendingLinkedin;
  return JSON.stringify({
    pendingNaukri: pn ? { rowNumber: pn.rowNumber, name: pn.name, value: pn.value, channel: pn.channel } : null,
    pendingLinkedin: pl ? { rowNumber: pl.rowNumber, name: pl.name, value: pl.value, channel: pl.channel } : null,
    idle: currentRunId === "idle",
    lastRunSummary,
  });
}

const PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Naukri Automation - Candidate Lookup</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 20px; }
  #idle, #done { color: #555; padding: 24px; text-align: center; }
  #card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; display: none; }
  #card.show { display: block; }
  .row { margin: 8px 0; font-size: 18px; }
  .mobile { font-weight: bold; font-size: 22px; letter-spacing: 1px; }
  button { font-size: 15px; padding: 10px 14px; margin: 4px 6px 4px 0; border-radius: 6px; border: 1px solid #ccc; cursor: pointer; background: #f5f5f5; }
  button:hover { background: #eee; }
  button.primary { background: #1a73e8; color: white; border: none; }
  button.stop { background: #d93025; color: white; border: none; float: right; }
  input[type=text] { width: 100%; padding: 8px; font-size: 15px; margin: 6px 0; box-sizing: border-box; }
  #modifiedFields { display: none; margin-top: 10px; }
  label { font-size: 13px; color: #555; }
</style>
</head>
<body>
<h1>Naukri Automation - Candidate Lookup</h1>
<div id="idle">Waiting for a run to be triggered (tick X1 on Sheet1)...</div>
<div id="done"></div>
<div id="card">
  <button class="stop" onclick="submitResult('Stopped')">Stop run</button>
  <div class="row">Row <span id="rowNumber"></span>: <span id="name"></span> (<span id="channel"></span>)</div>
  <div class="row mobile" id="mobile"></div>

  <div id="naukriButtons">
    <p>Search this in Resdex &gt; Search Resumes in your own browser, then report the result:</p>
    <button class="primary" onclick="showCompleted()">Completed</button>
    <button onclick="submitResult('Not Found')">Not Found</button>
    <button onclick="submitResult('Multiple Matches')">Multiple Matches</button>
    <button onclick="submitResult('Manual Intervention')">Manual Intervention</button>
    <button onclick="submitResult('Failed')">Failed</button>

    <div id="modifiedFields">
      <label>Exact "Modified ..." text</label>
      <input type="text" id="modifiedInput" placeholder="e.g. Modified 3 months ago" />
      <label>Exact "Active ..." text</label>
      <input type="text" id="activeInput" placeholder="e.g. Active yesterday" />
      <button class="primary" onclick="submitCompleted()">Submit</button>
    </div>
  </div>

  <div id="linkedinButtons" style="display:none">
    <p>Open this LinkedIn URL yourself, check for "Open to work", then report the result:</p>
    <button class="primary" onclick="submitResult('Yes')">Yes</button>
    <button onclick="submitResult('No')">No</button>
  </div>

  <div id="decoyButtons" style="display:none">
    <p>Decoy search (result not used) - search this in Resdex, then just click Done to move on:</p>
    <button class="primary" onclick="submitResult('Done')">Done</button>
  </div>
</div>
<script>
let lastMobile = null;

function showCompleted() {
  document.getElementById('modifiedFields').style.display = 'block';
}

async function submitResult(status) {
  const endpoint = currentTarget === 'linkedin' ? '/api/submit-linkedin' : '/api/submit';
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  document.getElementById('modifiedFields').style.display = 'none';
  poll();
}

async function submitCompleted() {
  const modified = document.getElementById('modifiedInput').value.trim();
  const active = document.getElementById('activeInput').value.trim();
  if (!modified || !active) { alert('Both fields are required.'); return; }
  await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Completed', modified, active }),
  });
  document.getElementById('modifiedInput').value = '';
  document.getElementById('activeInput').value = '';
  document.getElementById('modifiedFields').style.display = 'none';
  poll();
}

let currentTarget = 'naukri';

async function poll() {
  const res = await fetch('/api/state');
  const state = await res.json();
  const idleEl = document.getElementById('idle');
  const doneEl = document.getElementById('done');
  const cardEl = document.getElementById('card');

  // This plain fallback page only shows one card at a time - prefer the
  // Naukri side (more common) and fall back to LinkedIn if that's the
  // only thing pending. The extension is what actually handles both
  // concurrently; this page is the no-extension manual fallback.
  const pending = state.pendingNaukri || state.pendingLinkedin;
  currentTarget = state.pendingNaukri ? 'naukri' : 'linkedin';

  if (pending) {
    idleEl.style.display = 'none';
    doneEl.style.display = 'none';
    cardEl.classList.add('show');
    if (pending.value !== lastMobile) {
      document.getElementById('rowNumber').textContent = pending.rowNumber;
      document.getElementById('name').textContent = pending.name;
      document.getElementById('mobile').textContent = pending.value;
      document.getElementById('channel').textContent = pending.channel;
      const isLinkedin = pending.channel === 'linkedin';
      const isDecoy = pending.channel === 'name' || pending.channel === 'department';
      document.getElementById('naukriButtons').style.display = (!isLinkedin && !isDecoy) ? 'block' : 'none';
      document.getElementById('linkedinButtons').style.display = isLinkedin ? 'block' : 'none';
      document.getElementById('decoyButtons').style.display = isDecoy ? 'block' : 'none';
      lastMobile = pending.value;
    }
  } else {
    cardEl.classList.remove('show');
    lastMobile = null;
    if (state.idle) {
      idleEl.style.display = 'block';
      doneEl.style.display = state.lastRunSummary ? 'block' : 'none';
      doneEl.textContent = state.lastRunSummary ? ('Last run: ' + state.lastRunSummary) : '';
    } else {
      idleEl.style.display = 'block';
      idleEl.textContent = 'Run in progress, waiting for the next row...';
      doneEl.style.display = 'none';
    }
  }
}

setInterval(poll, 1500);
poll();
</script>
</body>
</html>`;

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function startServer(): void {
  const server = http.createServer((req, res) => {
    // CORS: the browser extension's content script runs on resdex.naukri.com,
    // a different origin than this localhost server, so it needs these
    // headers to be allowed to fetch it. Local-only server, low-sensitivity
    // data (candidate name/mobile you already see in the Sheet), so a
    // permissive origin is fine here.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // Private Network Access: resdex.naukri.com is a "public" origin fetching
    // a loopback address, which Chrome blocks unless the preflight response
    // explicitly allows it - separate from, and in addition to, normal CORS.
    if (req.headers["access-control-request-private-network"] === "true") {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE_HTML);
      return;
    }
    if (req.method === "GET" && req.url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(currentStateJson());
      return;
    }
    if (req.method === "POST" && req.url === "/api/submit") {
      readJsonBody(req)
        .then((body) => {
          if (!pendingNaukri) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No pending Naukri candidate." }));
            return;
          }
          const status = String(body.status ?? "");
          const resolve = pendingNaukri.resolve;
          const channel = pendingNaukri.channel;
          pendingNaukri = null;

          if (status === "Stopped") {
            resolve({ status: "Stopped" });
          } else if (channel === "name" || channel === "department") {
            resolve({ status: "Done" });
          } else {
            const result: CandidateResult =
              status === "Completed"
                ? { status: "Completed", modified: String(body.modified ?? ""), active: String(body.active ?? "") }
                : { status: status as CandidateResult["status"] };
            resolve(result);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch(() => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad request." }));
        });
      return;
    }
    if (req.method === "POST" && req.url === "/api/submit-linkedin") {
      readJsonBody(req)
        .then((body) => {
          if (!pendingLinkedin) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No pending LinkedIn candidate." }));
            return;
          }
          const status = String(body.status ?? "");
          const resolve = pendingLinkedin.resolve;
          pendingLinkedin = null;

          if (status === "Stopped") {
            resolve({ status: "Stopped" });
          } else {
            resolve({ status: status === "Yes" ? "Yes" : "No" });
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch(() => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad request." }));
        });
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, () => {
    console.log(`Candidate lookup page: http://localhost:${PORT}`);
  });
}

interface StepOutcome {
  stopped: boolean;
  processed: number;
}

/** Runs the full Name(decoy) -> Phone -> Department(decoy) -> Email sequence for one row on the Resdex side. */
async function processNaukriSequence(
  runId: string,
  row: SheetRow,
  phoneCache: Map<string, CandidateResult>,
  emailCache: Map<string, CandidateResult>,
  counts: Record<string, number>,
  logger: RunLogger,
): Promise<StepOutcome> {
  let processed = 0;

  // Decoy name search - purely to vary the query pattern before the phone
  // search; result is never read or written anywhere.
  if (row.name.trim() !== "") {
    const result = await waitForDecoy(runId, row, row.name, "name");
    if (result.status === "Stopped") {
      await logger.event("STOPPED", `Operator stopped at row ${row.rowNumber} (name decoy).`, { level: "WARN" });
      return { stopped: true, processed };
    }
  }

  // Phone lookup (columns D:F) - only if a mobile number is present.
  if (row.mobileRaw.trim() !== "") {
    await writeChannelResult(row.rowNumber, "phone", { status: "Processing" });
    const normalized = normalizeMobile(row.mobileRaw);

    if (!normalized.valid || !normalized.digits10) {
      const result: CandidateResult = { status: "Invalid Mobile" };
      await writeChannelResult(row.rowNumber, "phone", result);
      await logger.event("PROCESSING_ROW", `Invalid mobile (${normalized.reason}).`, {
        level: "WARN",
        candidateRow: row.rowNumber,
        candidateName: row.name,
      });
      tally(counts, result.status);
      processed++;
    } else {
      const digits10 = normalized.digits10;
      const { value: result, fromCache } = await resolveWithCache(phoneCache, digits10, (d) =>
        waitForHuman(runId, row, d, "phone"),
      );

      if (result.status === "Stopped") {
        await writeChannelResult(row.rowNumber, "phone", result);
        await logger.event("STOPPED", `Operator stopped at row ${row.rowNumber} (phone).`, { level: "WARN" });
        return { stopped: true, processed };
      }

      await writeChannelResult(row.rowNumber, "phone", result);
      tally(counts, result.status);
      processed++;
      await logger.event(
        "PROCESSING_ROW",
        `Row ${row.rowNumber} phone (${maskMobile(digits10)}) -> ${result.status}${fromCache ? " (cached)" : ""}.`,
        { candidateRow: row.rowNumber, candidateName: row.name },
      );
    }
  }

  // Decoy department search - purely to vary the query pattern between
  // the phone and email searches; result is never read or written anywhere.
  if (row.department.trim() !== "") {
    const result = await waitForDecoy(runId, row, row.department, "department");
    if (result.status === "Stopped") {
      await logger.event("STOPPED", `Operator stopped at row ${row.rowNumber} (department decoy).`, { level: "WARN" });
      return { stopped: true, processed };
    }
  }

  // Email lookup (columns G:I) - only if an email is present.
  if (row.email.trim() !== "") {
    await writeChannelResult(row.rowNumber, "email", { status: "Processing" });
    const emailKey = row.email.toLowerCase();
    const { value: result, fromCache } = await resolveWithCache(emailCache, emailKey, () =>
      waitForHuman(runId, row, row.email, "email"),
    );

    if (result.status === "Stopped") {
      await writeChannelResult(row.rowNumber, "email", result);
      await logger.event("STOPPED", `Operator stopped at row ${row.rowNumber} (email).`, { level: "WARN" });
      return { stopped: true, processed };
    }

    await writeChannelResult(row.rowNumber, "email", result);
    tally(counts, result.status);
    processed++;
    await logger.event(
      "PROCESSING_ROW",
      `Row ${row.rowNumber} email -> ${result.status}${fromCache ? " (cached)" : ""}.`,
      { candidateRow: row.rowNumber, candidateName: row.name },
    );
  }

  return { stopped: false, processed };
}

/** Runs the LinkedIn "Open to Work" check for one row - independent of the Naukri sequence, so it can run concurrently with it. */
async function processLinkedIn(
  runId: string,
  row: SheetRow,
  linkedinCache: Map<string, LinkedInResult | StoppedSignal>,
  logger: RunLogger,
): Promise<StepOutcome> {
  if (row.linkedinUrl.trim() === "") return { stopped: false, processed: 0 };

  const linkedinKey = row.linkedinUrl.toLowerCase();
  const { value: result, fromCache } = await resolveWithCache(linkedinCache, linkedinKey, () => waitForLinkedIn(runId, row));

  if (result.status === "Stopped") {
    await logger.event("STOPPED", `Operator stopped at row ${row.rowNumber} (linkedin).`, { level: "WARN" });
    return { stopped: true, processed: 0 };
  }

  await writeLinkedInResult(row.rowNumber, result);
  await logger.event(
    "PROCESSING_ROW",
    `Row ${row.rowNumber} linkedin -> ${result.status}${fromCache ? " (cached)" : ""}.`,
    { candidateRow: row.rowNumber, candidateName: row.name },
  );
  return { stopped: false, processed: 1 };
}

async function runOnce(control: Sheet1ControlState): Promise<void> {
  const runId = uuidv4();
  currentRunId = runId;
  currentStage = "TRIGGER_CLAIMED";
  const logger = new RunLogger(runId);

  await clearSheet1Trigger();
  await setWorkerStatus(`Running ${runId}`);
  await logger.event(
    "TRIGGER_CLAIMED",
    `Worker claimed run (web human-in-the-loop mode), rows ${control.startRow}-${control.endRow}.`,
  );

  const phoneCache = new Map<string, CandidateResult>();
  const emailCache = new Map<string, CandidateResult>();
  const linkedinCache = new Map<string, LinkedInResult | StoppedSignal>();
  const counts: Record<string, number> = {};
  let processed = 0;

  try {
    const rows = await readDataRows(control.startRow, control.endRow);

    rowLoop: for (const row of rows) {
      if (stop.isStopRequested()) {
        await logger.event("STOPPED", `Stop requested; halted before row ${row.rowNumber}.`, { level: "WARN" });
        break;
      }

      currentStage = "PROCESSING_ROW";

      // Naukri (name decoy -> phone -> department decoy -> email) and
      // LinkedIn are independent of each other, so run them concurrently
      // instead of LinkedIn waiting for the whole Naukri sequence to
      // finish first (or vice versa) - halves the wall-clock time per row.
      const [naukriOutcome, linkedinOutcome] = await Promise.all([
        processNaukriSequence(runId, row, phoneCache, emailCache, counts, logger),
        processLinkedIn(runId, row, linkedinCache, logger),
      ]);

      processed += naukriOutcome.processed + linkedinOutcome.processed;

      if (naukriOutcome.stopped || linkedinOutcome.stopped) {
        break rowLoop;
      }
    }

    const summary = summarize(processed, counts);
    lastRunSummary = summary;

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
    pendingNaukri = null;
    pendingLinkedin = null;
    currentRunId = "idle";
    currentStage = "IDLE";
  }
}

async function mainLoop(): Promise<void> {
  console.log("Naukri automation - WEB human-in-the-loop mode");
  console.log(`  Data tab: "${config.dataTabName}"`);
  console.log(`  Trigger:  ${config.dataTabName}!X1 (checkbox), Y1 (start row), Z1 (end row, inclusive)`);

  startServer();
  await setWorkerStatus("READY");
  startHeartbeatTicker(
    () => currentRunId,
    () => currentStage,
  );
  console.log(`Watching for the run trigger every ${config.pollIntervalMs}ms. Press Ctrl+C to stop.`);

  for (;;) {
    try {
      const state = await readSheet1ControlState();
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
