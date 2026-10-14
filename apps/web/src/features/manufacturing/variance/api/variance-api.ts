"use client";

// Material Consumption Variance: the client of /api/manufacturing/orders/<id>/material-variances, /material-variance-exceptions,
// /material-variance-tolerances, /bom-review-requests and /material-variance-reports.
import { call, qs, send } from "@/features/manufacturing/orders/api/mo-api";

export type Basis = "REPORTED_OUTPUT" | "GOOD_OUTPUT" | "ORIGINAL_PLAN" | "AUTHORIZED_PLAN";
export type Band = "NOT_CALCULABLE" | "NO_OUTPUT" | "WITHIN" | "REVIEW" | "APPROVAL" | "UNPLANNED" | "SAVING_REVIEW" | "INCOMPLETE";
export type VarianceLine = {
  materialId: string; lineNumber: number; itemId: string; code: string; name: string; uom: string; kind: string | null; origin: string; bomLineId: string | null;
  basisQuantity: string | null; expected: string | null; expectedProductive: string | null; allowance: string | null; consumed: string; scrapped: string; actual: string; issued: string;
  returned: string; netIssued: string; inCustody: string; planned: string; authorizedExtra: string; variance: string | null; variancePct: string | null;
  classification: "FAVORABLE" | "UNFAVORABLE" | "NONE"; band: Band; bandLabel: string; status: "NOT_CALCULABLE" | "PROVISIONAL" | "FINAL"; needsReview: boolean; needsApproval: boolean;
  policy: { source: string; warningPct: string; approvalPct: string; critical: boolean; version: number | null }; notes: string[]; explanation: string; hash: string;
  bases: Record<Basis, string | null>;
  cost: { reference: string | null; usage: string | null; expected: string | null; actual: string | null; total: string | null; price: string | null; scrap: string | null; available: boolean } | null;
  exception: { id: string; number: string; status: string; statusLabel: string; reasonLabel: string | null; approvalValid: boolean } | null; authorized: boolean; exceptions: number; nextStep: string | null;
};
export type OrderVariances = {
  orderId: string; orderNumber: string; orderStatus: string; basis: Basis; basisLabel: string; bases: Array<{ key: Basis; label: string; quantity: string | null }>;
  status: "NOT_CALCULABLE" | "PROVISIONAL" | "FINAL"; failure: string | null; recoveryRequired: boolean; overall: "APPROVAL_REQUIRED" | "REVIEW_REQUIRED" | "WITHIN_TOLERANCE";
  policy: { warningPct: string; approvalPct: string; savingReviewPct: string; valueAbove: string | null; blockCompletion: boolean };
  lines: VarianceLine[]; totals: { usageCost: string | null; expectedCost: string | null; actualCost: string | null; totalCostVariance: string | null };
  can: { investigate: boolean; approve: boolean; viewCost: boolean; export: boolean };
};
export type Snapshot = { id: string; band: string; bandLabel: string; expected: string | null; consumed: string; scrapped: string; variance: string | null; pct: string | null; usageCost: string | null; at: string };
export type VarianceException = {
  id: string; number: string; status: "OPEN" | "SUBMITTED" | "APPROVED" | "REJECTED" | "RESOLVED"; statusLabel: string; rowVersion: number;
  order: { id: string; number: string; status: string; statusLabel: string }; material: VarianceLine | null; reasonCode: string | null; reasonLabel: string | null;
  explanation: string | null; evidence: string | null; assignedTo: string | null; createdBy: string | null; createdAt: string; opened: Snapshot | null; submitted: Snapshot | null; stale: boolean;
  review: { submittedBy: string | null; submittedAt: string | null; decidedBy: string | null; decidedAt: string | null; note: string | null };
  resolution: { type: string; note: string | null; by: string | null; at: string } | null; bomReviewRequested: boolean; holdRecommended: boolean;
  bomReviews: Array<{ id: string; status: string; reason: string; requestedAt: string; closeNote: string | null }>;
  history: Array<{ action: string; label: string; summary: string | null; actor: string | null; at: string }>;
  can: Record<"edit" | "submit" | "decide" | "resolve" | "bomReview" | "recommendHold" | "placeHold" | "requestMaterial", boolean>;
};
export type ExceptionRow = { id: string; number: string; status: string; statusLabel: string; orderId: string; orderNumber: string; orderStatusLabel: string; code: string; name: string;
  uom: string | null; variance: string | null; variancePct: string | null; band: string | null; bandLabel: string | null; usageCost: string | null; reason: string | null; assignee: string | null;
  createdAt: string; submittedAt: string | null; resolutionType: string | null };
export type Tolerance = { id: string; scope: "ITEM" | "GROUP"; itemId: string | null; itemGroupId: string | null; label: string; warningPct: string; approvalPct: string;
  savingReviewPct: string | null; approvalValueAbove: string | null; approvalQuantityAbove: string | null; critical: boolean; version: number; notes: string | null; updatedAt: string };

export const VARIANCE_BASE = "/manufacturing/material-variances";
export const BAND_TONE: Record<Band, "neutral" | "info" | "success" | "warning" | "danger"> = {
  NOT_CALCULABLE: "neutral", NO_OUTPUT: "info", WITHIN: "success", REVIEW: "warning", APPROVAL: "danger", UNPLANNED: "danger", SAVING_REVIEW: "warning", INCOMPLETE: "info",
};
export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { OPEN: "info", SUBMITTED: "warning", APPROVED: "success", REJECTED: "danger", RESOLVED: "neutral" };
export const REASON_OPTIONS = [
  { value: "PROCESS_WASTE", label: "Process waste" }, { value: "MATERIAL_DAMAGE", label: "Material damage" }, { value: "QUALITY_REJECTION", label: "Quality rejection" },
  { value: "REWORK", label: "Rework" }, { value: "OPERATOR_ERROR", label: "Operator error" }, { value: "MEASUREMENT_ERROR", label: "Measurement error" },
  { value: "BOM_STANDARD_INACCURATE", label: "BOM standard inaccurate" }, { value: "PRODUCTION_PLAN_CHANGE", label: "Production plan change" },
  { value: "MISSING_CONSUMPTION", label: "Missing consumption" }, { value: "OTHER", label: "Other" },
];
export const RESOLUTION_OPTIONS = [
  { value: "AUTHORIZED_VARIANCE", label: "Authorized variance (approved)" }, { value: "SOURCE_CORRECTED", label: "Source records corrected" },
  { value: "WITHIN_TOLERANCE", label: "Back within tolerance" }, { value: "EXTRA_MATERIAL", label: "Extra material requested" }, { value: "PRODUCTION_HOLD", label: "Production put on hold" },
  { value: "BOM_REVIEW", label: "BOM review requested" }, { value: "OTHER", label: "Other" },
];
export const signed = (value: string | null) => (value === null ? "—" : Number(value) > 0 ? `+${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 })}` : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 }));

export const orderVariances = (orderId: string, basis?: Basis) => call<{ variances: OrderVariances }>(`/orders/${orderId}/material-variances${qs({ basis })}`).then((r) => r.variances);
export const openException = (input: Record<string, unknown>) => send<{ exceptionId: string; existing?: boolean }>(`/material-variance-exceptions`, input);
export const getException = (id: string) => call<{ exception: VarianceException }>(`/material-variance-exceptions/${id}`).then((r) => r.exception);
export const updateException = (id: string, input: Record<string, unknown>) => send(`/material-variance-exceptions/${id}`, input, "PATCH");
export const exceptionAction = (id: string, action: string, input: Record<string, unknown> = {}) => send<Record<string, unknown>>(`/material-variance-exceptions/${id}/${action}`, input);
export const listExceptions = (filters: Record<string, string | undefined>) => call<{ exceptions: ExceptionRow[] }>(`/material-variance-exceptions${qs(filters)}`).then((r) => r.exceptions);
export const reviewQueue = () => call<{ queue: { exceptions: ExceptionRow[]; unopened: Array<VarianceLine & { orderId: string; orderNumber: string }> } }>(`/material-variance-exceptions/queue`).then((r) => r.queue);
export const listTolerances = () => call<{ tolerances: Tolerance[]; groups: Array<{ id: string; name: string }> }>(`/material-variance-tolerances`);
export const setTolerance = (input: Record<string, unknown>) => send(`/material-variance-tolerances`, input);
export const removeTolerance = (id: string) => send(`/material-variance-tolerances/${id}`, {}, "DELETE");
export const listBomReviews = (status?: string) => call<{ requests: Array<{ id: string; status: string; finished: string; component: string; orderId: string | null; orderNumber: string | null;
  exceptionId: string | null; exceptionNumber: string | null; reason: string; requester: string | null; requestedAt: string; closeNote: string | null }> }>(`/bom-review-requests${qs({ status })}`).then((r) => r.requests);
export const closeBomReview = (id: string, note: string) => send(`/bom-review-requests/${id}/close`, { note });
export const varianceReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/material-variance-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
