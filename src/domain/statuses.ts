export const STATUSES = [
  "Queued",
  "Processing",
  "Completed",
  "Not Found",
  "Multiple Matches",
  "Invalid Mobile",
  "Waiting for Login",
  "Login Required",
  "Manual Intervention",
  "Failed",
  "Stopped",
] as const;

export type RowStatus = (typeof STATUSES)[number];

/**
 * D/E treatment per status, from spec section 7.2.
 * "overwrite": replace Modified/Active with freshly captured text.
 * "clear": blank out Modified/Active.
 * "preserve": leave existing Modified/Active untouched.
 */
export type ResultTreatment = "overwrite" | "clear" | "preserve";

export const RESULT_TREATMENT: Record<RowStatus, ResultTreatment> = {
  Queued: "preserve",
  Processing: "preserve",
  Completed: "overwrite",
  "Not Found": "clear",
  "Multiple Matches": "clear",
  "Invalid Mobile": "clear",
  "Waiting for Login": "preserve",
  "Login Required": "preserve",
  "Manual Intervention": "preserve",
  Failed: "preserve",
  Stopped: "preserve",
};
