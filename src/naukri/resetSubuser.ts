import type { Page } from "playwright";
import { config } from "../config.js";
import { RunLogger } from "../logging/logger.js";
import { OCCUPIED_SUBUSER_PATTERN, recruiterHomeMarker, resetAndLoginButton, resetSubuserTab } from "./selectors.js";

export type ResetOutcome = "not-present" | "handled" | "max-attempts-exceeded";

/**
 * Detects the exact "Someone is already logged into Resdex with this
 * username" conflict screen and, only then, runs Reset Subuser > Reset &
 * Login. Never triggered on any other page. Limited to
 * config.maxResetSubuserAttempts per run (spec section 6/8).
 */
export class ResetSubuserHandler {
  private attempts = 0;

  async handleIfPresent(page: Page, logger: RunLogger): Promise<ResetOutcome> {
    const isOccupied = await page
      .getByText(OCCUPIED_SUBUSER_PATTERN)
      .isVisible()
      .catch(() => false);

    if (!isOccupied) return "not-present";

    if (this.attempts >= config.maxResetSubuserAttempts) {
      await logger.event(
        "ACTION_REQUIRED",
        `Occupied-subuser screen persisted after ${this.attempts} reset attempts.`,
        { level: "ERROR", errorCode: "RESET_SUBUSER_LOOP" },
      );
      return "max-attempts-exceeded";
    }

    this.attempts += 1;
    await logger.event(
      "RESET_SUBUSER",
      `Occupied-subuser screen detected (attempt ${this.attempts}). Running Reset Subuser > Reset & Login. ` +
        "This can log out another recruiter using the same Resdex username.",
      { level: "WARN", attempt: this.attempts },
    );

    await resetSubuserTab(page).click();
    await resetAndLoginButton(page).click();

    await recruiterHomeMarker(page)
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => undefined);

    return "handled";
  }
}
