// Support display formatting. Timestamps arrive as ISO strings; format for display only.
export const quantity = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
};
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
export function dateTime(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateTimeFormatter.format(parsed);
}
// A calendar DATE can round-trip as a full ISO string; read the first 10 characters.
export const calendarDate = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 10) : "—");

export function label(value: unknown) {
  const text = String(value ?? "").replace(/[_-]/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONES: Record<string, Tone> = {
  active: "success",
  inactive: "neutral",
  draft: "neutral",
  new: "info",
  open: "warning",
  pending_customer: "warning",
  pending_internal: "warning",
  resolved: "success",
  closed: "neutral",
  cancelled: "neutral",
  merged: "neutral",
  review: "info",
  published: "success",
  retired: "neutral",
  acknowledged: "info",
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
  critical: "danger",
  suspended: "danger",
  expired: "neutral",
  clean: "success",
  infected: "danger",
  pending: "warning",
  failed: "danger",
  enrolled: "info",
  attended: "success",
};
export const tone = (status: unknown): Tone => TONES[String(status ?? "").toLowerCase()] ?? "neutral";
