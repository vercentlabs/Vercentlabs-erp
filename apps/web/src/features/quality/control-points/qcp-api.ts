"use client";

// Quality — the client of /api/quality/control-points: the directory, one control point, its lifecycle, inspection requirements with their
// gate and waivers, conflicts and exceptions, preview, reports and the Quality overview queues.
import { SpecApiError, qs } from "../specifications/spec-api";

export const QCP_BASE = "/quality/control-points";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/quality/control-points${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SpecApiError(payload.message || "The request could not be completed.", response.status, payload.details?.code ?? payload.code, payload.details ?? payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Option = { value: string; label: string; stage?: string };
export type QcpRow = { id: string; code: string; name: string; description: string; status: string; stage: string; stageLabel: string; trigger: string; requirement: string; gate: string; mode: string;
  specification: string | null; rules: number; openRequirements: number; active: { id: string; number: number; effectiveFrom: string } | null;
  open: { id: string; number: number; status: string; statusLabel: string } | null; href: string };
export type QcpRule = { id: string; scope: string; scopeLabel: string; itemId: string | null; itemGroupId: string | null; supplierId: string | null; warehouseId: string | null; specificity: number; describe: string };
export type QcpVersion = { id: string; number: number; status: string; statusLabel: string; stage: string; stageLabel: string; trigger: string; triggerLabel: string; triggerEnabled: boolean;
  requirement: string; requirementLabel: string; gate: string; gateLabel: string; binding: string; bindingLabel: string; specificationId: string | null; specVersionId: string | null;
  matchMode: string; matchModeLabel: string; purpose: string; quantityScope: string; lotContext: string; waiverAllowed: boolean; effectiveFrom: string; effectiveUntil: string | null;
  revisionReason: string | null; submittedAt: string | null; reviewNote: string | null; approvedAt: string | null; approvalNote: string | null; publishedAt: string | null; activatedAt: string | null;
  supersededAt: string | null; contentHash: string | null; version: number };
export type QcpDetail = { id: string; code: string; name: string; description: string; status: string; retiredAt: string | null; retireReason: string | null; carriedOver: boolean; createdAt: string; version: number;
  selected: QcpVersion & { rules: QcpRule[]; issues: Array<{ code: string; message: string }>; valid: boolean; integrity: { intact: boolean } | null;
    comparison: { from: number; changes: Array<{ field: string; before: unknown; after: unknown }>; rulesAdded: string[]; rulesRemoved: string[] } | null;
    standard: { id: string; code: string; name: string; stage: string; status: string; activeVersion: number | null; lockedVersion: number | null; href: string } | null };
  versions: Array<{ id: string; number: number; status: string; statusLabel: string; effectiveFrom: string; effectiveUntil: string | null; revisionReason: string | null; current: boolean }>;
  active: { id: string; number: number } | null; open: { id: string; number: number; status: string } | null; requirements: { total: number; open: number };
  can: Record<"edit" | "gate" | "submit" | "review" | "approve" | "publish" | "revise" | "copy" | "retire" | "history" | "export" | "manual", boolean>; href: string };
export type Requirement = { id: string; controlPoint: string; controlPointId: string; version: number; purpose: string; source: string | null; sourceType: string; sourceHref: string | null; item: string | null;
  specification: string | null; specificationHref: string | null; controlled: string; blocking: boolean; status: string; statusLabel: string; outcome: string | null; exception: string | null;
  allowance: string; accepted: string | null; rejected: string | null; inspection: { id: string; number: string; status: string; href: string } | null; holdHref: string | null; sourceReversed: boolean;
  createdAt: string; href: string };
export type RequirementDetail = Requirement & { resolution: Record<string, unknown>; gate: { allowance: number; released: number; blockingRequirements: number; open: string[] } | null;
  waivers: Array<{ id: string; status: string; disposition: string; quantity: string; reason: string; risk: string; conditions: string | null; evidence: string | null; requestedBy: string | null;
    requestedAt: string; decidedBy: string | null; decidedAt: string | null; note: string | null }>;
  events: Array<{ id: string; action: string; from: string | null; to: string | null; note: string | null; by: string; at: string }>;
  can: { waive: boolean; decide: boolean; reevaluate: boolean; decideConflict: boolean }; openWaiverId: string | null };
export type Options = { specifications: Option[]; specVersions: Option[]; triggers: Option[]; requirements: Option[]; gates: Option[]; bindings: Option[]; matchModes: Option[]; scopes: Option[]; stages: Option[] };
export type Trigger = { id: string; source: string | null; sourceHref: string | null; date: string; outcome: string; outcomeLabel: string; forcedHold: boolean; controlPoints: string[]; requirements: number; at: string };

export const QCP_REPORTS: Array<{ id: string; label: string }> = [
  { id: "register", label: "Quality Control Point Register" }, { id: "by-stage", label: "Active QCPs by Inspection Stage" }, { id: "by-item", label: "QCPs by Product / Category" },
  { id: "supplier-specific", label: "Supplier-Specific QCPs" }, { id: "gate-coverage", label: "Quality Gate Coverage" }, { id: "triggers", label: "Trigger Execution History" },
  { id: "requirements", label: "Quality Inspection Requirements" }, { id: "awaiting-clearance", label: "Goods Awaiting Quality Clearance" }, { id: "conflicts", label: "QCP Configuration Conflicts" },
  { id: "missing-specifications", label: "Missing Approved Specifications" }, { id: "inspections", label: "Inspections Created by QCP" }, { id: "waivers", label: "Quality Waivers / Deviations" },
  { id: "failed-evaluations", label: "Failed / Recovered Evaluations" }, { id: "versions", label: "Rule Version History" },
];
export const REQUIREMENT_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { PENDING: "info", SATISFIED: "success", FAILED: "danger", WAIVED: "warning", EXCEPTION: "danger", CANCELLED: "neutral" };

export const listQcps = (view: string, search = "", stage = "") => call<{ rows: QcpRow[]; view: string; can: { create: boolean; export: boolean; drafts: boolean } }>(qs({ view, search: search || undefined, stage: stage || undefined }));
export const createQcp = (body: Record<string, unknown>) => send<{ controlPointId: string; versionId: string; code: string }>("", body);
export const getQcp = (id: string, versionId?: string) => call<QcpDetail>(`/${id}${qs({ versionId })}`);
export const getQcpHistory = (id: string) => call<{ events: Array<{ id: string; action: string; version: number | null; note: string | null; by: string; at: string }>; triggers: Trigger[] }>(`/${id}${qs({ part: "history" })}`);
export const qcpAction = <T = Record<string, unknown>>(id: string, action: string, body: Record<string, unknown> = {}) => send<T>(`/${id}/${action}`, body);
export const getQcpOptions = () => call<{ options: Options }>("/view/options");
export const getQcpOverview = () => call<{ counts: Record<string, number | string | undefined>; can: { create: boolean; approveWaivers: boolean } }>("/view/overview");
export const getQcpConflicts = () => call<{ overlaps: Array<{ trigger: string; purpose: string; first: { code: string; href: string }; second: { code: string; href: string }; message: string }>; exceptions: Requirement[] }>("/view/conflicts");
export const listRequirements = (view: string, controlPointId?: string) => call<{ rows: Requirement[]; can: { waive: boolean; reevaluate: boolean } }>(`/view/requirements${qs({ view, controlPointId })}`);
export const getRequirement = (id: string) => call<RequirementDetail>(`/requirements/${id}`);
export const requirementAction = (id: string, action: string, body: Record<string, unknown> = {}) => send(`/requirements/${id}/${action}`, body);
export const decideWaiver = (waiverId: string, body: Record<string, unknown>) => send(`/waivers/${waiverId}/decide`, body);
export const previewQcp = (params: Record<string, string | undefined>) => call<{ date: string; stage: string; trigger: string; holdsStock: boolean;
  requirements: Array<{ code: string; name: string; requirement: string; gate: string; mode: string; purpose: string; specification: string | null; problem: string | null }>;
  conflicts: Array<{ purpose: string; controlPoints: Array<{ code: string }> }> }>(`/view/preview${qs(params)}`);
export const getQcpReport = (kind: string) => call<{ kind: string; title: string; columns: string[]; rows: Array<Record<string, unknown> & { href?: string }> }>(`/view/report${qs({ kind })}`);
export const qcpExportHref = (kind: string) => `/api/quality/control-points/view/export${qs({ kind })}`;
