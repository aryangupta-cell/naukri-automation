import type { NormalizedMobile } from "./types.js";

/**
 * Normalises a raw Column A value into a 10-digit Indian mobile number.
 * Handles spreadsheet-numeric values (trailing ".0"), spaces, hyphens,
 * parentheses and a leading +91/91.
 */
export function normalizeMobile(raw: string | number | null | undefined): NormalizedMobile {
  if (raw === null || raw === undefined) {
    return { valid: false, digits10: null, reason: "empty" };
  }

  let s = String(raw).trim();
  if (s === "") {
    return { valid: false, digits10: null, reason: "empty" };
  }

  // Spreadsheet numeric formatting can produce "9910926444.0".
  s = s.replace(/\.0$/, "");
  // Strip everything that isn't a digit or a leading +.
  s = s.replace(/[\s\-()]/g, "");

  if (s.startsWith("+91")) {
    s = s.slice(3);
  } else if (s.startsWith("91") && s.length === 12) {
    s = s.slice(2);
  }

  if (!/^\d+$/.test(s)) {
    return { valid: false, digits10: null, reason: "non-numeric" };
  }

  if (s.length !== 10) {
    return { valid: false, digits10: null, reason: `expected 10 digits, got ${s.length}` };
  }

  return { valid: true, digits10: s };
}
