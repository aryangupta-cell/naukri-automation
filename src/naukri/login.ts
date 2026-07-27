import type { Page } from "playwright";
import { config } from "../config.js";
import { RunLogger } from "../logging/logger.js";
import { loginWithLauncherButton, recruiterHomeMarker } from "./selectors.js";
import { captureScreenshot, pageSnapshot } from "../utils/diagnostics.js";

export type LoginOutcome = "already-authenticated" | "authenticated" | "timeout";

const PROGRESS_LOG_INTERVAL_MS = 15000;

/**
 * Opens the Naukri login page. If already authenticated, returns immediately.
 * Otherwise clicks "Login with Naukri Launcher" and pauses for up to
 * config.loginTimeoutMs (default 5 min) while the human completes the
 * manual Launcher login. Never types or stores a credential, OTP, or
 * password anywhere in this flow.
 *
 * Logs the page's URL/title every ~15s while waiting and screenshots on
 * timeout, so a stuck run is diagnosable from Execution Log + screenshots/
 * instead of just looking silent.
 */
export async function ensureLoggedIn(page: Page, logger: RunLogger): Promise<LoginOutcome> {
  await page.goto(config.naukriLoginUrl, { waitUntil: "domcontentloaded" });

  const initial = await pageSnapshot(page);
  console.log(`Login page loaded: ${initial.url} ("${initial.title}")`);

  if (await isRecruiterHomeVisible(page)) {
    await logger.event("LOGIN_CHECK", "Already authenticated on Naukri recruiter home.");
    return "already-authenticated";
  }

  const launcherButton = loginWithLauncherButton(page);
  if (await launcherButton.isVisible().catch(() => false)) {
    await launcherButton.click();
  }

  await logger.event(
    "WAITING_FOR_LOGIN",
    `Waiting up to ${Math.round(config.loginTimeoutMs / 1000)}s for manual Naukri Launcher login.`,
    { level: "WARN" },
  );

  const deadline = Date.now() + config.loginTimeoutMs;
  let lastProgressLog = 0;
  while (Date.now() < deadline) {
    if (await isRecruiterHomeVisible(page)) {
      await logger.event("LOGIN_CHECK", "Manual login completed; resuming.");
      return "authenticated";
    }

    if (Date.now() - lastProgressLog >= PROGRESS_LOG_INTERVAL_MS) {
      const snapshot = await pageSnapshot(page);
      console.log(`Still waiting for login... current page: ${snapshot.url} ("${snapshot.title}")`);
      lastProgressLog = Date.now();
    }

    await page.waitForTimeout(2000);
  }

  const finalSnapshot = await pageSnapshot(page);
  const screenshotPath = await captureScreenshot(page, "login-timeout");
  await logger.event(
    "WAITING_FOR_LOGIN",
    `Login not completed within timeout. Final page: ${finalSnapshot.url} ("${finalSnapshot.title}"). Screenshot: ${screenshotPath}`,
    { level: "ERROR", errorCode: "LOGIN_TIMEOUT" },
  );
  return "timeout";
}

async function isRecruiterHomeVisible(page: Page): Promise<boolean> {
  return recruiterHomeMarker(page)
    .isVisible()
    .catch(() => false);
}
