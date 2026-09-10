import type { CrmField } from "@/modules/crm";
import type { StatusTone } from "@/shared/design";

export type Row = Record<string, unknown>;
export type Option = {
  id: string;
  name: string;
  status?: string;
  pipelineId?: string;
  code?: string;
  sortOrder?: number;
  allowedFromCodes?: string[];
};
export type LeadFilters = {
  ownerId?: string;
  sourceId?: string;
  priority?: string;
  rating?: string;
  followup?: string;
  qualification?: string;
};
export type BulkJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "dead" | "cancelled";
  progress?: {
    requested?: number;
    processed?: number;
    pending?: number;
    applied?: number;
    conflict?: number;
    skipped?: number;
    failed?: number;
    percent?: number;
  };
  resultManifest?: Record<string, number>;
  lastError?: string | null;
};

export type SavedView = {
  id: string;
  name: string;
  filters?: Record<string, unknown>;
  visibility?: "private" | "team" | "organization";
  team_id?: string | null;
  team_name?: string | null;
  can_delete?: boolean;
};

export const KANBAN_PAGE_SIZE = 6;

export function num(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}
export function nice(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value)
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
export function statusTone(status: unknown): StatusTone {
  const value = String(status || "new");
  if (value === "new") return "info";
  if (value === "contacted" || value === "working") return "warning";
  if (value === "converted") return "success";
  return "neutral";
}
export function qualificationTone(state: unknown): StatusTone {
  const value = String(state || "not_reviewed");
  if (value === "qualified") return "success";
  if (value === "unqualified") return "danger";
  return "neutral";
}
export function leadName(row: Row) {
  return String(
    row.fullName ||
      row.companyName ||
      row.email ||
      row.mobile ||
      row.code ||
      "Lead",
  );
}
export function initials(row: Row) {
  const parts = leadName(row).trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || "L"}${parts[1]?.[0] || ""}`.toUpperCase();
}
export function money(value: unknown, currency: unknown) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: String(currency || "INR"),
      maximumFractionDigits: 0,
    }).format(num(value));
  } catch {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
      num(value),
    );
  }
}
export function dateTime(value: unknown) {
  if (!value) return "No follow-up";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
export function followState(value: unknown) {
  if (!value) return "none";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "none";
  const now = new Date();
  if (date < now) return "overdue";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date >= today && date < tomorrow ? "today" : "scheduled";
}
export function optionName(
  options: Record<string, Option[]>,
  key: string,
  value: unknown,
) {
  return value
    ? options[key]?.find((item) => item.id === String(value))?.name ||
        String(value)
    : "";
}
export function leadOwnerName(row: Row) {
  const name = String(row.ownerName || "").trim();
  if (!name) return "Unassigned";
  return row.ownerStatus === "inactive" ? `${name} (Inactive)` : name;
}
export function rawDefault(field: CrmField, row: Row) {
  const value = row[field.name];
  if (field.type === "date" || field.type === "datetime-local") {
    if (!value) return "";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "";
    return field.type === "date"
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 16);
  }
  if (value !== undefined && value !== null) return String(value);
  return field.type === "number" ? "0" : field.options?.[0]?.value || "";
}
