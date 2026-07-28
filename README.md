# Naukri Automation — Local Worker (Phase 1: local laptop testing)

A Node.js + TypeScript worker that watches a trigger checkbox on the
`Sheet1` data tab of a Google Sheet, and when ticked, looks up each
candidate's mobile number in Naukri Resdex and writes back their
Status/Modified/Active info. This phase runs entirely on your local
Windows laptop — no Mac agent, no cloud hosting, no Apps Script.

## IMPORTANT: current supported path is the browser extension (`npm run agent:web` + `extension/`)

The original plan was full Playwright automation end-to-end. That's
**blocked**: Naukri's Resdex login does not recognize a Playwright-controlled
Chrome session as authenticated, even using a real Chrome install and a
manually-paired browser profile — confirmed by navigating directly to
`resdex.naukri.com` and getting redirected back to the login page
(`?msg=TO&URL=...`), which only happens for a session Naukri considers
logged out. The only way to make an automated session pass that check is
fingerprint-masking (hiding `navigator.webdriver`, etc.) to disguise
automated access as human — which this project intentionally will not do,
per the spec's own "if Naukri shows unusual anti-automation behaviour, stop
safely, do not bypass it" rule. The `npm run agent` / `discover` / `run-once`
Playwright path (`src/naukri/`, `src/agent.ts`) stays in the repo for if
Naukri ever grants this account explicit authorization for automated access,
but don't expect it to work today.

**What does work, and is close to fully hands-off:** a Chrome extension
(`extension/`) running in your own real, manually-logged-in browser — not
CDP/Playwright-controlled, so Naukri's detection never triggers, because
there's nothing to detect. It talks to a local worker (`npm run agent:web`)
that handles the Sheet side (trigger detection, claiming, Execution Log, row
read/write, dedupe cache), and for each candidate the extension itself:
- fills Naukri's Keywords field with the mobile number and confirms it
  (Enter — this field is a chip/tag autocomplete, typing alone isn't enough)
- clicks Search
- detects "No results found" and auto-submits `Not Found`
- detects a single profile opening and auto-extracts the exact
  "Modified ..."/"Active ..." text, then auto-submits `Completed`
- falls back to showing manual buttons in its on-page panel for anything it
  can't classify confidently (e.g. a multiple-results list — that state
  hasn't been seen/handled yet, see below)

See "Setup: the browser extension" below for how to load it.

There's also a plain human-in-the-loop fallback if the extension isn't
available/working: `npm run agent:manual` (terminal prompts) does the same
Sheet-side automation but asks you to search and report each result by hand.

## What this targets

- Spreadsheet: `Naukari Automation` (ID `1KJOTaAyWy5k5ioRvMEf3wmPW82Z40H7U5qE_5QNCII4`)
- Data tab: **`Sheet1`** (the real production tab — configurable via `TEST_TAB_NAME` in `.env`, e.g. set it back to `Sheet1_Test` for testing) — columns:
  - `A` Mobile Number, `B` Email, `C` Name
  - `D:F` Phone No - Status / Modified / Active
  - `G:I` Email - Status / Modified / Active
  - `Q1:S1` trigger cells (checkbox / start row / end row)
- Log tab: `Execution Log`
- `Automation Control!B5` — still written for dashboard visibility (Worker status), but no longer read to decide anything

## How the trigger works (on the data tab itself, not Automation Control)

Originally the trigger lived on a separate "Automation Control" tab (checkbox
in B3, row cap in B4). That's been replaced with a trigger directly on the
data tab, so there's one place to look instead of two:

- **Q1** — checkbox. Tick it to request a run.
- **R1** — start row (inclusive), e.g. `2`.
- **S1** — end row (inclusive), e.g. `60`. The worker processes exactly rows R1 through S1, no more, no less — it does not auto-cap or auto-expand.
- **`Automation Control!B5`** ("Worker status") — still written directly by this worker for visibility: `READY` when idle, `Running <runId>...` while active, `Completed <runId>: ...` / `Failed <runId>: ...` / `Cancelled <runId>: ...` when a run ends.
- **`Automation Control!E4:E10`** ("LIVE RUN STATUS") — still spreadsheet formulas reading `Execution Log`; the worker only appends log rows, unchanged from before.

Each row is looked up **twice**: once by phone (written to D:F), once by
email (written to G:I), in that order, before moving to the next row.
Either can be blank in a given row and is simply skipped for that channel.

**Known limitation carried over:** this worker writes the spec PDF's status
vocabulary (`Completed`, `Not Found`, `Multiple Matches`, `Manual
Intervention`, etc.) to the Status columns, not the words
`Automation Control!B17:B21`'s `COUNTIF` tiles expect
(`Success`/`No Match`/`Manual Review`) — those tiles will stay at 0 even
while rows process correctly.

**Stopping a run:** there's no "Stop Requested" cell for this either.
Stop a run with **Ctrl+C** in the terminal running `npm run agent:web` (or
use the extension panel's "Stop run" button) — it finishes the current
candidate, marks the run `Cancelled`, and returns to `READY`. A second
Ctrl+C force-exits the terminal.

## Prerequisites

- Node.js 20+ (Node 24 confirmed to work)
- `service_account.json` present in the project folder (or `.env`'s
  `GOOGLE_APPLICATION_CREDENTIALS` pointed at wherever it actually is)
- **Share the Google Sheet with the service account as Editor**: open the
  Sheet's Share dialog and add `drt-migration@key-nebula-488407-v8.iam.gserviceaccount.com`
  as Editor. Without this, every API call fails with `403 permission denied`.
- `Sheet1!Q1` (checkbox), `R1` (start row), `S1` (end row) already set up as the trigger, and columns A:I laid out as above.

## Setup

Just double-click `First-Time Setup.bat`, or manually:
```powershell
cd path\to\naukri-automation
npm install
copy .env.example .env
```

Edit `.env`:
- `SPREADSHEET_ID` — already filled in for you.
- `TEST_TAB_NAME` — set to `Sheet1` for production, or `Sheet1_Test` to test safely first.
- `GOOGLE_APPLICATION_CREDENTIALS` — path to your service-account JSON.

## Daily use (after one-time setup below)

1. Double-click **`Start Naukri Worker.bat`** in this folder. Keep the window it opens visible/open.
2. Make sure the browser extension is loaded (one-time setup, see below) and a `resdex.naukri.com` tab is open — the panel shows top-right.
3. On `Sheet1`, set **R1** (start row) and **S1** (end row), then tick **Q1** to trigger.

That's it — no typed commands. `Start Naukri Worker.bat` just runs `npm run agent:web` for you.

## One-time setup on a new computer

1. Install [Node.js](https://nodejs.org) (LTS) and Google Chrome if not already present.
2. Copy this whole project folder to the new computer (`node_modules`, `.data`, `.env` are all excluded automatically — see `.gitignore`).
3. Separately, securely transfer the service-account JSON credential file (do not email it casually) — put it anywhere on the new computer.
4. Double-click **`First-Time Setup.bat`** — installs dependencies, creates `.env`, and opens Notepad so you can fill in the path to that service-account file.
5. Double-click **`Link to GitHub (one-time).bat`** — connects this copy to the shared private repo, so future code changes can be pulled instead of re-shared as a zip.
6. In that computer's own regular Chrome, log into Naukri Recruiter once, normally — this is a manual, per-machine, per-account step that can't be skipped or shared. Same for LinkedIn if using the Open-to-Work check.
7. Load the extension (see "Load the browser extension" below).
8. From now on: double-click `Start Naukri Worker.bat`, set Y1/Z1 (row range), tick X1.

## Getting code updates onto the other computer

Once linked to GitHub (step 5 above), any future code changes just need:
1. Double-click **`Check for Updates.bat`** on the other computer.

That's it — no re-zipping, no re-sharing the folder. It runs `git pull` (pulls only the actual changed files, never touches `.env`/`service_account.json`/`node_modules` unless `package.json` itself changed, in which case it also reruns `npm install`).

## Step-by-step rollout (manual/CLI version, for reference or troubleshooting)

### 1. Verify Google access
```powershell
npx tsx -e "import('./src/google/sheets.js').then(m => m.verifyAccess()).then(console.log)"
```
Should print the spreadsheet title and tab list. If you get a 403, the
sheet-sharing step above hasn't been done yet.

### 2. Start the local worker
```powershell
npm run agent:web
```
(Or just double-click `Start Naukri Worker.bat` instead — same thing.)
Leave this running — it's the Sheet-side brain (trigger detection, claiming,
row read/write, Execution Log, dedupe cache) and hosts a small local API at
`http://localhost:4545` that either the extension or a plain browser tab can
talk to.

### 3. Load the browser extension (recommended)
1. Open `chrome://extensions` in your **regular, already-logged-into-Naukri**
   Chrome profile (not a separate/managed one — see "Known gotchas" below if
   `localhost:4545` gets blocked).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**, select the `extension/` folder in this repo.
4. Open any `resdex.naukri.com` page and **refresh it** (content scripts
   only attach to pages loaded *after* the extension is installed).
5. A small panel appears top-right. Set **R1**/**S1** (start/end row) on
   `Sheet1` and tick **Q1** — the panel picks up the run, and for most rows
   it searches, extracts, and submits automatically with no clicking
   needed. Rows it can't classify confidently show manual buttons in the
   same panel.

### 3b. Alternative: plain browser tab, no extension
Open `http://localhost:4545` directly instead of installing the extension —
same worker, but you search Resdex yourself (a separate tab) and click the
result on that page. No auto-search/auto-extract, just automated Sheet
read/write and logging.

### 3c. Alternative: terminal prompts, no browser tooling at all
```powershell
npm run agent:manual
```
Same Sheet-side automation, but it prompts you in the terminal for each
row's result instead of a web page.

### (Optional, currently non-functional) Playwright discovery mode
```powershell
npm run discover
```
This still opens a dedicated Chrome profile (`.data/naukri-profile`) and
the Playwright Inspector for capturing selectors — useful only if Naukri
later authorizes automated access and the `npm run agent` path becomes
viable again. Don't expect the login step to succeed today.

## Known gotchas (hit these during testing)

- **"Worker not reachable" in the extension panel, on a managed/corporate
  Chrome profile**: some enterprise-managed profiles block "Private Network
  Access" (a public page like `resdex.naukri.com` fetching `localhost`)
  regardless of CORS headers. The server already sends the right
  `Access-Control-Allow-Private-Network` header, but a hard IT policy can
  still block it. Fix: use a non-managed Chrome profile.
- **Stray `webAgent`/`humanAgent` processes**: if you restart the worker
  without fully killing the old one, both poll the Sheet and write
  conflicting state. Check with `Get-CimInstance Win32_Process -Filter
  "Name='node.exe'"` filtered for `webAgent`/`humanAgent` in the command
  line, and stop duplicates.
- **A run gets killed mid-row** (closed terminal, crash): `Worker status`
  (B5) and that row's Status (column C) can be left stuck at `Running .../
  Processing`. Reset B5 to `READY` and clear the stuck row's Status cell,
  then retrigger — the next run rechecks all rows anyway.
- **Content script not appearing**: it only attaches to pages loaded after
  the extension was installed/reloaded — refresh the Resdex tab after any
  extension reload.

## Other commands

```powershell
npm test         # unit tests (mobile normalization, status/D-E treatment, dedupe cache)
npm run typecheck
npm run build
```

## Status vocabulary written to Column C

`Queued, Processing, Completed, Not Found, Multiple Matches, Invalid Mobile,
Waiting for Login, Login Required, Manual Intervention, Failed, Stopped`

D/E (Modified/Active) treatment per status: `Completed` overwrites them,
`Not Found`/`Multiple Matches`/`Invalid Mobile` clear them, every other
status preserves whatever was there before.

## Safety guardrails already implemented

- The human-in-the-loop worker never opens or drives a browser itself — you
  do the search in your own browser, so nothing here can click View phone
  number, Call candidate, WhatsApp, Send NVite, or CV download on your behalf.
- Mobile numbers are masked in console logs and Execution Log messages (`******6444`).
- Naukri credentials/OTP are never typed, stored, or seen by this tool at all.
- Duplicate mobile numbers within a run are asked about once and reused for other rows with the same number.

The items below (contact-reveal avoidance during an automated search, Reset
Subuser handling, search delays, persistent browser profile) only apply to
the currently-blocked `npm run agent` Playwright path:
- Never clicks View phone number, Call candidate, WhatsApp, Send NVite, or CV download.
- Reset Subuser → Reset & Login only fires on the exact "someone is already logged in" screen, capped at 2 attempts per run, and every attempt is logged (it can log out another recruiter).
- Random 2–5s delay between live searches.
- Persistent browser profile (`.data/naukri-profile`) — separate from your normal Chrome.

## Real Naukri selectors confirmed via the extension (`extension/content.js`)

Found through live DOM inspection while manually browsing (not guessed):
- Keywords input: `input[name="ezKeywordsAny"]` — a chip/tag autocomplete (`role="combobox"`). Setting `.value` isn't enough; needs the native-setter trick plus a real `Enter` keydown/keyup to confirm the chip, or Naukri rejects the search as "too generic".
- Search button: `#adv-search-btn`
- Chip remove icon: `.tag-ico.naukri-icon.naukri-icon-times` — must click each one to clear a previous search before the next; there's no reliable single "Clear all" click target.
- Result text container: class names carry a build-specific hash suffix (e.g. `tuple-footer-item_cQ0i5`) that can change between Naukri deployments — match `[class*="tuple-footer"]` (stable prefix) and read the text itself via `/^Modified\b/i` / `/^Active\b/i` regex, not the exact class.
- "No results" state: page text `"No results found for this search. Please modify search criteria."`
- Single-profile match: URL changes to include `tabKey=profile`

**Still unconfirmed**: what a multi-result list looks like (URL pattern, DOM structure) — haven't hit that case yet in testing. Until then, anything that isn't a clean single-profile match or the exact "No results" text falls back to showing manual buttons in the extension panel rather than guessing.

`src/naukri/selectors.ts` (the old Playwright path's selectors) are still unconfirmed placeholders and moot unless that path becomes viable again.

## What's intentionally not built in this phase

- No Apps Script layer (menu, lock, confirmation dialog) — the Node worker
  alone polls and writes cells directly via the Sheets API.
- No Mac agent / launchd — this runs as a plain foreground process on your
  Windows laptop (`npm run agent`).
- No cloud hosting / Vercel worker — the `Web status` row in Automation
  Control (linking to the old Vercel control page) is left untouched but
  unused by this worker.
