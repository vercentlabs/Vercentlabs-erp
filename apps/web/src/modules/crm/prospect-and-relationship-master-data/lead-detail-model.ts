export type Row = Record<string, unknown>;
export type Option = {
  id: string;
  name: string;
  status?: string;
  code?: string;
  sortOrder?: number;
  allowedFromCodes?: string[];
};
export type TimelineEvent = Row & {
  __kind: string;
  __date: unknown;
  __title: unknown;
};
export function num(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}
export function nice(value: unknown) {
  return String(value ?? "—")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
export function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
export function objectValue(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Row;
}
export function jsonText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}
export function scoreText(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? `${Math.round(score)}%` : "—";
}
export function assignmentReason(event: Row) {
  if (event.policy_name) return `Automatic rule: ${String(event.policy_name)}`;
  const reason = String(event.reason || "manual");
  if (reason.startsWith("capture-form:")) return "Capture form assignment";
  if (reason.startsWith("policy:")) return "Automatic assignment rule";
  if (reason.startsWith("manual:")) return "Manual assignment";
  return "Assignment update";
}
