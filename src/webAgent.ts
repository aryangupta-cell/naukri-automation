import http from "node:http";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import {
  readSheet1ControlState,
  clearSheet1Trigger,
  setWorkerStatus,
  readDataRows,
  writeRowResult,
  type Sheet1ControlState,
} from "./google/jobs.js";
import { RunLogger } from "./logging/logger.js";
import { normalizeMobile } from "./domain/mobile.js";
import type { CandidateResult, RunStage, SheetRow } from "./domain/types.js";
import { maskMobile } from "./utils/mask.js";
import { sleep } from "./utils/sleep.js";
import { resolveWithCache } from "./utils/cache.js";
import { installStopHandler, tally, summarize, finishRun, startHeartbeatTicker } from "./workerShared.js";

/**
 * Human-in-the-loop worker with a local web page instead of a terminal
 * prompt. Same automated protocol as humanAgent.ts (Sheet trigger, claim,
 * Execution Log, row read/write, dedupe cache) - only the "ask a person for
 * the Resdex result" step changes, from readline to a browser page.
 */

const PORT = Number(process.env.WEB_PORT) || 4545;
const stop = installStopHandler();

let currentRunId = "idle";
let currentStage: RunStage = "IDLE";

interface PendingPrompt {
  runId: string;
  rowNumber: number;
  name: string;
  mobile: string;
}
interface PendingState extends PendingPrompt {
  resolve: (result: CandidateResult) => void;
}

let pending: PendingState | null = null;
let lastRunSummary: string | null = null;

function waitForHuman(runId: string, row: SheetRow, digits10: string): Promise<CandidateResult> {
  return new Promise((resolve) => {
    pending = { runId, rowNumber: row.rowNumber, name: row.name, mobile: digits10, resolve };
  });
}

function currentStateJson(): string {
  const p = pending;
  return JSON.stringify({
    pending: p ? { rowNumber: p.rowNumber, name: p.name, mobile: p.mobile } : null,
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
<div id="idle">Waiting for a run to be triggered (tick B3 in Automation Control)...</div>
<div id="done"></div>
<div id="card">
  <button class="stop" onclick="submitResult('Stopped')">Stop run</button>
  <div class="row">Row <span id="rowNumber"></span>: <span id="name"></span></div>
  <div class="row mobile" id="mobile"></div>
  <p>Search this number in Resdex &gt; Search Resumes in your own browser, then report the result:</p>
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
<script>
let lastMobile = null;

function showCompleted() {
  document.getElementById('modifiedFields').style.display = 'block';
}

async function submitResult(status) {
  await fetch('/api/submit', {
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

async function poll() {
  const res = await fetch('/api/state');
  const state = await res.json();
  const idleEl = document.getElementById('idle');
  const doneEl = document.getElementById('done');
  const cardEl = document.getElementById('card');

  if (state.pending) {
    idleEl.style.display = 'none';
    doneEl.style.display = 'none';
    cardEl.classList.add('show');
    if (state.pending.mobile !== lastMobile) {
      document.getElementById('rowNumber').textContent = state.pending.rowNumber;
      document.getElementById('name').textContent = state.pending.name;
      document.getElementById('mobile').textContent = state.pending.mobile;
      lastMobile = state.pending.mobile;
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
          if (!pending) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No pending candidate." }));
            return;
          }
          const status = String(body.status ?? "");
          const result: CandidateResult =
            status === "Completed"
              ? { status: "Completed", modified: String(body.modified ?? ""), active: String(body.active ?? "") }
              : { status: status as CandidateResult["status"] };
          const resolve = pending.resolve;
          pending = null;
          resolve(result);
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

  const cache = new Map<string, CandidateResult>();
  const counts: Record<string, number> = {};
  let processed = 0;

  try {
    const rows = await readDataRows(control.startRow, control.endRow);

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
      const { value: result, fromCache } = await resolveWithCache(cache, digits10, (d) => waitForHuman(runId, row, d));

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
    pending = null;
    currentRunId = "idle";
    currentStage = "IDLE";
  }
}

async function mainLoop(): Promise<void> {
  console.log("Naukri automation - WEB human-in-the-loop mode");
  console.log(`  Data tab: "${config.dataTabName}"`);
  console.log(`  Trigger:  ${config.dataTabName}!P1 (checkbox), Q1 (start row), R1 (end row, inclusive)`);

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
