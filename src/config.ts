import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optionalNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  spreadsheetId: required("SPREADSHEET_ID"),
  /** Defaults to a test tab so Sheet1 is never touched until explicitly switched. */
  dataTabName: process.env.TEST_TAB_NAME || "Sheet1_Test",
  controlTabName: process.env.CONTROL_TAB_NAME || "Automation Control",
  logTabName: process.env.LOG_TAB_NAME || "Execution Log",
  googleApplicationCredentials: required("GOOGLE_APPLICATION_CREDENTIALS"),

  pollIntervalMs: optionalNumber("POLL_INTERVAL_MS", 5000),
  jobExpiryMinutes: optionalNumber("JOB_EXPIRY_MINUTES", 30),
  loginTimeoutMs: optionalNumber("LOGIN_TIMEOUT_MS", 5 * 60 * 1000),
  searchDelayMinMs: optionalNumber("SEARCH_DELAY_MIN_MS", 2000),
  searchDelayMaxMs: optionalNumber("SEARCH_DELAY_MAX_MS", 5000),
  maxResetSubuserAttempts: optionalNumber("MAX_RESET_SUBUSER_ATTEMPTS", 2),

  browserProfileDir: process.env.BROWSER_PROFILE_DIR || ".data/naukri-profile",
  /** "chrome" (real installed Chrome, recommended) or "chromium" (Playwright's bundled build). */
  browserChannel: process.env.BROWSER_CHANNEL || "chrome",
  headless: process.env.HEADLESS === "true",

  naukriLoginUrl: "https://www.naukri.com/recruit/login",
} as const;
