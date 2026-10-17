"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/maintenance: reported problems and their triage, Work Orders from approval to the return to service,
// preventive plans, the asset's maintenance panel, exceptions, reports and the audit. Costs arrive only with the maintenance-cost permission.
export const MAINTENANCE_BASE = "/assets/maintenance";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/maintenance${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Option = { value: string; label: string };
export type MaintenanceEvent = { id: string; action: string; from: string | null; to: string | null; details: Record<string, unknown>; reason: string | null; by: string; at: string };
export type RequestRow = { id: string; number: string; assetId: string; asset: string; type: string; typeLabel: string; priority: string; description: string; symptoms: string | null; safetyConcern: string;
  observedCondition: string | null; location: string | null; custodian: string | null; status: string; statusLabel: string; triageNote: string | null; duplicateOf: string | null; workOrderId: string | null;
  workOrder: string | null; workOrderStatus: string | null; reportedBy: string | null; reportedAt: string; version: number; href: string };
export type RequestDetail = RequestRow & { safetyRestriction: { status: string; since: string; ended: string | null; releaseReason: string | null } | null; events: MaintenanceEvent[];
  can: { triage: boolean; respond: boolean; createWorkOrder: boolean } };
export type WorkOrderRow = { id: string; number: string; assetId: string; asset: string; location: string | null; title: string; type: string; typeLabel: string; priority: string; execution: string;
  status: string; statusLabel: string; outcome: string | null; outcomeLabel: string | null; technicianUserId: string | null; technician: string | null; supplierId: string | null; supplier: string | null;
  request: string | null; requestId: string | null; plan: string | null; planId: string | null; scheduledStartAt: string | null; expectedCompletionAt: string | null; actualStartAt: string | null;
  workCompletedAt: string | null; closedAt: string | null; estimate: number | null; approvalRequired: boolean; warrantyStatus: string | null; legacy: boolean; overdue: boolean; version: number; href: string };
export type CostLine = { id: string; sourceType: string; source: string | null; sourceId: string; role: string; amount: number | null; sourceStatus: string | null; counted: boolean; note: string | null; linkedAt: string };
export type CostSummary = { estimate: number | null; committed: number; actual: number; parts: number; externalService: number; capitalImprovement: number; actualConfirmed: boolean; message: string | null;
  lines: CostLine[]; exceptions: number };
export type WorkOrderDetail = WorkOrderRow & { problem: string | null; diagnosis: string | null; rootCause: string | null; workPerformed: string | null; remainingIssues: string | null; recommendation: string | null;
  intakeCondition: string | null; completionCondition: string | null; restrictUse: boolean; cancelReason: string | null; reopenedCount: number;
  warranty: { status: string; label: string; endDate: string | null; provider: string | null; coverage: string | null; claimReference: string | null; claimStatus: string | null };
  assetDetail: { id: string; number: string; name: string; custodian: string | null; availability: string; lifecycle: string; condition: string | null };
  checklist: Array<{ lineNumber: number; text: string; mandatory: boolean; result: string | null; notes: string | null; by: string | null; at: string | null }>;
  verifications: Array<{ id: string; verifier: string | null; at: string; finalCondition: string; testsPassed: boolean; testResults: string | null; decision: string; notes: string | null; evidence: string | null }>;
  restrictions: Array<{ id: string; type: string; source: string | null; own: boolean; status: string; since: string; ended: string | null; reason: string | null; releaseReason: string | null }>;
  transfer: { id: string; number: string; status: string; href: string } | null; followUps: Array<{ id: string; number: string; status: string }>; followUpOf: { id: string; number: string } | null;
  cost: CostSummary | null; events: MaintenanceEvent[];
  can: Record<"submit" | "approve" | "assign" | "schedule" | "start" | "record" | "complete" | "verify" | "release" | "cancel" | "reopen" | "parts" | "vendorCost" | "cost" | "followUp" | "warranty" | "audit", boolean> };
export type PlanRow = { id: string; number: string; assetId: string; asset: string; name: string; type: string; typeLabel: string; frequency: string; frequencyType: string; interval: number | null; startDate: string;
  nextDueDate: string | null; lastCompletedDate: string | null; dueRule: string; dueRuleLabel: string; leadDays: number; technician: string | null; technicianUserId: string | null; supplier: string | null;
  supplierId: string | null; priority: string; checklist: Array<{ text: string; mandatory: boolean }>; estimatedMinutes: number | null; status: string; version: number; overdue: boolean; legacy: boolean; href: string };
export type PlanDetail = PlanRow & { occurrences: Array<{ id: string; dueDate: string; index: number; status: string; workOrderId: string | null; workOrder: string | null; workOrderStatus: string | null;
  outcome: string | null; completedAt: string | null }>; events: MaintenanceEvent[]; can: { manage: boolean } };
export type DueRow = { plan: string; planId: string; asset: string; name: string; dueDate: string; overdue: boolean; technician: string | null; supplier: string | null; href: string };
export type ExceptionRow = { kind: string; label: string; number: string; asset: string; detail: string; href: string };
export type Overview = { openRequests: number; safetyRequests: number | null; openWorkOrders: number; myWork: number; pendingApproval: number; waiting: number; pendingVerification: number; overdue: number;
  underMaintenance: number | null; dueSoon: number; exceptions: number | null; can: Record<"request" | "create" | "plans" | "triage" | "cost" | "export" | "audit", boolean> };
export type AssetPanel = { assetId: string; availability: string; restrictions: Array<{ type: string; reason: string | null; since: string; source: string }>; active: WorkOrderRow[]; history: WorkOrderRow[];
  openRequests: RequestRow[]; plans: PlanRow[]; nextServiceDate: string | null; warranty: { status: string; label: string; endDate: string | null; provider: string | null };
  downtime: { hours: number; periods: number }; costs: { actual: number; committed: number; capitalImprovement: number } | null; can: { request: boolean; create: boolean; plans: boolean } };

export const getOverview = () => call<Overview>("");
export const getOptions = () => call<{ technicians: Option[]; suppliers: Option[] }>("/view/options");
export const listRequests = (view: string, search = "", assetId?: string) => call<{ rows: RequestRow[]; can: Record<string, boolean> }>(`/requests${qs({ view, search: search || undefined, assetId })}`);
export const getRequest = (id: string) => call<RequestDetail>(`/requests/${id}`);
export const createRequest = (body: Record<string, unknown>) => send<{ requestId: string; number: string; safetyRestricted: boolean }>("/requests", body);
export const requestAction = (id: string, action: string, body: Record<string, unknown> = {}) => send(`/requests/${id}/${action}`, body);
export const listWorkOrders = (view: string, search = "", assetId?: string) => call<{ rows: WorkOrderRow[]; can: Record<string, boolean> }>(`/work-orders${qs({ view, search: search || undefined, assetId })}`);
export const getWorkOrder = (id: string) => call<WorkOrderDetail>(`/work-orders/${id}`);
export const createWorkOrder = (body: Record<string, unknown>) => send<{ workOrderId: string; number: string; status: string; warrantyReview: string | null }>("/work-orders", body);
export const workOrderAction = <T = Record<string, unknown>>(id: string, action: string, body: Record<string, unknown> = {}) => send<T>(`/work-orders/${id}/${action}`, body);
export const listPlans = (view: string, assetId?: string) => call<{ rows: PlanRow[]; can: { manage: boolean } }>(`/plans${qs({ view, assetId })}`);
export const getPlan = (id: string) => call<PlanDetail>(`/plans/${id}`);
export const createPlan = (body: Record<string, unknown>) => send<{ planId: string; number: string }>("/plans", body);
export const planAction = (id: string, action: string, body: Record<string, unknown> = {}) => send(`/plans/${id}/${action}`, body);
export const generateDue = () => send<{ generated: number }>("/plans/generate", {});
export const getDue = (days = 90) => call<DueRow[]>(`/view/due${qs({ days })}`);
export const getExceptions = () => call<ExceptionRow[]>("/view/exceptions");
export const getReport = (kind: string) => call<Array<Record<string, unknown>>>(`/view/report${qs({ kind })}`);
export const getAudit = () => call<Array<{ id: string; action: string; record: string | null; asset: string | null; from: string | null; to: string | null; reason: string | null; by: string; at: string }>>("/view/audit");
export const getAssetPanel = (assetId: string) => call<AssetPanel>(`/assets/${assetId}`);
export const maintenanceExportHref = "/api/assets/maintenance/export";

export const REPORT_KINDS = [
  { id: "open-requests", label: "Open maintenance requests" }, { id: "active-work-orders", label: "Active Work Orders" }, { id: "maintenance-due", label: "Maintenance due" },
  { id: "overdue-maintenance", label: "Overdue maintenance" }, { id: "by-asset", label: "Maintenance by asset" }, { id: "by-category", label: "Maintenance by category" },
  { id: "by-technician", label: "Maintenance by technician" }, { id: "by-vendor", label: "Maintenance by vendor" }, { id: "downtime", label: "Asset downtime" },
  { id: "repeated-failures", label: "Repeated asset failures" }, { id: "costs-by-asset", label: "Maintenance costs by asset" }, { id: "costs-by-period", label: "Maintenance costs by period" },
  { id: "warranty", label: "Warranty-related maintenance" }, { id: "waiting", label: "Waiting for parts / vendor" }, { id: "unrepairable", label: "Unrepairable assets" },
  { id: "verification-exceptions", label: "Verification exceptions" }, { id: "cost-reconciliation", label: "Maintenance cost reconciliation" },
];
type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export const WO_TONE: Record<string, Tone> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", APPROVED: "info", SCHEDULED: "info", IN_PROGRESS: "info", WAITING_FOR_PARTS: "warning", WAITING_FOR_VENDOR: "warning",
  WORK_COMPLETED: "info", PENDING_VERIFICATION: "warning", CLOSED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger" };
export const REQUEST_TONE: Record<string, Tone> = { OPEN: "warning", NEEDS_INFORMATION: "warning", ACCEPTED: "info", REJECTED: "neutral", CLOSED: "success" };
export const PRIORITY_TONE: Record<string, Tone> = { LOW: "neutral", NORMAL: "neutral", HIGH: "warning", URGENT: "danger" };
export const RESTRICTION_LABEL: Record<string, string> = { SAFETY: "Safety restriction", UNDER_MAINTENANCE: "Under maintenance", LIMITATION: "Returned with a limitation" };
export const CONDITION_OPTIONS: Option[] = [{ value: "NEW", label: "New" }, { value: "GOOD", label: "Good" }, { value: "FAIR", label: "Fair" }, { value: "DAMAGED", label: "Damaged" }, { value: "UNSERVICEABLE", label: "Unserviceable" }];
export const TYPE_OPTIONS: Option[] = [{ value: "CORRECTIVE", label: "Corrective (repair)" }, { value: "EMERGENCY", label: "Emergency" }, { value: "INSPECTION", label: "Inspection" }, { value: "PREVENTIVE", label: "Preventive" }];
export const PRIORITY_OPTIONS: Option[] = [{ value: "LOW", label: "Low" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent" }];
