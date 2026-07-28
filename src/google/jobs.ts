import { config } from "../config.js";
import { RESULT_TREATMENT } from "../domain/statuses.js";
import type { CandidateResult, LinkedInResult, LogEntry, SearchChannel, SheetRow } from "../domain/types.js";
import { appendRow, getRange, setCell, setRow } from "./sheets.js";

/** Automation Control cell map (fixed layout of the live "Automation Control" tab). */
const CONTROL_CELLS = {
  workerStatus: "B5",
} as const;

/**
 * Trigger cells live on the data tab itself: X1 checkbox, Y1 start row, Z1
 * end row (inclusive). Automation Control's B5 "Worker status" is still
 * written for dashboard visibility, but no longer read to decide anything.
 *
 * Data columns: A Mobile Number, B Email, C LinkedIn ID Link (input),
 * D:E unused/reserved, F Name, G:I Phone No - Status/Modified/Active,
 * J:L Email - Status/Modified/Active, M Open to Work (output, strictly Yes/No).
 */
const SHEET1_TRIGGER_CELLS = {
  trigger: "X1",
  startRow: "Y1",
  endRow: "Z1",
} as const;

const PHONE_RESULT_COLUMNS = { status: "G", firstCol: "G", lastCol: "I" } as const;
const EMAIL_RESULT_COLUMNS = { status: "J", firstCol: "J", lastCol: "L" } as const;
const LINKEDIN_RESULT_COLUMN = "M";

export interface Sheet1ControlState {
  triggered: boolean;
  startRow: number;
  endRow: number;
}

export async function readSheet1ControlState(): Promise<Sheet1ControlState> {
  const values = await getRange(config.dataTabName, "X1:Z1");
  const triggered = Boolean(values[0]?.[0]);
  const startRow = Number(values[0]?.[1]) || 2;
  const endRow = Number(values[0]?.[2]) || startRow;
  return { triggered, startRow, endRow };
}

export async function clearSheet1Trigger(): Promise<void> {
  await setCell(config.dataTabName, SHEET1_TRIGGER_CELLS.trigger, false);
}

export async function setWorkerStatus(text: string): Promise<void> {
  await setCell(config.controlTabName, CONTROL_CELLS.workerStatus, text);
}

/** Reads data rows (mobile, email, LinkedIn URL, name) for the inclusive [startRow, endRow] range. Columns D:E are unused/reserved and skipped. */
export async function readDataRows(startRow: number, endRow: number): Promise<SheetRow[]> {
  const values = await getRange(config.dataTabName, `A${startRow}:F${endRow}`);
  const rows: SheetRow[] = [];
  values.forEach((row, i) => {
    const mobileRaw = row[0]; // A
    const email = row[1]; // B
    const linkedinUrl = row[2]; // C
    // row[3], row[4] = D, E - unused/reserved, intentionally skipped
    const name = row[5]; // F
    const hasMobile = mobileRaw !== undefined && mobileRaw !== null && String(mobileRaw).trim() !== "";
    const hasEmail = email !== undefined && email !== null && String(email).trim() !== "";
    const hasLinkedIn = linkedinUrl !== undefined && linkedinUrl !== null && String(linkedinUrl).trim() !== "";
    if (!hasMobile && !hasEmail && !hasLinkedIn) return;
    rows.push({
      rowNumber: startRow + i,
      mobileRaw: hasMobile ? String(mobileRaw) : "",
      email: hasEmail ? String(email).trim() : "",
      name: String(name ?? ""),
      linkedinUrl: hasLinkedIn ? String(linkedinUrl).trim() : "",
    });
  });
  return rows;
}

/** Writes a row's phone-search result to D:F, or the email-search result to G:I, per the D/E treatment rules (spec 7.2). */
export async function writeChannelResult(rowNumber: number, channel: SearchChannel, result: CandidateResult): Promise<void> {
  const cols = channel === "phone" ? PHONE_RESULT_COLUMNS : EMAIL_RESULT_COLUMNS;
  const treatment = RESULT_TREATMENT[result.status];
  if (treatment === "preserve") {
    await setCell(config.dataTabName, `${cols.status}${rowNumber}`, result.status);
    return;
  }
  const modified = treatment === "overwrite" ? result.modified ?? "" : "";
  const active = treatment === "overwrite" ? result.active ?? "" : "";
  await setRow(config.dataTabName, `${cols.firstCol}${rowNumber}:${cols.lastCol}${rowNumber}`, [result.status, modified, active]);
}

/** Writes the LinkedIn "Open to Work" result to column K - always exactly "Yes" or "No". */
export async function writeLinkedInResult(rowNumber: number, result: LinkedInResult): Promise<void> {
  await setCell(config.dataTabName, `${LINKEDIN_RESULT_COLUMN}${rowNumber}`, result.status);
}

function formatTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export async function appendLog(entry: LogEntry): Promise<void> {
  await appendRow(config.logTabName, [
    formatTimestamp(entry.timestamp),
    entry.runId,
    entry.type,
    entry.level,
    entry.stage,
    entry.candidateRow ?? "",
    entry.candidateName ?? "",
    entry.attempt ?? "",
    entry.elapsedSeconds ?? "",
    entry.message,
    entry.errorCode ?? "",
  ]);
}
