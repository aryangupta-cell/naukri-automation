import type { Page } from "playwright";

/**
 * Every locator in this file is a BEST-GUESS placeholder written from the
 * spec's screenshots, not a confirmed live selector. Per spec section 5.2 /
 * 15, they must be replaced after a supervised `npm run discover` session
 * using Playwright Inspector/codegen against the real DOM. Search this file
 * for "CONFIRM VIA DISCOVERY" before running anything beyond discovery mode.
 */

// --- Login -----------------------------------------------------------------

/** CONFIRM VIA DISCOVERY: exact text/role of the Launcher login button. */
export function loginWithLauncherButton(page: Page) {
  return page.getByRole("button", { name: /login with naukri launcher/i });
}

/** CONFIRM VIA DISCOVERY: a marker only present once the recruiter home has loaded. */
export function recruiterHomeMarker(page: Page) {
  return page.getByRole("link", { name: /resdex/i }).first();
}

// --- Navigation --------------------------------------------------------------

/** CONFIRM VIA DISCOVERY: top-nav "Resdex" entry point. */
export function resdexNavLink(page: Page) {
  return page.getByRole("link", { name: /resdex/i }).first();
}

/** CONFIRM VIA DISCOVERY: "Search Resumes" menu item under Resdex. */
export function searchResumesLink(page: Page) {
  return page.getByRole("link", { name: /search resumes/i });
}

// --- Search ------------------------------------------------------------------

/** CONFIRM VIA DISCOVERY: the Keywords input on the Search candidates form. */
export function keywordsInput(page: Page) {
  return page.getByPlaceholder(/keyword/i).or(page.getByLabel(/keyword/i));
}

/** CONFIRM VIA DISCOVERY: bottom-right "Search candidates" CTA. */
export function searchCandidatesButton(page: Page) {
  return page.getByRole("button", { name: /search candidates/i });
}

/** CONFIRM VIA DISCOVERY: container for a single opened candidate profile. */
export function candidateProfileContainer(page: Page) {
  return page.locator('[data-testid="candidate-profile"]');
}

/** CONFIRM VIA DISCOVERY: container for a multi-row search results list. */
export function candidateResultsList(page: Page) {
  return page.locator('[data-testid="candidate-results-list"]');
}

/** CONFIRM VIA DISCOVERY: "no results" empty state. */
export function noResultsMessage(page: Page) {
  return page.getByText(/no candidates found|no results found/i);
}

// --- Result extraction ---------------------------------------------------------

/** CONFIRM VIA DISCOVERY: the timeline/meta region holding "Modified"/"Active" text. */
export function timelineContainer(page: Page) {
  return page.locator('[data-testid="candidate-timeline"]');
}

export const MODIFIED_PATTERN = /^Modified\b/i;
export const ACTIVE_PATTERN = /^Active\b/i;

// --- Reset Subuser conflict screen ---------------------------------------------

/** Detection text per spec section 6/8 — used to gate the handler to the exact screen. */
export const OCCUPIED_SUBUSER_PATTERN = /someone is already logged into resdex with this username/i;

export function resetSubuserTab(page: Page) {
  return page.getByRole("tab", { name: /reset subuser/i }).or(page.getByRole("button", { name: /reset subuser/i }));
}

export function resetAndLoginButton(page: Page) {
  return page.getByRole("button", { name: /reset\s*&?\s*login/i });
}

// --- Guardrails: contact-reveal actions the bot must NEVER click ----------------

/** Used only for defensive checks/tests; the flows below simply never invoke these. */
export const FORBIDDEN_ACTION_PATTERNS = [
  /view phone number/i,
  /call candidate/i,
  /whatsapp/i,
  /send nvite/i,
  /download cv/i,
];
