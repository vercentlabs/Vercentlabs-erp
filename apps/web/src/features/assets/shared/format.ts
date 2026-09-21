// Assets display formatting. Timestamps arrive as ISO strings; format for display only.
export const quantity = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
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
  draft: "neutral", available: "success", assigned: "info", in_maintenance: "warning", retired: "neutral", pending_disposal: "warning", lost: "danger", disposed: "neutral",
  submitted: "warning", approved: "success", rejected: "danger", completed: "success", cancelled: "neutral", pending_approval: "warning", posted: "success", reversed: "neutral",
  calculated: "info", ready: "info", planned: "neutral", scheduled: "info", in_progress: "info", on_hold: "warning", open: "warning", settled: "success", expired: "danger",
  expiring: "warning", active: "success", overdue: "danger", due_soon: "warning", valid: "success", pass: "success", conditional: "warning", fail: "danger", adjusted: "warning",
  matched: "success", moved: "warning", missing: "danger", unexpected: "warning", damaged: "danger", pending: "neutral", resolved: "success", closed: "neutral",
  low: "neutral", medium: "info", high: "warning", critical: "danger", excellent: "success", good: "success", fair: "warning", poor: "danger", urgent: "danger", normal: "neutral",
  not_required: "neutral", not_configured: "warning",
};
export const tone = (status: unknown): Tone => TONES[String(status ?? "").toLowerCase()] ?? "neutral";

export const money = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
};
