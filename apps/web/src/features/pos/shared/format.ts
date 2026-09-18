// node-postgres returns NUMERIC columns as strings — coerce defensively
// (same rationale as apps/web/src/features/crm/shared/format.ts's money(),
// duplicated locally rather than cross-imported so POS doesn't depend on
// CRM's file layout).
export function money(currencyCode: string | null | undefined, value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const formatted = Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
  return `${currencyCode || ""} ${formatted}`.trim();
}

// A calendar DATE column (e.g. pos_day_end_reports.business_date) round-trips
// through the API as either "YYYY-MM-DD" or, once node-postgres/JSON hand it
// back as a Date, a full "YYYY-MM-DDTHH:mm:ss.sssZ" string. Slicing the first
// 10 characters reads the calendar date as stored, deliberately avoiding
// `new Date(value).toLocaleDateString()` -- that re-parses in the browser's
// local timezone and can shift the displayed day by one (the exact bug this
// replaces: a UTC-midnight datetime rendered a day early in IST).
export function calendarDate(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}
