"use client";

// Production Costing: the client of /api/manufacturing/orders/<id>/costing, /cost-adjustments, /costing (rates, settings, exceptions) and
// /production-costing-reports.
import { call, qs, send } from "@/features/manufacturing/orders/api/mo-api";

type Money = string | null;
export type CostingStatus = "ESTIMATED" | "ACCUMULATING" | "PARTIALLY_CAPITALIZED" | "RECONCILIATION_REQUIRED" | "RECONCILED" | "FINALIZED" | "ADJUSTMENT_REQUIRED";
export type RateLine = { id: string; code: string; name: string | null; component: string; category: string | null; basis: string; basisLabel: string; rate: string; version: number; productSpecific: boolean };
export type RateView = RateLine | { missing: true } | null;
export type OrderRate = RateLine & { frozenAt: string; frozenLate: boolean; applied: string; due: string; overApplied: string; calculated: string; batchesCharged: number | null };
export type OrderCosting = {
  orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; currency: string; costingStatus: CostingStatus;
  policy: { model: string; modelLabel: string; receiptAllocation: string; labor: RateView; overhead: RateLine[] | null; overheadMissing: boolean; ratesFrozen: boolean; frozenLate: boolean;
    invalidRates: string[]; laborEnabled: boolean; overheadEnabled: boolean };
  rates: OrderRate[];
  batches: Array<{ id: string; reference: string; status: string; setupConfirmedAt: string | null; reported: number; eligible: boolean; mayConfirm: boolean }>;
  quantities: { planned: string; reported: string; accepted: string; rejected: string; received: string };
  planned: { source: string; material: Money; labor: Money; overhead: Money; total: Money; unit: string | null; complete: boolean; missing: string[] };
  estimates: Array<{ id: string; version: number; kind: string; total: Money; material: Money; labor: Money; overhead: Money; unit: string | null; complete: boolean; at: string }>;
  actual: { materialIssued: Money; materialUsed: Money; materialInCustody: Money; materialScrapped: Money; labor: Money; overhead: Money; incurred: Money; valuationComplete: boolean };
  dispositions: { capitalised: Money; conversionCapitalised: Money; scrapOut: Money; abnormalLoss: Money; closedToVariance: Money; adjusted: Money; wip: Money; wipMaterialInCustody: Money; wipConsumedNotCapitalised: Money };
  rollForward: { opening: Money; added: Money; toFinishedGoods: Money; scrapAndLoss: Money; toVariance: Money; closing: Money };
  unit: { plannedPerUnit: string | null; actualPerAccepted: string | null; capitalisedPerReceived: string | null; note: string | null };
  variances: {
    againstPlan: { planned: Money; actual: Money; variance: Money; pct: string | null; note: string | null } | null;
    againstEquivalent: { expected: Money; actual: Money; variance: Money } | null;
    material: { expected: Money; actual: Money; total: Money; usage: Money; price: Money; scrap: Money; note: string };
    labor: { expected: Money; applied: Money; variance: Money } | null; overhead: { expected: Money; applied: Money; variance: Money } | null;
    yield: { rejected: string; cost: Money; note: string };
  };
  materials: Array<{ materialId: string; code: string; name: string; uom: string; issued: string; consumed: string; scrapped: string; returned: string; inCustody: string; averageCost: string | null;
    issuedCost: Money; usedCost: Money; custodyCost: Money; estimatedUnitCost: string | null; estimatedCost: Money }>;
  receipts: Array<{ id: string; number: string; quantity: string; unitCost: string; total: Money; material: Money; conversion: Money; journalEntryId: string | null; at: string; reversed: Money }>;
  receivedValue: Money;
  applications: Array<{ id: string; component: string; componentLabel: string; category: string | null; direction: "APPLY" | "REVERSE"; reason: string | null; basis: string; basisLabel: string; rate: string | null; rateVersion: number; batch: string | null; quantity: string; amount: Money; by: string; at: string }>;
  pending: Array<{ component: string; componentLabel: string; category: string | null; missingRate: boolean; missingValuation: boolean; amount: Money; reverse: Money; pieces: number }>;
  adjustments: Array<{ id: string; number: string; direction: string; amount: Money; reason: string; status: string; requestedBy: string | null; requestedAt: string; decidedBy: string | null;
    decidedAt: string | null; note: string | null; mayDecide: boolean }>;
  reconciliation: { book: string; finance: string; difference: string; entries: number; balanced: boolean; pendingRecovery: number; status: "BALANCED" | "IMBALANCE" | "RECOVERY_REQUIRED" };
  finalization: { finalizedAt: string | null; problems: Array<{ code: string; message: string }> };
  history: Array<{ action: string; label: string; amount: Money; summary: string | null; actor: string; at: string }>;
  can: Record<"apply" | "reverse" | "estimate" | "reconcile" | "adjust" | "finalize" | "viewDetail" | "export", boolean>;
};
export type CostRateStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "RETIRED";
export type CostRate = { id: string; code: string; name: string; component: string; componentLabel: string; categoryId: string | null; category: string | null; basis: string; basisLabel: string;
  rate: string; zeroReason: string | null; uom: string | null; product: string | null; productId: string | null; effectiveFrom: string; effectiveUntil: string | null; version: number | null;
  status: CostRateStatus; statusLabel: string; notes: string | null; decisionNote: string | null; rowVersion: number; createdBy: string | null; approvedBy: string | null; createdAt: string;
  approvedAt: string | null; retiredAt: string | null; can: Record<"edit" | "submit" | "decide" | "retire", boolean> };
export type OverheadCategory = { id: string; code: string; name: string; description: string | null; defaultBasis: string; defaultBasisLabel: string; costPoolAccountIds: string[];
  costPoolAccounts: string[]; costPoolNote: string | null; status: string };
export type ApplyPreview = { orderId: string; orderVersion: number; lines: Array<{ component: string; category: string | null; rateCode: string | null; basis: string | null; direction: "APPLY" | "REVERSE";
  batchId: string | null; quantity: string; amount: string }>; apply: string; reverse: string; effect: string; missingRate: boolean; missingValuation: boolean };
export type OverheadReconciliation = { period: string; rows: Array<{ categoryId: string; code: string; category: string; poolAccounts: number; actual: Money; applied: string; difference: Money;
  status: "POOL_NOT_MAPPED" | "BALANCED" | "REVIEW_REQUIRED" | "RECONCILED" | "EXCEPTION"; lastReview: { status: string; note: string; financeReference: string | null; by: string | null; at: string } | null }>;
  totals: { actual: string; applied: string; difference: string }; note: string; can: { reconcile: boolean } };

export const COSTING_STATUS_LABEL: Record<CostingStatus, string> = { ESTIMATED: "Estimated", ACCUMULATING: "Accumulating", PARTIALLY_CAPITALIZED: "Partly in finished goods",
  RECONCILIATION_REQUIRED: "Reconciliation required", RECONCILED: "Reconciled", FINALIZED: "Finalized", ADJUSTMENT_REQUIRED: "Adjustment waiting" };
export const COSTING_STATUS_TONE: Record<CostingStatus, "neutral" | "info" | "success" | "warning" | "danger"> = { ESTIMATED: "neutral", ACCUMULATING: "info", PARTIALLY_CAPITALIZED: "info",
  RECONCILIATION_REQUIRED: "danger", RECONCILED: "success", FINALIZED: "success", ADJUSTMENT_REQUIRED: "warning" };
export const COSTING_BASE = "/manufacturing/production-costing";

export const orderCosting = (orderId: string) => call<{ costing: OrderCosting }>(`/orders/${orderId}/costing`).then((r) => r.costing);
export const costingAction = (orderId: string, action: string, input: Record<string, unknown> = {}) => send<Record<string, unknown>>(`/orders/${orderId}/costing/${action}`, input);
export const decideAdjustment = (id: string, decision: "APPROVE" | "REJECT", note?: string) => send(`/cost-adjustments/${id}/decide`, { decision, note });
export const applyPreview = (orderId: string) => call<{ preview: ApplyPreview }>(`/orders/${orderId}/costing/apply-preview`).then((r) => r.preview);
export const confirmBatchSetup = (orderId: string, batchId: string) => send(`/orders/${orderId}/production-batches/${batchId}/confirm-setup`, {});
export const costRates = () => call<{ rates: { laborEnabled: boolean; overheadEnabled: boolean; selfApproval: boolean; rates: CostRate[]; can: { manage: boolean; approve: boolean } } }>(`/costing/rates`).then((r) => r.rates);
export const createCostRate = (input: Record<string, unknown>) => send<{ rateId: string; rateCode: string; status: string }>(`/costing/rates`, input);
export const updateCostRate = (id: string, input: Record<string, unknown>) => send(`/costing/rates/${id}`, input, "PATCH");
export const submitCostRate = (id: string) => send(`/costing/rates/${id}/submit`, {});
export const decideCostRate = (id: string, decision: "APPROVE" | "REJECT", note?: string) => send(`/costing/rates/${id}/decide`, { decision, note });
export const overheadCategories = () => call<{ categories: OverheadCategory[]; accounts: Array<{ id: string; code: string; name: string }> }>(`/costing/overhead-categories`);
export const saveOverheadCategory = (input: Record<string, unknown>) => send(`/costing/overhead-categories`, input);
export const overheadReconciliation = (period: string) => call<{ reconciliation: OverheadReconciliation }>(`/costing/overhead-reconciliation${qs({ period })}`).then((r) => r.reconciliation);
export const reconcileOverhead = (input: Record<string, unknown>) => send(`/costing/overhead-reconciliation`, input);
export const retireCostRate = (id: string) => send(`/costing/rates/${id}`, {}, "DELETE");
export const setCostingSettings = (input: Record<string, unknown>) => send(`/costing/settings`, input, "PUT");
export const costingExceptions = () => call<{ exceptions: Array<{ kind: string; orderId: string; orderNumber: string; orderStatusLabel: string; wip: string; message: string }> }>(`/costing/exceptions`).then((r) => r.exceptions);
export const costingReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/production-costing-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
