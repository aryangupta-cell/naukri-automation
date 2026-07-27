import type { Page } from "playwright";
import { ACTIVE_PATTERN, MODIFIED_PATTERN, timelineContainer } from "./selectors.js";

export interface ExtractedTimeline {
  modified: string | null;
  active: string | null;
}

/**
 * Captures the exact visible "Modified ..." and "Active ..." phrases from
 * the candidate timeline. Never hard-codes sample values (spec 9/10):
 * whatever text the page currently shows is what gets written to the Sheet.
 */
export async function extractTimeline(page: Page): Promise<ExtractedTimeline> {
  const container = timelineContainer(page);
  const text = (await container.innerText().catch(() => "")) || "";
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const modified = lines.find((l) => MODIFIED_PATTERN.test(l)) ?? null;
  const active = lines.find((l) => ACTIVE_PATTERN.test(l)) ?? null;

  return { modified, active };
}
