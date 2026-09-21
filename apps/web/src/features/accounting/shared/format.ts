// Accounting display formatting. Timestamps arrive as ISO strings; format for display only.
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
  active: "success",
  inactive: "neutral",
  draft: "neutral",
  review: "info",
  approved: "success",
  obsolete: "neutral",
  open: "warning",
  under_review: "warning",
  contained: "info",
  corrective_action: "info",
  verified: "success",
  closed: "neutral",
  cancelled: "neutral",
  released: "success",
  in_progress: "info",
  passed: "success",
  failed: "danger",
  conditionally_accepted: "warning",
  minor: "neutral",
  major: "warning",
  critical: "danger",
  analysis: "info",
  implementation: "info",
  verification: "warning",
  effective: "success",
  ineffective: "danger",
  planned: "neutral",
  completed: "success",
  qualified: "success",
  conditional: "warning",
  blocked: "danger",
  valid: "success",
  expired: "danger",
  superseded: "neutral",
  issued: "success",
  void: "neutral",
  investigating: "warning",
  resolved: "success",
  pass: "success",
  fail: "danger",
  adjusted: "warning",
  posted: "success",
  pending_approval: "warning",
  rejected: "danger",
  paid: "success",
  partially_paid: "info",
  applied: "success",
  partially_applied: "info",
  overdue: "danger",
  disputed: "danger",
  imported: "info",
  reconciling: "warning",
  reconciled: "success",
  soft_closed: "warning",
  locked: "danger",
  filed: "success",
  amended: "warning",
  reversed: "neutral",
  matched: "success",
  unmatched: "warning",
  exception: "danger",
  pending: "warning",
};
export const tone = (status: unknown): Tone => TONES[String(status ?? "").toLowerCase()] ?? "neutral";

export const money = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
};
