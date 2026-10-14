"use client";

// Manufacturing Orders: the client of /api/manufacturing/{orders, home, activity, production-summary, settings}.
import { MfgApiError } from "@/features/manufacturing/shared/client";

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/manufacturing${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new MfgApiError(payload.message || "The request could not be completed.", response.status, payload.code) as MfgApiError & { details?: Record<string, unknown> };
    error.details = payload.details;
    throw error;
  }
  return payload as T;
}
export const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const send = <T>(path: string, body: unknown = {}, method = "POST") => call<T>(path, { method, body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof MfgApiError ? error.status : 0);
export const errorCode = (error: unknown) => (error instanceof MfgApiError ? error.code : undefined);
export const errorDetails = (error: unknown) => ((error as { details?: Record<string, unknown> })?.details ?? {}) as { blockers?: string[]; issues?: Array<{ severity: string; message: string }> };
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export type MoStatus = "DRAFT" | "AWAITING_APPROVAL" | "RELEASED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETION_PENDING" | "COMPLETED" | "CANCELLED" | "RECOVERY_REQUIRED";
export type MoListRow = {
  id: string; number: string; status: MoStatus; statusLabel: string; priority: string; finishedItem: { id: string; code: string; name: string }; baseUom: string | null; planned: string;
  accepted: string; received: string; rejected: string; pendingInspection: string; progressPct: string | null; bom: string | null; plannedStartAt: string; plannedEndAt: string; owner: string | null;
  source: string | null; sourceType: string; materialWarehouse: string; finishedGoodsWarehouse: string; parentOrderId: string | null; overdue: boolean; updatedAt: string;
};
export type MoMaterial = {
  id: string; lineNumber: number; origin: "RECIPE" | "EXTRA"; kind: "MATERIAL" | "SUBASSEMBLY"; itemId: string; code: string; name: string; trackingType: string; uomId: string; uom: string;
  planned: string; extra: string; required: string; reserved: string; issued: string; returned: string; netIssued: string; consumed: string; scrapped: string; reversed: string; inCustody: string; remainingToIssue: string;
  availableToReserve: string; shortage: string; issuedCost: string; returnedCost: string; averageIssueCost: string | null; estimatedUnitCost: string | null; estimatedCost: string | null;
  openDemand: Array<{ number: string; status: string; quantity: string }>; readiness: "ISSUED" | "RESERVED" | "PARTIAL" | "NONE";
};
export type MoCosts = {
  currency: string; estimatedMaterialCost: string | null; estimateComplete: boolean; estimateMissing: string[]; actualMaterialCost: string; materialCostVariance: string | null;
  capitalisedToFinishedGoods: string; varianceClosed: string; workInProgress: string; currentUnitMaterialCost: string | null; unitCostBasis: Array<{ code: string; perUnit: string; rate: string; source: string }>;
  unitCostMissing: string[]; note: string;
  lines: Array<{ id: string; code: string; name: string; uom: string; origin: string; planned: string; extra: string; netIssued: string; consumed: string; standardForAccepted: string; usageVariance: string;
    estimatedCost: string | null; actualCost: string; costVariance: string | null }>;
};
export type MoOrder = {
  id: string; number: string; status: MoStatus; statusLabel: string; heldFromStatus: string | null; priority: string; version: number;
  finishedItem: { id: string; code: string; name: string; trackingType: string; baseUom: string | null }; plannedQuantity: string; outputUom: string; outputUomId: string; plannedBaseQuantity: string;
  bom: { id: string; number: string; revisionId: string; revisionNumber: number; revisionStatus: string; snapshotId: string | null; snapshotHash: string | null; frozenAt: string | null } | null;
  warehouses: Record<"manufacturing" | "material" | "finishedGoods", { id: string; code: string; name: string }>;
  plannedStartAt: string; plannedEndAt: string; actualStartAt: string | null; completedAt: string | null; source: { type: string; id: string | null; reference: string | null };
  parent: { id: string; number: string } | null; owner: string | null; ownerId: string | null; notes: string | null;
  people: Record<string, string | null>;
  reasons: { returned: string | null; partialStart: string | null; hold: string | null; holdCategory: string | null; shortClose: string | null; cancel: string | null };
  quantities: { planned: string; reported: string; accepted: string; rejected: string; pendingInspection: string; received: string; acceptedNotReceived: string; remaining: string; outputLimit: string;
    progressPct: string | null; yieldPct: string | null };
  progress: { materials: string; issue: string; quality: string; receipt: string; finance: string; openVariances: number; openExceptions: number };
  materials: MoMaterial[];
  movements: Array<{ id: string; number: string; direction: "ISSUE" | "RETURN"; materialId: string; code: string; quantity: string; unitCost: string | null; totalCost: string | null;
    allocations: Array<{ batch?: string | null; quantity: string }>; reason: string | null; actor: string | null; at: string }>;
  consumption: Array<{ id: string; code: string; quantity: string; note: string | null; automatic: boolean; actor: string | null; at: string }>;
  variances: Array<{ id: string; code: string; name: string; quantity: string; reason: string; status: string; requestedBy: string | null; requestedAt: string; decidedBy: string | null; note: string | null; mayDecide: boolean }>;
  production: Array<{ id: string; number: string; batchReference: string | null; reported: string; accepted: string; rejected: string; pending: string; pendingRemaining: string; rejectionReason: string | null;
    notes: string | null; actor: string | null; at: string }>;
  qualityDecisions: Array<{ id: string; entryNumber: string; accepted: string; rejected: string; reason: string | null; disposition: string | null; inspectionReference: string | null; actor: string | null; at: string }>;
  receipts: Array<{ id: string; number: string; quantity: string; warehouse: string; batch: string | null; serialNumbers: string[]; unitCost: string | null; totalCost: string | null; actor: string | null; at: string }>;
  exceptions: Array<{ id: string; category: string; reason: string; status: string; raisedBy: string | null; raisedAt: string; resolvedBy: string | null; resolution: string | null }>;
  children: Array<{ id: string; number: string; status: string; statusLabel: string; item: string; planned: string; received: string }>;
  customerDemand: Array<{ allocationId: string; demandId: string; status: string; salesOrderId: string; salesOrder: string; customer: string | null; requiredDate: string | null; assigned: string;
    received: string; reserved: string }>;
  issues: Array<{ id: string; number: string; status: string; approvalStatus: string; lines: number; postedAt: string | null; createdAt: string; postedBy: string | null; totalCost: string | null }>;
  scrap: Array<{ id: string; materialId: string; code: string; quantity: string; reason: string; actor: string | null; at: string }>;
  consumptionNotes: Array<{ id: string; number: string; status: string; kind: string; approvalStatus: string; lines: number; batchReference: string | null; postedAt: string | null; createdAt: string;
    postedBy: string | null; totalCost: string | null }>;
  costs: MoCosts | null; settings: { requireInspection: boolean; overproductionTolerancePct: string };
  history: Array<{ action: string; fromStatus: string | null; toStatus: string | null; summary: string | null; actor: string | null; at: string }>;
  can: Record<"edit" | "submit" | "returnToDraft" | "approve" | "release" | "reserve" | "issue" | "return" | "consume" | "requestExtra" | "decideVariance" | "start" | "record" | "decideQuality"
    | "receive" | "hold" | "resume" | "complete" | "cancel" | "handOffShortages" | "createSubassemblyOrder" | "raiseException" | "viewCost" | "export" | "scrap" | "viewIssues" | "recordConsumption" | "viewConsumption", boolean>;
};
export type MoOptions = {
  products: Array<{ id: string; code: string; name: string; uomId: string; uom: string; trackingType: string;
    defaults: { leadTimeDays: number | null; materialWarehouseId: string | null; manufacturingWarehouseId: string | null }; effectiveRevision: { id: string; number: number; from: string; to: string | null } | null;
    scheduledRevision: { number: number; from: string } | null }>;
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean }>; currentUserId: string | null; people: Array<{ id: string; name: string }>; salesOrders: Array<{ id: string; number: string }>;
};
export type MoPreview = { bom: { id: string; revisionId: string; number: string; revisionNumber: number }; plannedBaseQuantity: string; baseUom: string; materials: MoMaterial[];
  estimatedMaterialCost: string | null; assumptions: string[]; issues: Array<{ message: string }> };
export type MoHome = { counts: Record<MoStatus, number>; overdue: number; pendingBomApprovals: number; openMaterialDemand: number; awaitingInspection: string;
  inProgress: Array<{ id: string; number: string; status: MoStatus; statusLabel: string; item: string; planned: string; accepted: string; dueAt: string; progressPct: string }> };
export type MoActivity = { id: string; kind: string; number: string; orderId: string; orderNumber: string; item: string; quantity: string; at: string; actor: string | null; note: string | null };
export type MoSummary = { rows: Array<{ id: string; number: string; status: MoStatus; statusLabel: string; item: string; uom: string; plannedStartAt: string; completedAt: string | null; planned: string;
  accepted: string; rejected: string; received: string; yieldPct: string | null; completionPct: string | null; shortClosed: boolean; estimatedCost?: string | null; actualCost?: string; costVariance?: string | null;
  varianceClosed?: string; capitalised?: string }>; totals: Record<string, string | number>; costVisible: boolean };
export type MfgSettings = { bomSelfApprovalAllowed: boolean; bomCostStaleAfterDays: number; moSelfApprovalAllowed: boolean; moVarianceSelfApprovalAllowed: boolean; moOverproductionTolerancePct: string;
  moRequireInspection: boolean; moPartialReservationAllowed: boolean; moReleaseWithShortagesAllowed: boolean; miUnreservedIssueAllowed: boolean; miExcessTolerancePct: string;
  mcVarianceWarningPct: string; mcVarianceApprovalPct: string; mcSelfApprovalAllowed: boolean; moProductionMaterialCheck: "WARN" | "BLOCK";
  qiTemplateRequired: boolean; qiReviewRequired: boolean; qiDeviationAllowed: boolean; qiSampleDecidesBatch: boolean;
  phResumeApprovalRequired: boolean; phOverdueAfterHours: number;
  mvSavingReviewPct: string; mvApprovalValueAbove: string | null; mvBlockCompletion: boolean; canManage: boolean };

export const listOrders = (filters: Record<string, string | undefined>) => call<{ orders: MoListRow[] }>(`/orders${qs(filters)}`).then((r) => r.orders);
export const getOrder = (id: string) => call<{ order: MoOrder }>(`/orders/${id}`).then((r) => r.order);
export const orderOptions = () => call<{ options: MoOptions }>(`/orders/options`).then((r) => r.options);
export const previewOrder = (input: Record<string, unknown>) => send<{ preview: MoPreview }>(`/orders/preview`, input).then((r) => r.preview);
export const createOrder = (input: Record<string, unknown>) => send<{ order: MoOrder }>(`/orders`, input).then((r) => r.order);
export const saveDraft = (id: string, input: Record<string, unknown>) => send<{ order: MoOrder }>(`/orders/${id}`, input, "PATCH").then((r) => r.order);
export const orderAction = <T = { order: MoOrder }>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/orders/${id}/${action}`, input);
export const decideVariance = (id: string, varianceId: string, decision: "APPROVE" | "REJECT", note?: string) =>
  send<{ order: MoOrder }>(`/orders/${id}/material-variances/${varianceId}`, { decision, note }).then((r) => r.order);
export const resolveException = (id: string, exceptionId: string, resolution: string) => send<{ order: MoOrder }>(`/orders/${id}/exceptions/${exceptionId}`, { resolution }).then((r) => r.order);
export const exportOrder = (id: string) => call<{ file: { fileName: string; csv: string } }>(`/orders/${id}/export`).then((r) => r.file);
export const manufacturingHome = () => call<{ home: MoHome }>(`/home`).then((r) => r.home);
export const productionActivity = (kind: string) => call<{ activity: MoActivity[] }>(`/activity${qs({ kind })}`).then((r) => r.activity);
export const productionSummary = (filters: Record<string, string | undefined>) => call<{ summary: MoSummary }>(`/production-summary${qs(filters)}`).then((r) => r.summary);
export const getSettings = () => call<{ settings: MfgSettings }>(`/settings`).then((r) => r.settings);
export const saveSettings = (input: Record<string, unknown>) => send<{ settings: MfgSettings }>(`/settings`, input, "PUT").then((r) => r.settings);

export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "info", AWAITING_APPROVAL: "warning", RELEASED: "info", IN_PROGRESS: "success", ON_HOLD: "warning", COMPLETION_PENDING: "warning", COMPLETED: "neutral", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger",
};
export const qty = (value: string | null | undefined) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 }));
export const inr = (value: string | null | undefined) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-IN", { style: "currency", currency: "INR" }));
export const MO_BASE = "/manufacturing/orders";
