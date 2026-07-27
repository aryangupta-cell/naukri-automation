import type { RowStatus } from "./statuses.js";

export interface SheetRow {
  /** 1-indexed row number in the data tab (row 1 is the header). */
  rowNumber: number;
  mobileRaw: string;
  email: string;
  name: string;
}

/** Which contact channel a search/result is for - phone columns D:F, email columns G:I. */
export type SearchChannel = "phone" | "email";

export interface NormalizedMobile {
  valid: boolean;
  digits10: string | null;
  reason?: string;
}

export interface CandidateResult {
  status: RowStatus;
  modified?: string;
  active?: string;
}

/** Execution Log "Type" column. */
export type LogType = "EVENT" | "HEARTBEAT";

/** Execution Log "Level" column. */
export type LogLevel = "INFO" | "WARN" | "ERROR";

/**
 * Execution Log "Stage" column. TRIGGER_CLAIMED, ACTION_REQUIRED and
 * POSSIBLE_STALL are load-bearing: the live Automation Control formulas
 * (E4/E5/E10) key off these exact strings. The rest are free-form audit
 * stages for the run's progress trail.
 */
export type RunStage =
  | "IDLE"
  | "TRIGGER_CLAIMED"
  | "LOGIN_CHECK"
  | "WAITING_FOR_LOGIN"
  | "PROCESSING_ROW"
  | "RESET_SUBUSER"
  | "ACTION_REQUIRED"
  | "POSSIBLE_STALL"
  | "COMPLETED"
  | "FAILED"
  | "STOPPED";

export interface LogEntry {
  timestamp: Date;
  runId: string;
  type: LogType;
  level: LogLevel;
  stage: RunStage;
  candidateRow?: number;
  candidateName?: string;
  attempt?: number;
  elapsedSeconds?: number;
  message: string;
  errorCode?: string;
}
