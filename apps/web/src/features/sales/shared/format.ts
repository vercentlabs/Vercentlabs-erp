// Sales-side display formatting. Money comes back from the API as numeric
// strings; format for display only -- never for arithmetic. Indian style
// (Line-by-line audit): ₹ for rupees, lakh grouping (₹12,34,567.00) and
// DD-MM-YYYY dates.
export function money(
  currencyCode: string | null | undefined,
  value: number | string | null | undefined,
) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const formatted = Number.isFinite(numeric)
    ? numeric.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : String(value);
  const code = (currencyCode ?? "").trim();
  if (code === "INR") return numeric < 0 ? `-₹${formatted.replace(/^-/, "")}` : `₹${formatted}`;
  return `${code} ${formatted}`.trim();
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});
export function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : dateTimeFormatter.format(parsed);
}

// A calendar DATE column can round-trip as a full ISO string; read the first 10
// characters rather than re-parsing in the browser's timezone (same rule POS uses).
export const calendarDate = (value: string | null | undefined) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split("-").reverse().join("-") : typeof value === "string" && value ? value : "—";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
const TONES: Record<string, StatusTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  sent: "info",
  viewed: "info",
  accepted: "success",
  confirmed: "success",
  completed: "success",
  fulfilled: "success",
  invoiced: "success",
  paid: "success",
  rejected: "danger",
  expired: "danger",
  cancelled: "neutral",
  on_hold: "warning",
  partially_fulfilled: "warning",
  partially_invoiced: "warning",
  pending: "warning",
  failed: "danger",
};
export const statusTone = (status: string | null | undefined): StatusTone =>
  TONES[String(status ?? "").toLowerCase()] ?? "neutral";
export function statusLabel(status: string | null | undefined) {
  const text = String(status ?? "")
    .replace(/_/g, " ")
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}
