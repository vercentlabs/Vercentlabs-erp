export const DEFAULT_LOCALE = "en-IN";
export const DEFAULT_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_CURRENCY = "INR";

export function normalizeCurrency(value, fallback = DEFAULT_CURRENCY) {
  const candidate = String(value || fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(candidate)) throw new TypeError("Currency must be a three-letter ISO code.");
  return candidate;
}

export function assertTimeZone(value) {
  const timeZone = String(value || DEFAULT_TIMEZONE).trim();
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
  catch { throw new TypeError("Timezone must be a valid IANA timezone."); }
  return timeZone;
}

export function formatMoney(amount, options = {}) {
  const numeric = Number(amount || 0);
  if (!Number.isFinite(numeric)) throw new TypeError("Money amount must be finite.");
  return new Intl.NumberFormat(options.locale || DEFAULT_LOCALE, {
    style: "currency",
    currency: normalizeCurrency(options.currency),
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
  }).format(numeric);
}

export function formatDateTime(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(options.locale || DEFAULT_LOCALE, {
    dateStyle: options.dateStyle || "medium",
    timeStyle: options.timeStyle || "short",
    timeZone: assertTimeZone(options.timeZone),
  }).format(date);
}

export function fiscalYearFor(value = new Date(), startMonth = 4) {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new RangeError("Fiscal year start month must be between 1 and 12.");
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Fiscal year date is invalid.");
  const year = date.getUTCMonth() + 1 >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return Object.freeze({ startYear: year, endYear: year + 1, label: `${year}-${String(year + 1).slice(-2)}` });
}
