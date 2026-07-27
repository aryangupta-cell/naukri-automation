import { config } from "../config.js";
import { RESULT_TREATMENT } from "../domain/statuses.js";
import type { CandidateResult, LogEntry, SheetRow } from "../domain/types.js";
import { appendRow, getRange, setCell, setRow } from "./sheets.js";

/** Automation Control cell map (fixed layout of the live "Automation Control" tab). */
const CONTROL_CELLS = {
  trigger: "B3", // checkbox
  maxRows: "B4",
  workerStatus: "B5",
} as const;

export interface ControlState {
  triggered: boolean;
  maxRows: number;
  workerStatus: string;
}

export async function readControlState(): Promise<ControlState> {
  const values = await getRange(config.controlTabName, "A3:B5");
  const triggered = Boolean(values[0]?.[1]);
  const maxRows = Number(values[1]?.[1]) || 10;
  const workerStatus = String(values[2]?.[1] ?? "");
  return { triggered, maxRows, workerStatus };
}

export async function clearTrigger(): Promise<void> {
  await setCell(config.controlTabName, CONTROL_CELLS.trigger, false);
}

export async function setWorkerStatus(text: string): Promise<void> {
  await setCell(config.controlTabName, CONTROL_CELLS.workerStatus, text);
}

/** Reads all data rows (mobile, name, status) from row 2 to the last populated row of Column A. */
export async function readDataRows(): Promise<SheetRow[]> {
  const values = await getRange(config.dataTabName, "A2:C");
  const rows: SheetRow[] = [];
  values.forEach((row, i) => {
    const mobileRaw = row[0];
    if (mobileRaw === undefined || mobileRaw === null || String(mobileRaw).trim() === "") return;
    rows.push({
      rowNumber: i + 2,
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
