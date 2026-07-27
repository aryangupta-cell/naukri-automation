import type { Page } from "playwright";
import { RunLogger } from "../logging/logger.js";
import { ResetSubuserHandler } from "./resetSubuser.js";
import {
  candidateProfileContainer,
  candidateResultsList,
  keywordsInput,
  noResultsMessage,
  resdexNavLink,
  searchCandidatesButton,
  searchResumesLink,
} from "./selectors.js";

export type SearchResultState = "single-profile" | "list" | "no-results" | "blocked" | "unknown";

/**
 * Runs the Resdex > Search Resumes > search-by-mobile flow for one
 * candidate, checking for the occupied-subuser interruption after every
 * navigation step per spec section 7.
 */
export async function searchByMobile(
  page: Page,
  mobile10Digits: string,
  reset: ResetSubuserHandler,
  logger: RunLogger,
): Promise<SearchResultState> {
  await resdexNavLink(page).click();
  if ((await reset.handleIfPresent(page, logger)) === "max-attempts-exceeded") return "blocked";

  await searchResumesLink(page).click();
  if ((await reset.handleIfPresent(page, logger)) === "max-attempts-exceeded") return "blocked";

  await keywordsInput(page).fill(mobile10Digits);
  await searchCandidatesButton(page).click();
  if ((await reset.handleIfPresent(page, logger)) === "max-attempts-exceeded") return "blocked";

  return waitForResultState(page);
}

async function waitForResultState(page: Page): Promise<SearchResultState> {
  const candidates: Array<[SearchResultState, ReturnType<typeof candidateProfileContainer>]> = [
    ["single-profile", candidateProfileContainer(page)],
    ["list", candidateResultsList(page)],
    ["no-results", noResultsMessage(page)],
  ];

  // Race the three possible outcomes; whichever becomes visible first wins.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const [state, locator] of candidates) {
      if (await locator.isVisible().catch(() => false)) return state;
    }
    await page.waitForTimeout(300);
  }

  // One retry for slow page readiness before giving up (spec 9.3/7.3).
  await page.waitForTimeout(2000);
  for (const [state, locator] of candidates) {
    if (await locator.isVisible().catch(() => false)) return state;
  }
  // None of the known result states appeared — do not guess "no-results";
  // let the caller mark this Manual Intervention instead.
  return "unknown";
}
