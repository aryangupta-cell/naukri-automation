import { config } from "../config.js";
import { RESULT_TREATMENT } from "../domain/statuses.js";
import type { CandidateResult, LinkedInResult, LogEntry, SearchChannel, SheetRow } from "../domain/types.js";
import { appendRow, getRange, setCell, setRow } from "./sheets.js";

/** Automation Control cell map (fixed layout of the live "Automation Control" tab). */
const CONTROL_CELLS = {
  workerStatus: "B5",
} as const;

/**
 * Trigger cells live on the data tab itself: AA2 checkbox, AB2 start row,
 * AC2 end row (inclusive). Automation Control's B5 "Worker status" is still
 * written for dashboard visibility, but no longer read to decide anything.
 *
 * Row 1 is now group labels ("Employee Details"/"Naukri"/"Linkedin"/
 * "Controls"), row 2 is the actual header row, data starts at row 3.
 *
 * Data columns: A Name, B Mobile Number, C Email, D LinkedIn ID Link
 * (input), E Department (input - used only as a decoy search value, see
 * below), F:G Designation/Grade (informational, unused by the worker),
 * H:I unused/reserved, J:L Phone - Status/Modified/Active,
 * M:O Email - Status/Modified/Active, P Open to Work (output, strictly Yes/No).
 *
 * Per-row search order: Name (decoy) -> Phone -> Department (decoy) ->
 * Email -> LinkedIn. The decoy searches exist only to break up the
 * phone/email search pattern that Naukri flags as "too generic"/CAPTCHA;
 * their results are never read or written anywhere.
 */
const SHEET1_TRIGGER_CELLS = {
  trigger: "AA2",
  startRow: "AB2",
  endRow: "AC2",
} as const;

const PHONE_RESULT_COLUMNS = { status: "J", firstCol: "J", lastCol: "L" } as const;
const EMAIL_RESULT_COLUMNS = { status: "M", firstCol: "M", lastCol: "O" } as const;
const LINKEDIN_RESULT_COLUMN = "P";

export interface Sheet1ControlState {
  triggered: boolean;
  startRow: number;
  endRow: number;
}

export async function readSheet1ControlState(): Promise<Sheet1ControlState> {
  const values = await getRange(config.dataTabName, "AA2:AC2");
  const triggered = Boolean(values[0]?.[0]);
  const startRow = Number(values[0]?.[1]) || 3;
  const endRow = Number(values[0]?.[2]) || startRow;
  return { triggered, startRow, endRow };
}

export async function clearSheet1Trigger(): Promise<void> {
  await setCell(config.dataTabName, SHEET1_TRIGGER_CELLS.trigger, false);
}

export async function setWorkerStatus(text: string): Promise<void> {
  await setCell(config.controlTabName, CONTROL_CELLS.workerStatus, text);
}

/** Reads data rows (name, mobile, email, department, LinkedIn URL) for the inclusive [startRow, endRow] range. Columns F:I (Designation/Grade + reserved) are skipped. */
export async function readDataRows(startRow: number, endRow: number): Promise<SheetRow[]> {
  const values = await getRange(config.dataTabName, `A${startRow}:E${endRow}`);
  const rows: SheetRow[] = [];
  values.forEach((row, i) => {
    const name = row[0]; // A
    const mobileRaw = row[1]; // B
    const email = row[2]; // C
    const linkedinUrl = row[3]; // D
    const department = row[4]; // E
    const hasMobile = mobileRaw !== undefined && mobileRaw !== null && String(mobileRaw).trim() !== "";
    const hasEmail = email !== undefined && email !== null && String(email).trim() !== "";
    const hasLinkedIn = linkedinUrl !== undefined && linkedinUrl !== null && String(linkedinUrl).trim() !== "";
    if (!hasMobile && !hasEmail && !hasLinkedIn) return;
    rows.push({
      rowNumber: startRow + i,
      mobileRaw: hasMobile ? String(mobileRaw) : "",
      email: hasEmail ? String(email).trim() : "",
      name: String(name ?? ""),
      department: String(department ?? "").trim(),
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
