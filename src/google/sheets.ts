import { getSheetsClient } from "./auth.js";
import { config } from "../config.js";

function a1(tab: string, range: string): string {
  // Tab names can contain spaces, so always quote them for A1 notation.
  return `'${tab}'!${range}`;
}

export async function getRange(tab: string, range: string): Promise<unknown[][]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: a1(tab, range),
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return res.data.values ?? [];
}

export async function getCell(tab: string, cell: string): Promise<unknown> {
  const values = await getRange(tab, cell);
  return values[0]?.[0];
}

export async function setCell(tab: string, cell: string, value: unknown): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: a1(tab, cell),
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value as never]] },
  });
}

export async function setRow(tab: string, range: string, row: unknown[]): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: a1(tab, range),
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row as never[]] },
  });
}

export async function appendRow(tab: string, row: unknown[]): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: a1(tab, "A:A"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row as never[]] },
  });
}

/** Confirms the configured tabs exist and are reachable with current credentials. */
export async function verifyAccess(): Promise<{ title: string; tabs: string[] }> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  const tabs = (res.data.sheets ?? []).map((s) => s.properties?.title ?? "");
  return { title: res.data.properties?.title ?? "", tabs };
}
