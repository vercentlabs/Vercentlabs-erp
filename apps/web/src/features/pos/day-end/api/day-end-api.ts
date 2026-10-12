"use client";

// POS Day-End / Z Report (0107): the outlet's business day, the X report preview, readiness and exceptions, approval, finalization (and
// recovery of a lost answer), Z reports, their prints and post-close adjustments, and the business-day cut-off.
import { post, request } from "@/features/pos/shared/http";

export type BusinessDay = {
  id: string; storeId: string; businessDate: string; timezone: string; cutoff: string; periodStart: string; periodEnd: string; reportingCutoff: string | null;
  status: "OPEN" | "CLOSING" | "BLOCKED" | "READY_TO_FINALIZE" | "FINALIZING" | "CLOSED" | "RECOVERY_REQUIRED"; closingStartedAt: string | null; closedAt: string | null;
  zReportId: string | null; version: number;
};
export type DayEndContext = {
  outlet: { id: string; code: string; name: string; timezone: string; cutoff: string; currency: string }; day: BusinessDay; unclosed: BusinessDay[];
  can: { preview: boolean; prepare: boolean; finalize: boolean; approve: boolean; sensitive: boolean };
};
export type DayException = {
  id: string | null; code: string; severity: "BLOCKING" | "APPROVABLE" | "TRACKED"; sourceType: string; sourceId: string; label: string; exposure: string | null; owner: string | null;
  status: string; approvedBy: string | null; requestedBy: string | null; approvalCurrent: boolean;
};
export type Readiness = { ready: boolean; blocking: number; awaitingApproval: number; staleApprovals: number; tracked: number; items: DayException[] };
export type Money = string;
export type DaySnapshot = {
  identity: { company: string | null; outlet: string; outletCode: string; businessDate: string; timezone: string; cutoff: string; periodStart: string; periodEnd: string; scheduledEnd: string; currency: string };
  attribution: Record<string, string>;
  sales: { count: number; gross: Money; itemDiscounts: Money; cartDiscounts: Money; loyaltyRedemptions: Money; totalDiscounts: Money; taxableValue: Money; taxCharged: Money; rounding: Money;
    taxInclusiveConsideration: Money; netBeforeReturns: Money; returns: Money; netAfterReturns: Money; averageSale: Money; cancelledUnpaidBills: number; expiredBills: number };
  tax: { documents: Array<{ type: string; issued: number; cancelled: number; taxable: Money; cgst: Money; sgst: Money; igst: Money; utgst: Money; cess: Money; total: Money; firstNumber: string | null; lastNumber: string | null }>;
    byRate: Array<{ documentType: string; classification: string | null; rate: Money; lines: number; taxable: Money; cgst: Money; sgst: Money; igst: Money; utgst: Money; cess: Money }>;
    einvoice: Array<{ status: string; count: number }>; note: string };
  collections: { byMethod: Array<{ method: string; count: number; amount: Money; cashReceived?: Money; changeGiven?: Money; providerVerified?: Money; externallyAttested?: Money }>; total: Money;
    splitSales: number; failedOrVoided: Array<{ method: string; status: string; count: number; amount: Money }>; unapplied: Array<{ method: string; count: number; amount: Money }> };
  returns: { count: number; value: Money; taxAdjustment: Money; refundDue: Money };
  refunds: { paid: Money; failed: Money; outstanding: Money; byMethod: Array<{ method: string; bucket: string; count: number; amount: Money }> };
  cash: { sessions: number; appliedToSales: Money; openingFloats: Money; openingFloatsNote: string; cashReceived: Money; changeGiven: Money; uncompletedTendersReturned: Money; cashRefundsPaid: Money;
    cashMovementIn: Money; cashMovementOut: Money; expected: Money; counted: Money; shortageTotal: Money; shortageCount: number; overageTotal: Money; overageCount: number; netVariance: Money;
    destinations: Array<{ type: string; count: number; amount: Money; accepted: number; pendingAmount: Money }>; custodyPendingAcceptance: Money;
    perSession?: Array<{ shiftNumber: string; terminal: string; drawer: string | null; cashier: string | null; openingFloat: Money; expected: Money; counted: Money; variance: Money; reasonCode: string | null; approved: boolean; custody: string }> };
  cashDifferences: Array<{ context: string; shortages: number; shortageAmount?: Money; overages: number; overageAmount?: Money; approved?: number; unresolved?: number }>;
  shifts: { total: number; closed: number; list: Array<{ id: string; shiftNumber: string; terminal: string; cashier: string | null; status: string; openedAt: string | null; closedAt: string | null; cashEnabled: boolean; reportedHere: boolean }> };
  exceptions: Array<{ code: string; severity: string; sourceType: string; sourceId: string; label: string; exposure: string | null; owner: string | null }>;
  finance: { sales: Record<string, number>; returns: Record<string, number>; settlement: Array<{ status: string; count: number; amount: Money }>; note: string };
  closing?: { finalizedBy: string | null; finalizedAt: string; reportNumber: string; previewHash: string; earlyClose: boolean };
};
export type XReport = { kind: "X"; day: BusinessDay; asOf: string; previewHash: string; report: DaySnapshot; readiness: Readiness } | { kind: "Z"; day: BusinessDay; zReportId: string };
export type ReadinessResult = { day: BusinessDay; previewHash?: string; readiness?: Readiness; closed?: boolean; zReportId?: string };
export type FinalizeResult = { businessDayId: string; status: "CLOSED"; zReportId: string; zReportNumber: string; businessDate: string; finalizedAt: string; snapshotHash: string; managedExceptions: number };
export type ZReport = { id: string; number: string; businessDayId: string; businessDate: string; status: "CLOSED"; finalizedAt: string; variant: "SENSITIVE" | "SUMMARY"; snapshot: DaySnapshot;
  snapshotHash: string; verified: boolean; prints: number; adjustments: number; reconciliationStatus: string };
export type ZReportRow = { id: string; number: string; businessDate: string; outlet: string; finalizedAt: string; finalizedBy: string | null; sales: number; consideration: Money; returns: Money;
  cashVariance: Money; tracked: number; approved: number; adjustments: number; reconciliationStatus: string };
export type Adjustment = { id: string; category: string; sourceType: string; sourceId: string | null; discoveredAt: string; monetaryEffect: Money | null; description: string;
  previousState: string | null; currentState: string | null; financeReference: string | null; automatic: boolean; recordedBy: string | null };

export const dayEndContext = (storeId?: string | null, businessDate?: string | null) => {
  const params = new URLSearchParams();
  if (storeId) params.set("storeId", storeId);
  if (businessDate) params.set("businessDate", businessDate);
  return request<{ context: DayEndContext }>(`/day-end/current?${params.toString()}`).then((result) => result.context);
};
export const xReport = (dayId: string) => request<{ preview: XReport }>(`/day-end/${dayId}/preview`).then((result) => result.preview);
export const readiness = (dayId: string) => request<{ readiness: ReadinessResult }>(`/day-end/${dayId}/readiness`).then((result) => result.readiness);
export const beginClosing = (dayId: string, expectedVersion?: number) =>
  post<{ readiness: ReadinessResult }>(`/day-end/${dayId}/begin-closing`, { expectedVersion }).then((result) => result.readiness);
export const requestApproval = (dayId: string, note: string) => post<{ readiness: ReadinessResult }>(`/day-end/${dayId}/request-approval`, { note }).then((result) => result.readiness);
export const approveExceptions = (dayId: string, previewHash: string, note?: string) =>
  post<{ readiness: ReadinessResult }>(`/day-end/${dayId}/approve`, { previewHash, note }).then((result) => result.readiness);
export const finalizeDay = (dayId: string, input: { expectedVersion?: number; expectedPreviewHash: string; idempotencyKey: string }) =>
  post<{ result: FinalizeResult }>(`/day-end/${dayId}/finalize`, input).then((result) => result.result);
export const dayOutcome = (dayId: string) =>
  request<{ outcome: { closed: boolean; day: BusinessDay; result?: FinalizeResult } }>(`/day-end/${dayId}/outcome`).then((result) => result.outcome);
export const setCutoff = (storeId: string, cutoff: string) => post<{ cutoff: { cutoff: string } }>("/day-end/cutoff", { storeId, cutoff });
export const zReports = (filters: Record<string, string> = {}) => request<{ total: number; rows: ZReportRow[] }>(`/z-reports?${new URLSearchParams(filters).toString()}`);
export const zReport = (reportId: string) => request<{ report: ZReport }>(`/z-reports/${reportId}`).then((result) => result.report);
export const printZReport = (reportId: string, input: { format: "THERMAL" | "A4"; reason?: string }) =>
  post<{ report: ZReport }>(`/z-reports/${reportId}/print`, input).then((result) => result.report);
export const syncAdjustments = (reportId: string) => post<{ adjustments: Adjustment[] }>(`/z-reports/${reportId}/adjustments/sync`, {}).then((result) => result.adjustments);
export const recordAdjustment = (reportId: string, input: { category: string; sourceType: string; sourceId?: string; monetaryEffect?: string; description: string; financeReference?: string }) =>
  post<{ adjustment: Adjustment }>(`/z-reports/${reportId}/adjustments/record`, input).then((result) => result.adjustment);
