import { launchNaukriBrowser } from "../src/naukri/browser.js";
import { config } from "../src/config.js";

/**
 * Supervised selector-discovery mode (spec section 5.2 / 15). Opens the
 * dedicated persistent Naukri profile and the Playwright Inspector so a
 * human can complete Launcher login and one manual search while capturing
 * real, stable locators to paste into src/naukri/selectors.ts.
 */
async function main(): Promise<void> {
  console.log("Naukri selector discovery mode");
  console.log(`Profile dir: ${config.browserProfileDir}`);
  console.log("");

  const browser = await launchNaukriBrowser();
  await browser.page.goto(config.naukriLoginUrl, { waitUntil: "domcontentloaded" });

  console.log("The Playwright Inspector will open. Use it to:");
  console.log("  1. Complete Naukri Launcher login manually (do not paste this into the terminal).");
  console.log("  2. Click Resdex > Search Resumes, then search one known mobile number.");
  console.log("  3. Use the Inspector's 'Pick locator' tool on each element (login button,");
  console.log("     Resdex link, Search Resumes link, Keywords field, Search candidates button,");
  console.log("     the candidate profile/list/no-results containers, and the timeline text)");
  console.log("     and copy the getByRole/getByLabel/getByText locators it suggests.");
  console.log("  4. Paste the confirmed locators into src/naukri/selectors.ts, replacing the");
  console.log("     'CONFIRM VIA DISCOVERY' placeholders.");
  console.log("  5. Resume the script (the inspector's play button) when done to close the browser.");
  console.log("");

  await browser.page.pause();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
