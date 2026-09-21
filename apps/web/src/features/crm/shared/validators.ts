// Indian tax identifiers: validated and formatted the way the business rules expect (upper case, exact shape).
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function gstinProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!GSTIN_PATTERN.test(v)) return "A GSTIN has 15 characters, for example 27AAPFU0939F1ZV.";
  return null;
}

export function panProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!PAN_PATTERN.test(v)) return "A PAN has 10 characters, for example ABCDE1234F.";
  return null;
}

// A GSTIN embeds the PAN of the holder in characters 3 to 12.
export function gstinPanMismatch(gstin: string, pan: string): string | null {
  if (!GSTIN_PATTERN.test(gstin.trim()) || !PAN_PATTERN.test(pan.trim())) return null;
  return gstin.trim().slice(2, 12) === pan.trim() ? null : "The PAN does not match the one inside the GSTIN.";
}

export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return EMAIL_PATTERN.test(v) ? null : "Enter a valid email address, for example name@company.com.";
}
