// Projects display formatting. Timestamps arrive as ISO strings; format for display only.
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
  draft: "neutral", planned: "info", active: "success", on_hold: "warning", completed: "success", cancelled: "neutral",
  todo: "neutral", in_progress: "info", blocked: "danger", review: "warning", done: "success",
  submitted: "warning", approved: "success", rejected: "danger", reimbursed: "success", pending_approval: "warning", superseded: "neutral",
  ready: "warning", requested: "info", invoiced: "success", open: "warning", resolved: "success", closed: "neutral",
  identified: "neutral", assessed: "info", mitigating: "warning", realized: "danger",
  on_track: "success", at_risk: "warning", off_track: "danger",
  low: "neutral", normal: "neutral", medium: "info", high: "warning", critical: "danger", urgent: "danger",
  issued: "success", returned: "neutral", fixed: "neutral", time_material: "info", milestone: "info",
  customer: "info", internal: "neutral", fixed_price: "neutral", time_and_material: "info", non_billable: "neutral",
};
export const tone = (status: unknown): Tone => TONES[String(status ?? "").toLowerCase()] ?? "neutral";

export const money = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
};
