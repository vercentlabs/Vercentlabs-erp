// Procurement display formatting. Money arrives as decimal strings; format for
// display only, never for arithmetic.
export function money(currencyCode: string | null | undefined, value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const formatted = Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
  return `${currencyCode || ""} ${formatted}`.trim();
}
export const quantity = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
export function dateTime(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateTimeFormatter.format(parsed);
}
// A calendar DATE can round-trip as a full ISO string; read the first 10 characters
// rather than re-parsing in the browser's timezone.
export const calendarDate = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 10) : "—");

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
const TONES: Record<string, StatusTone> = {
  draft: "neutral",
  submitted: "info",
  pending_approval: "warning",
  approved: "info",
  qualified: "info",
  active: "success",
  dispatched: "info",
  acknowledged: "info",
  partially_received: "warning",
  received: "success",
  closed: "neutral",
  matched: "success",
  resolved: "success",
  completed: "success",
  open: "warning",
  overridden: "warning",
  suspended: "warning",
  rejected: "danger",
  blocked: "danger",
  cancelled: "neutral",
  reversed: "danger",
  failed: "danger",
  pending: "warning",
};
export const statusTone = (status: unknown): StatusTone => TONES[String(status ?? "").toLowerCase()] ?? "neutral";
export function statusLabel(status: unknown) {
  const text = String(status ?? "").replace(/[_-]/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}
