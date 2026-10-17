"use client";

// Projects — Billable / Non-Billable Time: the client of the project time-billing policies, contract lines, task rules, the billing summary,
// approved unbilled time, billing requests (reserve, send to Sales, cancel, link the invoice, reconcile credits), exceptions, profitability,
// reports and the company defaults. A billing command whose answer was lost is checked by its key, never sent again blindly.
import { ProjectApiError, call, qs, send } from "../api/projects-api";

export type BillingMethod = "INTERNAL" | "NON_BILLABLE" | "FIXED_PRICE" | "TIME_AND_MATERIALS" | "HYBRID";
export type Classification = "NON_BILLABLE" | "INCLUDED_IN_FIXED_FEE" | "TIME_AND_MATERIALS_ELIGIBLE" | "ELIGIBILITY_PENDING";
export type RequestStatus = "DRAFT" | "SUBMITTED" | "INVOICED" | "CANCELLED" | "REVERSED";
export type ContractLine = { id: string; number: string; label: string; salesOrderId: string; salesOrderNumber: string; salesOrderLineId: string; status: "ACTIVE" | "CLOSED"; effectiveFrom: string;
  effectiveTo: string | null; maxMinutes: number | null; usedMinutes: number; remainingMinutes: number | null; roundingMinutes: number; allowedTaskTypes: string[] | null; allowedUserIds: string[] | null;
  closeReason: string | null; createdBy: string | null; hourlyRate?: string; currency?: string };
export type BillingPolicy = {
  projectId: string; code: string; classification: "INTERNAL" | "CUSTOMER"; customerId: string | null; method: BillingMethod | null; methodLabel: string; version: number; implicit: boolean;
  defaultContractLineId: string | null; reference: string | null; reasonRequired: boolean; requestApproval: boolean;
  history: Array<{ version: number; method: BillingMethod; methodLabel: string; reference: string | null; note: string | null; setBy: string | null; setAt: string }>;
  lines: ContractLine[]; taskRules: Array<{ taskId: string; task: string; rule: "NON_BILLABLE" | "CONTRACT_LINE"; contractLineId: string | null; reasonCode: string | null; reason: string | null; note: string | null }>;
  methods: Array<{ code: BillingMethod; label: string }>; reasons: Array<{ code: string; label: string }>; classifications: Record<Classification, string>;
  can: { manage: boolean; authorizeLines: boolean; viewRates: boolean; request: boolean; allProjects: boolean };
};
export type LineCandidate = { salesOrderLineId: string; salesOrderNumber: string; orderStatus: string; item: string; description: string | null; quantity: string | null; uom: string | null;
  unitPrice: string | null; currency: string | null; eligible: boolean; why: string | null };
export type BillingSummary = {
  projectId: string; code: string; scope: "PROJECT" | "MINE"; method: BillingMethod | null; methodLabel: string; policyVersion: number;
  recordedMinutes: number; billableMinutes: number; nonBillableMinutes: number; includedInFixedFeeMinutes: number; billablePendingApprovalMinutes: number; approvedBillableMinutes: number;
  approvedEligibleMinutes: number; approvedAwaitingContractMinutes: number; approvedNonBillableMinutes: number; approvedMinutes: number; invoicedMinutes: number; reservedMinutes: number;
  availableToRequestMinutes: number; unbilledEligibleMinutes: number; billableRatio: number | null;
  nonBillableByReason: Array<{ reasonCode: string; reason: string; minutes: number }>;
  values?: { invoiced: string; reserved: string; availableToRequest: string };
  can: { request: boolean; authorize: boolean; billing: boolean };
};
export type UnbilledRow = { entryId: string; entryNumber: string; projectId: string; project: string; task: string | null; employee: string | null; workDate: string; description: string;
  contractLineId: string; contractLine: string; roundingMinutes: number; approvedMinutes: number; invoicedMinutes: number; reservedMinutes: number; freeMinutes: number;
  state: "UNBILLED" | "PARTIALLY_ALLOCATED" | "ALLOCATED" | "INVOICED"; rate: string; currency: string; freeValue: string };
export type BillingRequest = {
  id: string; number: string; projectId: string; project: string | null; contractLineId: string | null; contractLine: string | null; status: RequestStatus; statusLabel: string; totalMinutes: number;
  creditedMinutes: number; total: string; invoiceNumber: string | null; note: string | null; cancelReason: string | null; version: number; createdBy: string | null; createdAt: string;
  submittedBy: string | null; submittedAt: string | null; invoicedBy: string | null; invoicedAt: string | null; cancelledBy: string | null; cancelledAt: string | null;
  hourlyRate?: string | null; currency?: string | null; estimatedAmount?: string | null; invoicedAmount?: string | null;
};
export type BillingRequestDetail = BillingRequest & {
  allocations: Array<{ id: string; entryId: string; entryNumber: string; employee: string | null; workDate: string; description: string; minutes: number; status: string; reversalKind: string | null;
    reversalReason: string | null; reversalReference: string | null; reversedBy: string | null; reversedAt: string | null }>;
  can: { submit: boolean; cancel: boolean; confirm: boolean; reconcile: boolean };
};
export type BillingException = { kind: "AWAITING_INVOICE" | "INVOICE_CANCELLED" | "CONTRACT_MISSING" | "LIMIT_NEAR"; label: string; message: string; request?: BillingRequest; projectId?: string;
  project?: string; contractLine?: string; minutes?: number };
export type BillingSettings = { defaultMethod: "NON_BILLABLE" | "FIXED_PRICE" | "TIME_AND_MATERIALS" | "REQUIRE_SETUP"; reasonRequired: boolean; requestApproval: boolean; can: { manage: boolean } };

export const CLASSIFICATION_TONE: Record<Classification, "neutral" | "info" | "success" | "warning"> = {
  NON_BILLABLE: "neutral", INCLUDED_IN_FIXED_FEE: "neutral", TIME_AND_MATERIALS_ELIGIBLE: "success", ELIGIBILITY_PENDING: "warning" };
export const REQUEST_TONE: Record<RequestStatus, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", SUBMITTED: "info", INVOICED: "success", CANCELLED: "neutral", REVERSED: "warning" };
export const BILLING_BASE = "/projects/timesheets/billing";

export const getBillingPolicy = (projectId: string) => call<{ policy: BillingPolicy }>(`/${projectId}/time-billing-policy`).then((r) => r.policy);
export const setBillingPolicy = (projectId: string, input: Record<string, unknown>) => send<{ version: number; keptEntries?: number; unchanged?: boolean }>(`/${projectId}/time-billing-policy`, input);
export const getLineCandidates = (projectId: string) => call<{ rows: LineCandidate[] }>(`/${projectId}/time-billing-policy/lines`).then((r) => r.rows);
export const authorizeLine = (projectId: string, input: Record<string, unknown>) => send<{ contractLineId: string; lineNumber: string }>(`/${projectId}/time-billing-policy/lines`, input);
export const closeLine = (lineId: string, reason: string) => send(`/time-billing-lines/${lineId}/close`, { reason });
export const setTaskRule = (taskId: string, input: Record<string, unknown>) => send(`/tasks/${taskId}/billing-rule`, input);
export const resolveEligibility = (entryId: string, contractLineId?: string) => send(`/time-entries/${entryId}/resolve-eligibility`, { contractLineId });
export const requestClassificationCorrection = (entryId: string, input: Record<string, unknown>) => send<{ correctionId: string; billingAdjustmentRequired: boolean; adjustmentMinutes: number; billedMinutes: number }>(`/time-entries/${entryId}/classification-corrections`, input);
export const getBillingSummary = (projectId: string) => call<{ summary: BillingSummary }>(`/${projectId}/time-billing-summary`).then((r) => r.summary);
export const getUnbilled = (filters: { projectId?: string; contractLineId?: string; all?: boolean } = {}) => call<{ rows: UnbilledRow[]; totalFreeMinutes: number }>(`/time-entries/billable${qs({ ...filters, all: filters.all ? "true" : undefined })}`);
export const listRequests = (filters: { status?: string; projectId?: string } = {}) => call<{ rows: BillingRequest[]; can: { authorize: boolean } }>(`/time-billing-requests${qs(filters)}`);
export const getRequest = (id: string) => call<{ request: BillingRequestDetail }>(`/time-billing-requests/${id}`).then((r) => r.request);
export const createRequest = (input: Record<string, unknown>) => send<{ requestId: string; requestNumber: string; totalMinutes: number; estimatedAmount: string; currency: string }>("/time-billing-requests", input);
export const requestAction = (id: string, action: "submit" | "cancel" | "confirm" | "reconcile", input: Record<string, unknown>) => send<{ status: string }>(`/time-billing-requests/${id}/${action}`, input);
export const getExceptions = () => call<{ rows: BillingException[] }>("/time-billing-exceptions").then((r) => r.rows);
export const getBillableReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/reports/billable-time${qs({ kind, ...filters })}`).then((r) => r.rows);
export const getBillingSettings = () => call<{ settings: BillingSettings }>("/timesheets/billing-settings").then((r) => r.settings);
export const saveBillingSettings = (input: Partial<BillingSettings>) => send<{ settings: BillingSettings }>("/timesheets/billing-settings", input).then((r) => r.settings);

// A billing command whose answer was lost (the network, not a refusal) is checked by its key before anyone is told it worked or asked to retry.
export async function runBillingCommand<T>(key: string, work: () => Promise<T>): Promise<T | { recovered: true }> {
  try {
    return await work();
  } catch (failure) {
    if (failure instanceof ProjectApiError && failure.status > 0) throw failure;
    const outcome = await call<{ outcome: { applied: boolean } }>(`/time-billing-requests/outcome${qs({ key })}`).then((r) => r.outcome).catch(() => null);
    if (outcome?.applied) return { recovered: true };
    throw new ProjectApiError(outcome ? "The billing change was not applied. Check and try again." : "Checking the earlier billing operation. Do not submit again.", 0, "TIME_BILLING_OUTCOME_UNKNOWN");
  }
}
export const getInvoiceCandidates = (id: string) => call<{ invoiceLines: Array<{ id: string; label: string; invoiceNumber: string }>; creditNotes: Array<{ id: string; label: string; number: string }> }>(`/time-billing-requests/${id}/candidates`);
