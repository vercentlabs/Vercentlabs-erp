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

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// A full timestamp (created_at, closed_at, …) in the same "en-IN" medium
// date + short time style CRM's lists use, instead of each screen calling
// toLocaleString() and getting whatever the browser's locale happens to be.
export function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateTimeFormatter.format(parsed);
}

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

// One status -> StatusBadge tone map for every POS lifecycle word, so
// "completed" is the same colour on the Transactions list, a receipt and a
// Z report rather than each screen deciding for itself.
const STATUS_TONES: Record<string, StatusTone> = {
  active: "success",
  completed: "success",
  closed: "success",
  posted: "success",
  approved: "success",
  resolved: "success",
  paid: "success",
  reviewed: "info",
  open: "info",
  draft: "neutral",
  held: "warning",
  pending: "warning",
  requested: "warning",
  partially_returned: "warning",
  variance: "warning",
  syncing: "warning",
  inactive: "neutral",
  void: "neutral",
  voided: "neutral",
  cancelled: "neutral",
  returned: "neutral",
  failed: "danger",
  rejected: "danger",
  conflict: "danger",
  error: "danger",
};

export function statusTone(status: string | null | undefined): StatusTone {
  return STATUS_TONES[String(status ?? "").toLowerCase()] ?? "neutral";
}

// "partially_returned" -> "Partially returned"; acronyms keep their form.
const ACRONYM_LABELS: Record<string, string> = { upi: "UPI", pos: "POS" };
export function statusLabel(status: string | null | undefined) {
  const raw = String(status ?? "").trim().toLowerCase();
  if (ACRONYM_LABELS[raw]) return ACRONYM_LABELS[raw];
  const text = String(status ?? "").replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}
