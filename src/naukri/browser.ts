import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config } from "../config.js";

export interface NaukriBrowser {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/**
 * Launches a dedicated, persistent browser profile so the Naukri session
 * (and Launcher trust) survives restarts and avoids repeated OTP prompts.
 * Never points at the user's normal Chrome profile.
 *
 * Uses real installed Chrome (channel "chrome") by default rather than
 * Playwright's bundled Chromium: the Naukri Launcher installer download/exe
 * handoff behaves differently (and unreliably) in bundled Chromium - it
 * worked in the user's regular Chrome but not there. Override with
 * BROWSER_CHANNEL=chromium in .env to go back to the bundled build.
 */
export async function launchNaukriBrowser(): Promise<NaukriBrowser> {
  const userDataDir = path.resolve(config.browserProfileDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: config.headless,
    viewport: { width: 1400, height: 900 },
    ...(config.browserChannel !== "chromium" ? { channel: config.browserChannel } : {}),
  });

  const page = context.pages()[0] ?? (await context.newPage());

  return {
    context,
    page,
    close: () => context.close(),
  };
}
