import { config } from "../config.js";
import { RESULT_TREATMENT } from "../domain/statuses.js";
import type { CandidateResult, LogEntry, SheetRow } from "../domain/types.js";
import { appendRow, getRange, setCell, setRow } from "./sheets.js";

/** Automation Control cell map (fixed layout of the live "Automation Control" tab). */
const CONTROL_CELLS = {
  workerStatus: "B5",
} as const;

/**
 * Trigger cells live on the data tab itself (moved here from Automation
 * Control's B3/B4 checkbox+cap): P1 checkbox, Q1 start row, R1 end row
 * (inclusive). Automation Control's B5 "Worker status" is still written for
 * dashboard visibility, but no longer read to decide anything.
 */
const SHEET1_TRIGGER_CELLS = {
  trigger: "P1",
  startRow: "Q1",
  endRow: "R1",
} as const;

export interface Sheet1ControlState {
  triggered: boolean;
  startRow: number;
  endRow: number;
}

export async function readSheet1ControlState(): Promise<Sheet1ControlState> {
  const values = await getRange(config.dataTabName, "P1:R1");
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

/** Reads data rows (mobile, name, status) for the inclusive [startRow, endRow] range. */
export async function readDataRows(startRow: number, endRow: number): Promise<SheetRow[]> {
  const values = await getRange(config.dataTabName, `A${startRow}:C${endRow}`);
  const rows: SheetRow[] = [];
  values.forEach((row, i) => {
    const mobileRaw = row[0];
    if (mobileRaw === undefined || mobileRaw === null || String(mobileRaw).trim() === "") return;
    rows.push({
      rowNumber: startRow + i,
      mobileRaw: String(mobileRaw),
      name: String(row[1] ?? ""),
      status: String(row[2] ?? ""),
    });
  });
  return rows;
}

/** Writes a row's Status/Modified/Active per the D/E treatment rules (spec 7.2). */
export async function writeRowResult(rowNumber: number, result: CandidateResult): Promise<void> {
  const treatment = RESULT_TREATMENT[result.status];
  if (treatment === "preserve") {
    await setCell(config.dataTabName, `C${rowNumber}`, result.status);
    return;
  }
  const modified = treatment === "overwrite" ? result.modified ?? "" : "";
  const active = treatment === "overwrite" ? result.active ?? "" : "";
  await setRow(config.dataTabName, `C${rowNumber}:E${rowNumber}`, [result.status, modified, active]);
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
