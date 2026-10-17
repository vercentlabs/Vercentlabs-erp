"use client";

// Quality — the client of /api/quality/specifications: the directory and its views, one specification (versions, checks, sampling,
// applicability, history, documents, usage), every lifecycle action, the inspector preview, conflicts and exceptions, reports and settings.
export const SPEC_BASE = "/quality/specifications";
export class SpecApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/quality/specifications${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SpecApiError(payload.message || "The request could not be completed.", response.status, payload.details?.code ?? payload.code, payload.details ?? payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof SpecApiError ? error.status : 0);
export const errorIssues = (error: unknown): Issue[] => (error instanceof SpecApiError && Array.isArray(error.details.issues) ? (error.details.issues as Issue[]) : []);
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
export const dateLabel = (value: string | null | undefined) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

export type Option = { value: string; label: string; code?: string; dimension?: string | null };
export type Issue = { code: string; message: string; characteristic?: string };
export type SpecRow = { id: string; code: string; name: string; description: string; stage: string; stageLabel: string; item: string | null; category: string | null; template: boolean; status: string;
  active: { id: string; number: number; effectiveFrom: string } | null; open: { id: string; number: number; status: string; statusLabel: string } | null;
  current: { number: number; status: string; statusLabel: string; effectiveFrom: string } | null; checks: number; rules: number; supplierSpecific: boolean; updatedAt: string; href: string };
export type Check = { id: string; code: string; sequence: number; name: string; type: string; typeLabel: string; instructions: string; acceptanceText: string | null; acceptable: string;
  evidenceNote: string | null; uomId: string | null; unit: string | null; targetValue: string | null; lowerTolerance: string | null; upperTolerance: string | null; lowerLimit: string | null;
  upperLimit: string | null; lowerInclusive: boolean; upperInclusive: boolean; decimalPlaces: number; measurementRounding: string; expectedBoolean: boolean | null;
  allowedValues: Array<{ value: string; label: string; acceptable: boolean }>; judgement: string | null; criticality: string; criticalityLabel: string; required: boolean; allowNa: boolean;
  evidenceRequired: boolean; instrument: string | null };
export type VersionView = { id: string; number: number; status: string; statusLabel: string; stage: string; method: string; methodLabel: string;
  sampling: { method: string; label: string; value: string | null; minimum: number | null; maximum: number | null; rounding: string; roundingLabel: string; basis: string; lotContext: string; instructions: string | null; sentence: string };
  decision: { rule: string; label: string; allowedMajor: number | null; allowedMinor: number | null }; effectiveFrom: string; effectiveUntil: string | null; revisionReason: string | null;
  submittedAt: string | null; reviewedAt: string | null; reviewNote: string | null; approvedAt: string | null; approvalNote: string | null; publishedAt: string | null; activatedAt: string | null;
  supersededAt: string | null; retiredAt: string | null; contentHash: string | null; createdAt: string; legacy: boolean; version: number };
export type Rule = { id: string; scope: string; scopeLabel: string; item: string | null; category: string | null; supplier: string | null; site: string | null; effectiveFrom: string; effectiveUntil: string | null;
  specificity: number; status: string; reason: string | null; deactivationReason: string | null; describe: string };
export type Comparison = { from: number; changes: Array<{ field: string; before: unknown; after: unknown }>; added: string[]; removed: string[];
  modified: Array<{ code: string; name: string; fields: string[]; before: string; after: string }> };
export type SpecDetail = { id: string; code: string; name: string; description: string; stage: string; stageLabel: string; operational: boolean; integration: string | null;
  item: { id: string; code: string; name: string; active: boolean } | null; category: { id: string; name: string } | null; template: boolean; status: string; retiredAt: string | null; retiredBy: string | null;
  retireReason: string | null; legacyPlanCode: string | null; createdBy: string | null; createdAt: string; version: number;
  selected: VersionView & { checks: Check[]; issues: Issue[]; valid: boolean; comparison: Comparison | null; createdBy: string | null; submittedBy: string | null; reviewedBy: string | null; approvedBy: string | null;
    publishedBy: string | null; integrity: { recorded: string; intact: boolean } | null };
  versions: Array<{ id: string; number: number; status: string; statusLabel: string; effectiveFrom: string; effectiveUntil: string | null; approvedAt: string | null; revisionReason: string | null; current: boolean }>;
  active: { id: string; number: number; effectiveFrom: string } | null; open: { id: string; number: number; status: string } | null; rules: Rule[];
  conflicts: Array<{ ruleId: string; conflictsWith: string; conflictingSpecificationId: string }>; usage: { inspections: number; open: number };
  policy: { prohibitSelfApproval: boolean; approvalNoteRequired: boolean };
  can: Record<"edit" | "submit" | "review" | "approve" | "publish" | "revise" | "copy" | "retire" | "applicability" | "history" | "documents" | "upload" | "export", boolean>; href: string };
export type Preview = { title: string; code: string; version: number; status: string; stage: string; method: string; sampling: string; decision: string; draft: boolean;
  rows: Array<{ sequence: number; check: string; how: string; acceptable: string; proof: string | null; critical: boolean; required: boolean; notApplicableAllowed: boolean; informational: boolean }> };
export type HistoryEvent = { id: string; action: string; version: number | null; from: string | null; to: string | null; note: string | null; details: Record<string, unknown>; by: string; at: string };
export type Options = { items: Option[]; categories: Option[]; suppliers: Option[]; sites: Option[]; units: Option[]; stages: Option[]; checkTypes: Option[]; criticality: Option[]; sampling: Option[];
  decisions: Option[]; rounding: Option[]; scopes: Option[] };
export type ExceptionRow = { id: string; code: string; label: string; stage: string; item: string | null; supplier: string | null; site: string | null; source: string | null; sourceHref: string | null;
  status: string; resolvedBy: string | null; resolution: string | null; raisedAt: string; resolvedAt: string | null };
export type Overview = { counts: Record<string, number>; pending: Array<{ id: string; code: string; name: string; version: number; submittedAt: string; href: string }>;
  can: { create: boolean; review: boolean; settings: boolean; export: boolean } };
export type Report = { kind: string; title: string; columns: string[]; rows: Array<Record<string, unknown> & { href?: string }> };
export type Settings = { policy: { prohibitSelfApproval: boolean; approvalNoteRequired: boolean }; stages: Array<{ value: string; label: string; operational: boolean; integration: string }>;
  gates: Array<{ value: string; label: string; stage: string; enabled: boolean; gates: string[] }>; can: { manage: boolean } };

export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", PENDING_REVIEW: "info", CHANGES_REQUESTED: "warning", APPROVED: "info",
  ACTIVE: "success", SUPERSEDED: "neutral", RETIRED: "neutral", REJECTED: "danger" };
export const REPORTS: Array<{ id: string; label: string }> = [
  { id: "register", label: "Specification Register" }, { id: "active", label: "Active Approved Specifications" }, { id: "backlog", label: "Draft / Pending Approval" },
  { id: "by-item", label: "Specifications by Item" }, { id: "by-stage", label: "Specifications by Stage" }, { id: "supplier-specific", label: "Supplier-Specific Specifications" },
  { id: "missing-criteria", label: "Specifications Missing Required Criteria" }, { id: "conflicts", label: "Conflicting Applicability Rules" }, { id: "revisions", label: "Specification Revision History" },
  { id: "usage", label: "Specifications Used in Inspections" }, { id: "retired", label: "Retired / Superseded Specifications" }, { id: "coverage-gaps", label: "Inspection Coverage Gaps" },
];

export const listSpecs = (view: string, search = "", stage = "") => call<{ rows: SpecRow[]; view: string; can: { create: boolean; export: boolean; drafts: boolean } }>(qs({ view, search: search || undefined, stage: stage || undefined }));
export const createSpec = (body: Record<string, unknown>) => send<{ specificationId: string; versionId: string; code: string }>("", body);
export const getSpec = (id: string, versionId?: string) => call<SpecDetail>(`/${id}${qs({ versionId })}`);
export const getHistory = (id: string) => call<{ versions: Array<VersionView & { approver: string | null; preparer: string | null }>; events: HistoryEvent[] }>(`/${id}${qs({ part: "history" })}`);
export const getUsage = (id: string) => call<{ inspections: Array<{ id: string; number: string; status: string; source: string; item: string | null; version: number; lot: string; sample: string; method: string | null; at: string; href: string }> }>(`/${id}${qs({ part: "usage" })}`);
export const getPreview = (id: string, versionId: string) => call<Preview>(`/${id}${qs({ part: "preview", versionId })}`);
export const specAction = <T = Record<string, unknown>>(id: string, action: string, body: Record<string, unknown> = {}) => send<T>(`/${id}/${action}`, body);
export const getOptions = () => call<{ options: Options }>("/view/options");
export const getOverview = () => call<Overview>("/view/overview");
export const getConflicts = () => call<{ conflicts: Array<{ stage: string; stageLabel: string; scope: string; first: { code: string; name: string; href: string }; second: { code: string; name: string; href: string }; message: string }>; exceptions: ExceptionRow[] }>("/view/conflicts");
export const getExceptions = (status = "OPEN") => call<{ rows: ExceptionRow[]; can: { resolve: boolean } }>(`/view/exceptions${qs({ status })}`);
export const getReport = (kind: string) => call<Report>(`/view/report${qs({ kind })}`);
export const exportHref = (kind: string) => `/api/quality/specifications/view/export${qs({ kind })}`;
export const getSettings = () => call<Settings>("/view/settings");
export const settingsAction = (action: string, body: Record<string, unknown> = {}) => send(`/settings/${action}`, body);
export const listFiles = (id: string) => call<{ files: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }> }>(`/${id}/files`);
export const fileHref = (id: string, fileId: string) => `/api/quality/specifications/${id}/files/${fileId}`;
export async function uploadFile(id: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/quality/specifications/${id}/files`, { method: "POST", body: form, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SpecApiError(payload.message || "The upload failed.", response.status);
  return payload;
}
export async function archiveFile(id: string, fileId: string) {
  const response = await fetch(fileHref(id, fileId), { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) throw new SpecApiError("The document could not be archived.", response.status);
}

// Bulk entry: one check per line — "Name | range 0.95-1.05 M", "Name | target 10 -0.1 +0.15 MM", "Name | yes/no", "Name | choice Good*, Minor*, Severe",
// "Name | visual No cracks", "Name | note". A trailing "!" on the name marks the check critical.
export function parseBulkChecks(textValue: string): Array<Record<string, unknown>> {
  return textValue.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [rawName, rawRule = "visual"] = line.split("|").map((part) => part.trim());
    const critical = rawName.endsWith("!");
    const name = critical ? rawName.slice(0, -1).trim() : rawName;
    const [kind, ...rest] = rawRule.split(/\s+/);
    const tail = rest.join(" ");
    const base = { name, criticality: critical ? "CRITICAL" : "MAJOR" };
    switch (kind.toLowerCase()) {
      case "range": {
        const m = tail.match(/^(-?[\d.]+)\s*-\s*(-?[\d.]+)\s*(\S+)?$/);
        if (!m) throw new Error(`Line ${index + 1}: write the range as "range 0.95-1.05 M".`);
        return { ...base, checkType: "NUMERIC_RANGE", lowerLimit: m[1], upperLimit: m[2], unitCode: m[3] };
      }
      case "target": {
        const m = tail.match(/^(-?[\d.]+)\s+-([\d.]+)\s+\+([\d.]+)\s*(\S+)?$/);
        if (!m) throw new Error(`Line ${index + 1}: write the target as "target 10 -0.1 +0.15 MM".`);
        return { ...base, checkType: "NUMERIC_TARGET_TOLERANCE", targetValue: m[1], lowerTolerance: m[2], upperTolerance: m[3], unitCode: m[4] };
      }
      case "yes/no": case "boolean": case "test": return { ...base, checkType: "BOOLEAN", expectedBoolean: true, acceptanceText: tail || undefined };
      case "choice": return { ...base, checkType: "ENUM", allowedValues: tail.split(",").map((v) => v.trim()).filter(Boolean) };
      case "note": return { ...base, checkType: "TEXT_OBSERVATION", judgement: "INFORMATIONAL", criticality: "INFORMATIONAL" };
      default: return { ...base, checkType: "VISUAL", acceptanceText: kind.toLowerCase() === "visual" ? tail : rawRule };
    }
  });
}
