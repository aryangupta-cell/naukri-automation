/** Masks a mobile number for logs, e.g. "9910926444" -> "******6444". Non-digit input passes through masked in full. */
export function maskMobile(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "*".repeat(value.length);
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}
