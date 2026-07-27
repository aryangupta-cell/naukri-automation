import { describe, expect, it } from "vitest";
import { RESULT_TREATMENT, STATUSES } from "../src/domain/statuses.js";

describe("RESULT_TREATMENT", () => {
  it("covers every status exactly once", () => {
    expect(Object.keys(RESULT_TREATMENT).sort()).toEqual([...STATUSES].sort());
  });

  it("overwrites D/E only on Completed", () => {
    const overwriteStatuses = STATUSES.filter((s) => RESULT_TREATMENT[s] === "overwrite");
    expect(overwriteStatuses).toEqual(["Completed"]);
  });

  it("clears D/E for Not Found, Multiple Matches and Invalid Mobile", () => {
    const clearStatuses = STATUSES.filter((s) => RESULT_TREATMENT[s] === "clear");
    expect(clearStatuses.sort()).toEqual(["Invalid Mobile", "Multiple Matches", "Not Found"].sort());
  });

  it("preserves D/E for transient/failure/stop statuses", () => {
    for (const status of ["Queued", "Processing", "Waiting for Login", "Login Required", "Manual Intervention", "Failed", "Stopped"] as const) {
      expect(RESULT_TREATMENT[status]).toBe("preserve");
    }
  });
});
