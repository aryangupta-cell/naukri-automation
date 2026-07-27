import { v4 as uuidv4 } from "uuid";
import { readDataRows, writeRowResult } from "../src/google/jobs.js";
import { normalizeMobile } from "../src/domain/mobile.js";
import { launchNaukriBrowser } from "../src/naukri/browser.js";
import { ensureLoggedIn } from "../src/naukri/login.js";
import { ResetSubuserHandler } from "../src/naukri/resetSubuser.js";
import { RunLogger } from "../src/logging/logger.js";
import { processCandidate } from "../src/agent.js";
import { config } from "../src/config.js";
import { maskMobile } from "../src/utils/mask.js";

/**
 * Safe single-row test mode (spec 9.2/13.5): processes exactly one row,
 * looked up by mobile number, from the configured data tab. Never reads or
 * writes the Automation Control trigger/status - use this before ever
 * ticking the Sheet checkbox.
 */
async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npm run run-once -- <mobile-number>");
    process.exit(1);
  }

  const target = normalizeMobile(arg);
  if (!target.valid || !target.digits10) {
    console.error(`"${arg}" is not a valid 10-digit mobile number (${target.reason}).`);
    process.exit(1);
  }

  console.log(`Data tab: "${config.dataTabName}"`);
  const rows = await readDataRows(2, 2000);
  const row = rows.find((r) => normalizeMobile(r.mobileRaw).digits10 === target.digits10);
  if (!row) {
    console.error(`No row in "${config.dataTabName}" has mobile number ${maskMobile(target.digits10)}.`);
    process.exit(1);
  }

  const runId = `manual-${uuidv4()}`;
  const logger = new RunLogger(runId);
  console.log(`Testing row ${row.rowNumber} (${row.name}, ${maskMobile(target.digits10)}) with run id ${runId}.`);

  const browser = await launchNaukriBrowser();
  try {
    const loginOutcome = await ensureLoggedIn(browser.page, logger);
    if (loginOutcome === "timeout") {
      console.error("Login was not completed in time. Aborting.");
      process.exit(1);
    }

    await writeRowResult(row.rowNumber, { status: "Processing" });
    const resetHandler = new ResetSubuserHandler();
    const result = await processCandidate(browser.page, target.digits10, resetHandler, logger, row);
    await writeRowResult(row.rowNumber, result);

    console.log("Result:", result);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
