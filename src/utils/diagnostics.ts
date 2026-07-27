import path from "node:path";
import fs from "node:fs";
import type { Page } from "playwright";

export interface PageSnapshot {
  url: string;
  title: string;
}

export async function pageSnapshot(page: Page): Promise<PageSnapshot> {
  const [url, title] = await Promise.all([
    Promise.resolve(page.url()),
    page.title().catch(() => "(unable to read title)"),
  ]);
  return { url, title };
}

/** Saves a screenshot under screenshots/ for post-mortem review of a stuck/error/manual-intervention state. */
export async function captureScreenshot(page: Page, label: string): Promise<string> {
  const dir = path.resolve("screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, `${stamp}-${label}.png`);
  await page.screenshot({ path: filePath, fullPage: false }).catch(() => undefined);
  return filePath;
}
