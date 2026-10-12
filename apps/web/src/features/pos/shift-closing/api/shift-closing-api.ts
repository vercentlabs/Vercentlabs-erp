"use client";

// POS Shift Closing (0105): the closing context (resumable), beginning and cancelling a close, the blind count, the reconciliation, asking for
// approval, closing, recovering a lost answer, the closing report and its prints, closing history, cash waiting to be accepted, and the
// exceptions closings hand on.
import { post, request } from "@/features/pos/shared/http";

export type Destination = "NEXT_SHIFT_HANDOVER" | "STORE_SAFE" | "AUTHORIZED_MANAGER" | "SECURED_DRAWER_PENDING_HANDOVER";
export type Blocker = { type: string; referenceType: string; referenceId: string; label: string; amount: string | null; blocking: boolean; managed: boolean };
export type Blockers = { items: Blocker[]; blocking: number; ready: boolean; heldCarts: number; openBills: number; counts: Record<string, number> };
export type PaymentSummary = {
  currency: string; sales: { count: number; total: string };
  methods: Array<{ method: string; count: number; amount: string; cashReceived?: string; changeGiven?: string }>;
  split: { sales: number; components: Array<{ method: string; count: number; amount: string }> };
  refunds: Array<{ method: string; status: string; count: number; amount: string; succeeded: string }>;
};
export type ClosingCount = {
  id: string; sequence: number; status: string; countedAmount: string; denominations: Array<{ denomination: number; count: number; amount: string }> | null; countedBy: string | null;
  submittedAt: string; recounts: number; expectedAmount: string | null; varianceAmount: string | null; direction: "EXACT" | "SHORT" | "OVER";
  reasonRequired: boolean; approvalRequired: boolean; blocked: boolean; approvalAmount: string | null; fingerprint: string | null;
  differenceType: "MATCH" | "SHORTAGE" | "OVERAGE"; reconciliationStatus: string; stale: boolean; cashLedgerVersion: number | null; policyVersion: string;
};
export type ClosingDestination = { id: string; type: Destination; amount: string; reference: string | null; recipient: string | null; status: string; acceptedBy: string | null;
  acceptedAt: string | null; receivedAmount: string | null; varianceAmount: string | null };
export type ClosingResult = {
  closingId: string; closingReportId: string; shiftId: string; status: "CLOSED" | "FORCE_CLOSED"; closingType: "NORMAL" | "FORCE"; cashSessionStatus: string | null; closedAt: string;
  expectedCashAmount: string | null; countedCashAmount: string | null; cashVarianceAmount: string | null; varianceReasonCode: string | null; varianceReason: string | null;
  handoverStatus: "NOT_APPLICABLE" | "NO_CASH" | "PENDING_ACCEPTANCE" | "TRANSFERRED"; destinations: ClosingDestination[];
  exceptions: Array<{ id: string; type: string; referenceId: string | null; amount: string | null; status: string; queue: string | null }>;
};
export type ClosingContext = {
  shift: { id: string; shiftNumber: string; status: string; version: number; cashierUserId: string; cashier: string | null; storeId: string; storeName: string; terminalId: string;
    terminalCode: string; terminalName: string; openedAt: string | null; closingStartedAt: string | null; closingStartedBy: string | null; closedAt: string | null; cashEnabled: boolean;
    cashSessionId: string | null; cashDrawer: { id: string; code: string; name: string } | null; currency: string };
  step: "CHECK" | "COUNT" | "REVIEW" | "CLOSED";
  blockers: Blockers | null; summary: PaymentSummary; count: ClosingCount | null; closing: ClosingResult | null;
  policy: { blindCount: boolean; revealAfterCount: boolean; denominations: number[]; destinations: Destination[]; varianceReasons: Array<{ code: string; label: string; requiresNote: boolean }> };
  canSeeExpected: boolean; mine: boolean; receivers: Array<{ userId: string; name: string }>;
};
export type ReportSnapshot = {
  shift: { number: string; cashier: string | null; outlet: string; terminal: string; terminalName: string; drawer: string | null };
  times: { openedAt: string | null; closingStartedAt: string | null; closedAt: string; durationMinutes: number | null };
  currency: string; sales: { count: number; total: string }; payments: PaymentSummary["methods"]; split: PaymentSummary["split"]; refunds: PaymentSummary["refunds"];
  cash: null | { openingFloat: string; openingSource: string | null; breakdown: Record<string, string> | null; expected: string | null; counted: string; variance: string | null;
    countSequence: number; recounts: number; varianceReasonCode: string | null; varianceReasonLabel: string | null; varianceReason: string | null };
  approvals: Array<{ id: string | null; approver: string | null; amount: string; reconciledBySupervisor?: boolean }>;
  custody: { status: string; destinations: Array<{ type: Destination; amount: string; reference: string | null; recipient: string | null; status: string }> };
  exceptions: Array<{ type: string; referenceId: string; label: string; amount: string | null }>;
  heldCarts: number; openBillsHeld: number; closedBy: string | null; closingType: string; closeReason: string | null; notes: string | null;
};
export type ClosingReport = { closingId: string; shiftId: string; variant: "CASHIER" | "RECONCILIATION"; snapshot: ReportSnapshot; snapshotHash: string; verified: boolean; prints: number;
  custodyNow: ClosingDestination[] };
export type ClosingHistoryRow = {
  closingId: string; shiftId: string; shiftNumber: string; status: string; outlet: string; terminal: string; cashier: string | null; closedBy: string | null; openedAt: string | null;
  closedAt: string; cashEnabled: boolean; currency: string; openingFloat: string | null; expectedCash: string | null; countedCash: string | null; variance: string | null;
  varianceReasonCode: string | null; custodyStatus: string; openExceptions: number;
};
export type CashTransfer = {
  id: string; closingId: string; shiftId: string; shiftNumber: string | null; outlet: string | null; type: Destination; amount: string; currency: string; reference: string | null;
  note: string | null; recipientUserId: string | null; recipient: string | null; status: string; receivedAmount: string | null; varianceAmount: string | null;
  acceptedBy: string | null; acceptedAt: string | null; handedOverBy: string | null; handedOverAt: string;
};
export type DestinationInput = { type: Destination; amount: string; reference?: string; recipientUserId?: string };

export const DESTINATION_LABEL: Record<Destination, string> = {
  NEXT_SHIFT_HANDOVER: "Left in the drawer for the next shift",
  STORE_SAFE: "Store safe",
  AUTHORIZED_MANAGER: "Handed to a manager",
  SECURED_DRAWER_PENDING_HANDOVER: "Kept in the secured drawer for a later handover",
};

export const closingContext = (shiftId?: string | null) =>
  request<{ context: ClosingContext }>(shiftId ? `/shifts/${shiftId}/closing-context` : "/shifts/current/closing-context").then((result) => result.context);
export const beginClosing = (shiftId: string, input: { expectedVersion?: number; reason?: string; takeOver?: boolean } = {}) =>
  post<{ context: ClosingContext }>(`/shifts/${shiftId}/begin-closing`, input).then((result) => result.context);
export const cancelClosing = (shiftId: string, input: { reason?: string } = {}) =>
  post<{ context: ClosingContext }>(`/shifts/${shiftId}/cancel-closing`, input).then((result) => result.context);
export const submitCount = (shiftId: string, input: { countedAmount?: string; denominations?: Array<{ denomination: number; count: number }>; countedConfirmed: boolean; idempotencyKey: string }) =>
  post<{ count: ClosingCount }>(`/shifts/${shiftId}/cash-counts`, input).then((result) => result.count);
export const requestClosingApproval = (shiftId: string, input: { reason?: string; idempotencyKey?: string }) =>
  post<{ approval: { id: string; status: string } }>(`/shifts/${shiftId}/request-closing-approval`, input).then((result) => result.approval);
export const handPaymentToOwner = (shiftId: string, input: { exceptionType: "PAYMENT_UNKNOWN" | "SPLIT_PAYMENT"; referenceId: string; note: string }) =>
  post<{ blockers: Blockers }>(`/shifts/${shiftId}/closing-exceptions`, input).then((result) => result.blockers);
export const closeShiftNow = (shiftId: string, input: {
  closingCountId?: string; varianceReasonCode?: string; varianceReason?: string; approvalId?: string | null; destinations?: DestinationInput[]; expectedVersion?: number;
  idempotencyKey: string; reason?: string; force?: boolean; notes?: string;
}) => post<{ closing: ClosingResult }>(`/shifts/${shiftId}/close`, input).then((result) => result.closing);
export const recoverClosing = (shiftId: string) =>
  request<{ result: { closed: boolean; closing?: ClosingResult; status?: string } }>(`/shifts/${shiftId}/closing`).then((result) => result.result);
export const closingReport = (shiftId: string, variant?: "CASHIER" | "RECONCILIATION") =>
  request<{ report: ClosingReport }>(`/shifts/${shiftId}/closing-report${variant ? `?variant=${variant}` : ""}`).then((result) => result.report);
export const printClosingReport = (shiftId: string, input: { variant?: "CASHIER" | "RECONCILIATION"; format?: "THERMAL" | "A4"; reason?: string }) =>
  post<{ report: ClosingReport }>(`/shifts/${shiftId}/closing-report/print`, input).then((result) => result.report);
export const closingHistory = (filters: Record<string, string> = {}) =>
  request<{ total: number; rows: ClosingHistoryRow[] }>(`/shift-closings?${new URLSearchParams(filters).toString()}`);
export const cashTransfers = (filters: Record<string, string> = {}) =>
  request<{ transfers: CashTransfer[] }>(`/cash-transfers?${new URLSearchParams(filters).toString()}`).then((result) => result.transfers);
export const acceptTransfer = (transferId: string, input: { receivedAmount: string; note?: string }) =>
  post<{ transfer: CashTransfer }>(`/cash-transfers/${transferId}/accept`, input).then((result) => result.transfer);
