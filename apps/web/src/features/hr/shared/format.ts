// HR & Payroll display formatting. Quantities and money arrive as decimal strings; format for display only.
export const quantity = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
};
export const amount = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—";
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
  pending_approval: "warning",
  submitted: "info",
  approved: "info",
  implemented: "success",
  completed: "success",
  posted: "success",
  planned: "neutral",
  released: "info",
  in_progress: "info",
  ready: "info",
  running: "info",
  open: "warning",
  blocked: "danger",
  on_hold: "warning",
  rejected: "danger",
  obsolete: "danger",
  cancelled: "neutral",
  overdue: "danger",
  error: "danger",
  warning: "warning",
  resolved: "success",
  calculated: "info",
  locked: "warning",
  closed: "neutral",
  paid: "success",
  held: "danger",
  failed: "danger",
  on_notice: "warning",
  on_leave: "info",
  suspended: "danger",
  separated: "neutral",
  verified: "success",
  applied: "success",
  done: "success",
  waived: "neutral",
  accepted: "info",
  withdrawn: "neutral",
  on_probation: "warning",
  extended: "warning",
  confirmed: "success",
};
export const tone = (status: unknown): Tone => TONES[String(status ?? "").toLowerCase()] ?? "neutral";
