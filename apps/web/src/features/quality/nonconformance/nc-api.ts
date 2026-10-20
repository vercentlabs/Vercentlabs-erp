"use client";

// Quality — the client of /api/quality/nonconformances: the queues and their counts, one NCR, every workflow step, evidence, the dashboard,
// options and the reports.
import { SpecApiError, qs } from "../specifications/spec-api";

export const NC_BASE = "/quality/nonconformances";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/quality${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SpecApiError(payload.message || "The request could not be completed.", response.status, payload.details?.code ?? payload.code, payload.details ?? payload);
  return payload as T;
}

export type Option = { value: string; label: string };
export type NcRow = { id: string; number: string; title: string; status: string; statusLabel: string; severity: string; severityLabel: string; source: string; sourceLabel: string;
  item: { id: string; code: string; name: string } | null; supplier: string | null; inspection: { id: string; number: string; href: string } | null;
  owner: { id: string; name: string } | null; affected: number | null; dueDate: string | null; overdue: boolean; openActions: number; overdueActions: number; detectedAt: string;
  closedAt: string | null; reopened: number };
export type NcAction = { id: string; sequence: number; type: string; typeLabel: string; description: string; owner: string | null; ownerId: string | null; dueDate: string | null;
  status: string; overdue: boolean; completedBy: string | null; completedAt: string | null; note: string | null; evidence: string[]; effectiveness: string | null;
  verifiedBy: string | null; verifiedAt: string | null; cancelReason: string | null };
export type NcDependency = { id: string; kind: "LINK" | "REJECTION" | "HOLD"; type: string; label: string; reference: string; note: string | null; blocking: boolean; status: string;
  doneBy?: string | null; doneAt?: string | null; doneNote?: string | null; href: string | null };
type Stamp = { at: string | null; by: string | null };
export type NcDetail = NcRow & {
  description: string; category: string | null; defectCode: string | null; detected: number | null; rowVersion: number; detectedBy: string | null;
  containment: ({ action: string; due: string | null } & Stamp) | null; investigation: ({ rootCause: string; method: string | null; methodLabel: string | null; summary: string | null } & Stamp) | null;
  verification: ({ summary: string | null } & Stamp) | null; resolution: ({ summary: string } & Stamp) | null; closure: ({ note: string | null } & Stamp) | null;
  items: Array<{ id: string; item: string | null; batch: string | null; serial: string | null; warehouse: string | null; quantity: number | null; description: string | null }>;
  observations: Array<{ id: string; sample: string | null; characteristic: string; criticality: string; outcome: string; reason: string | null; value: string | null }>;
  actions: NcAction[]; dependencies: NcDependency[]; files: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
  history: Array<{ type: string; label: string; at: string; actor: string | null; detail: string | null }>;
  can: Record<"edit" | "assign" | "startReview" | "contain" | "investigate" | "addAction" | "completeAction" | "requireAction" | "submit" | "verify" | "close" | "reopen" | "cancel" | "link" | "upload", boolean>;
};
export type NcCounts = Record<"open" | "mine" | "new" | "review" | "action" | "verification" | "resolved" | "closed" | "overdue" | "critical" | "cancelled", number>;
export type NcDashboard = { counts: NcCounts; raised90: number; closed90: number; averageDays: number | null; reopened: number; openActions: number; overdueActions: number;
  ineffectiveActions: number; bySeverity: Record<string, number> };
export type NcOptions = { members: Option[]; items: Option[]; inspections: Option[]; severities: Option[]; sources: Option[]; actionTypes: Option[]; methods: Option[]; linkTypes: Option[];
  reports: Option[]; canCreate: boolean; canExport: boolean };
export type NcReport = { kind: string; title: string; rows: Array<Record<string, unknown>> };

export const ncApi = {
  list: (view: string, search: string, severity = "", from = "", to = "") => call<{ rows: NcRow[] }>(`/nonconformances${qs({ view, search, severity, from, to })}`),
  counts: () => call<{ counts: NcCounts }>("/nonconformances/view/counts").then((r) => r.counts),
  dashboard: () => call<NcDashboard>("/nonconformances/view/dashboard"),
  options: () => call<NcOptions>("/nonconformances/view/options"),
  get: (id: string) => call<NcDetail>(`/nonconformances/${id}`),
  create: (body: Record<string, unknown>) => call<{ id: string }>("/nonconformances", { method: "POST", body: JSON.stringify(body) }),
  action: (id: string, action: string, body: Record<string, unknown> = {}) => call<Record<string, unknown>>(`/nonconformances/${id}/${action}`, { method: "POST", body: JSON.stringify(body) }),
  report: (kind: string, from = "", to = "") => call<NcReport>(`/reports/nonconformances${qs({ kind, from, to })}`),
  csvHref: (kind: string, from = "", to = "") => `/api/quality/reports/nonconformances${qs({ kind, from, to, format: "csv" })}`,
  evidenceHref: (id: string, fileId: string) => `/api/quality/nonconformances/${id}/files/${fileId}`,
  upload: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ file: { id: string; fileName: string } }>(`/nonconformances/${id}/files`, { method: "POST", body: form });
  },
  remove: (id: string, fileId: string) => call<{ removed: boolean }>(`/nonconformances/${id}/files/${fileId}`, { method: "DELETE" }),
};

export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { OPEN: "info", UNDER_REVIEW: "info", ACTION_REQUIRED: "warning",
  VERIFICATION_PENDING: "warning", RESOLVED: "success", CLOSED: "neutral", CANCELLED: "neutral" };
export const SEVERITY_TONE: Record<string, "neutral" | "warning" | "danger"> = { minor: "neutral", major: "warning", critical: "danger" };
export const STEPS = ["OPEN", "UNDER_REVIEW", "ACTION_REQUIRED", "VERIFICATION_PENDING", "RESOLVED", "CLOSED"] as const;
export const STEP_LABEL: Record<string, string> = { OPEN: "Open", UNDER_REVIEW: "Under review", ACTION_REQUIRED: "Action required", VERIFICATION_PENDING: "Verification", RESOLVED: "Resolved",
  CLOSED: "Closed" };
export const num = (value: number | null | undefined) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 }));
