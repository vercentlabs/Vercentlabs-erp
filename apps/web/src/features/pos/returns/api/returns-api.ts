"use client";

// POS Returns (0099): a return is prepared as a draft (quantities held at once), approved when it carries an exception, inspected when the
// company requires it, then posted — stock, refunds, the credit note and the return receipt. The screen never computes an amount: every
// value comes from the original sale on the server.
import type { PosReturn, PosReturnEligibility, PosReturnLineInput, PosReturnRow } from "@vercentlabs/api";

import { post, request } from "@/features/pos/shared/http";

export type { PosReturn, PosReturnEligibility, PosReturnLineInput, PosReturnRow };

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
const key = () => crypto.randomUUID();

export const findSaleForReturn = (code: string) => request<{ eligibility: PosReturnEligibility }>(`/returns/find?code=${encodeURIComponent(code)}`).then((result) => result.eligibility);
export const saleReturnEligibility = (saleId: string) => request<{ eligibility: PosReturnEligibility }>(`/sales/${saleId}/return-eligibility`).then((result) => result.eligibility);
export const listReturns = (filters: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "").map(([name, value]) => [name, String(value)]));
  return request<{ rows: PosReturnRow[]; total: number }>(`/returns${params.size ? `?${params}` : ""}`);
};
export const getReturn = (id: string) => request<{ posReturn: PosReturn }>(`/returns/${id}`).then((result) => result.posReturn);
export const createReturn = (input: { saleId: string; receiptPresent: boolean; lines: PosReturnLineInput[]; reasonSummary?: string; overrideReason?: string; idempotencyKey?: string }) =>
  post<{ posReturn: PosReturn }>("/returns", { ...input, idempotencyKey: input.idempotencyKey ?? key() }).then((result) => result.posReturn);
export const updateReturn = (id: string, input: { lines?: PosReturnLineInput[]; receiptPresent?: boolean; overrideReason?: string | null; expectedVersion: number }) =>
  request<{ posReturn: PosReturn }>(`/returns/${id}`, json("PATCH", input)).then((result) => result.posReturn);
const act = (id: string, action: string, body: Record<string, unknown> = {}) => post<{ posReturn: PosReturn }>(`/returns/${id}/${action}`, body).then((result) => result.posReturn);
export const requestApproval = (id: string, expectedVersion: number) => act(id, "request-approval", { expectedVersion });
export const approveReturn = (id: string, expectedVersion: number, note?: string) => act(id, "approve", { expectedVersion, note });
export const rejectReturn = (id: string, reason: string, expectedVersion: number) => act(id, "reject", { reason, expectedVersion });
export const cancelReturn = (id: string, reason: string | undefined, expectedVersion: number) => act(id, "cancel", { reason, expectedVersion });
export const inspectReturn = (id: string, lines: Array<{ lineId: string; conditionCode?: string; dispositionCode: string }>, expectedVersion: number) =>
  act(id, "inspection", { lines, expectedVersion });
export const postReturn = (id: string, expectedVersion: number, cashRefundConfirmed: boolean, idempotencyKey: string) =>
  act(id, "post", { expectedVersion, cashRefundConfirmed, idempotencyKey });
export const confirmRefund = (id: string, input: { paymentId?: string; externalReference?: string } = {}) => act(id, "refunds/confirm", input);
export const retryRefunds = (id: string) => act(id, "refunds/retry");
export const releaseStock = (id: string, lineId: string, dispositionCode: string) =>
  post<{ posReturn: PosReturn }>(`/returns/${id}/lines/${lineId}/release`, { dispositionCode }).then((result) => result.posReturn);

export const REASON_LABEL: Record<string, string> = {
  damaged_product: "Damaged product", defective_product: "Defective product", wrong_item: "Wrong item", wrong_size_variant: "Wrong size / variant",
  customer_changed_mind: "Customer changed mind", quality_issue: "Quality issue", not_as_described: "Not as described", other: "Other",
};
export const CONDITION_LABEL: Record<string, string> = { unopened: "Unopened", good: "Good", opened: "Opened", damaged: "Damaged", defective: "Defective", not_applicable: "Not stock" };
export const DISPOSITION_LABEL: Record<string, string> = {
  restock_approved: "Back to sellable stock", return_hold: "Hold for inspection", damaged: "Damaged stock", quarantined: "Quarantine", rejected_not_received: "Not received",
  not_applicable: "No stock (service)",
};
export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", AWAITING_APPROVAL: "Awaiting approval", AWAITING_INSPECTION: "Awaiting inspection", APPROVED: "Approved", POSTING: "Posting", POSTED: "Posted", REJECTED: "Rejected",
  CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Needs recovery",
};
export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", AWAITING_APPROVAL: "warning", AWAITING_INSPECTION: "warning", APPROVED: "info", POSTING: "info", POSTED: "success", REJECTED: "danger", CANCELLED: "neutral",
  RECOVERY_REQUIRED: "danger",
};
export const REFUND_LABEL: Record<string, string> = {
  NOT_INITIATED: "Not started", PENDING: "Waiting", PROCESSING: "Processing", PARTIALLY_REFUNDED: "Partly refunded", SUCCEEDED: "Refunded", FAILED: "Failed", UNKNOWN: "Being checked",
  NOT_REQUIRED: "No refund", AWAITING_CASH_PAYOUT: "Cash to hand over", AWAITING_MANUAL_REFUND: "To refund outside the provider", REQUESTED: "Requested", RECONCILIATION_REQUIRED: "Being checked",
};
export const REFUND_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  SUCCEEDED: "success", FAILED: "danger", UNKNOWN: "warning", PENDING: "warning", PROCESSING: "info", PARTIALLY_REFUNDED: "info", AWAITING_CASH_PAYOUT: "warning", AWAITING_MANUAL_REFUND: "warning",
  NOT_REQUIRED: "neutral", NOT_INITIATED: "neutral",
};
