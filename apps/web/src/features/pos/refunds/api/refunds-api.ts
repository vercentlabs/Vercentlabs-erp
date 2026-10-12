"use client";

// Refunds (0100): money returned for an authorized source, tracked per original tender until it is really back with the customer. The screen
// never computes an amount or a split — the server does, from the source.
import type { PosRefund, PosRefundException, PosRefundPreview, PosRefundRow, PosReturn } from "@vercentlabs/api";

import { post, request } from "@/features/pos/shared/http";

export type { PosRefund, PosRefundException, PosRefundPreview, PosRefundRow };

const key = () => crypto.randomUUID();
export const previewReturnRefund = (returnId: string, amount?: string) => post<{ preview: PosRefundPreview }>(`/returns/${returnId}/refund-preview`, { amount }).then((result) => result.preview);
export const refundReturn = (returnId: string, input: { amount?: string; cashRefundConfirmed: boolean; execute?: boolean; reasonNote?: string; idempotencyKey?: string }) =>
  post<{ posReturn: PosReturn }>(`/returns/${returnId}/refunds`, { ...input, idempotencyKey: input.idempotencyKey ?? key() }).then((result) => result.posReturn);
export const listRefunds = (filters: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "" && value !== false).map(([name, value]) => [name, String(value)]));
  return request<{ rows: PosRefundRow[]; total: number }>(`/refunds${params.size ? `?${params}` : ""}`);
};
export const getRefund = (id: string) => request<{ refund: PosRefund }>(`/refunds/${id}`).then((result) => result.refund);
const act = (id: string, action: string, body: Record<string, unknown> = {}) => post<{ refund: PosRefund }>(`/refunds/${id}/${action}`, body).then((result) => result.refund);
export const approveRefund = (id: string, expectedVersion: number, note?: string) => act(id, "approve", { expectedVersion, note });
export const executeRefund = (id: string, cashPayoutConfirmed: boolean) => act(id, "execute", { cashPayoutConfirmed, idempotencyKey: key() });
export const confirmRefundCash = (id: string) => act(id, "cash/confirm");
export const refreshRefund = (id: string) => act(id, "refresh");
export const cancelRefund = (id: string, reason: string, expectedVersion: number) => act(id, "cancel", { reason, expectedVersion });
export const retryRefundComponent = (id: string, componentId: string) => act(id, `components/${componentId}/retry`);
export const recordManualRefund = (id: string, componentId: string, reference: string) => act(id, `components/${componentId}/manual`, { reference });
export const refundDocument = (id: string, width = 80) => request<{ refundNumber: string; html: string }>(`/refunds/${id}/document?width=${width}`);
export const listRefundExceptions = (status = "open") => request<{ exceptions: PosRefundException[] }>(`/refund-exceptions?status=${status}`).then((result) => result.exceptions);
export const resolveRefundException = (id: string, input: { outcome?: "refunded" | "not_refunded"; reference?: string; note: string }) =>
  post<{ exception: PosRefundException }>(`/refund-exceptions/${id}/resolve`, input).then((result) => result.exception);

export const REFUND_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", AWAITING_APPROVAL: "Awaiting approval", AUTHORIZED: "Approved", PROCESSING: "Processing", PARTIALLY_REFUNDED: "Partly refunded", REFUNDED: "Refunded",
  FAILED_ACTION_REQUIRED: "Failed — action needed", RECONCILIATION_REQUIRED: "Being checked", CANCELLED: "Cancelled",
};
export const REFUND_STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", AWAITING_APPROVAL: "warning", AUTHORIZED: "info", PROCESSING: "info", PARTIALLY_REFUNDED: "warning", REFUNDED: "success", FAILED_ACTION_REQUIRED: "danger",
  RECONCILIATION_REQUIRED: "warning", CANCELLED: "neutral",
};
export const COMPONENT_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  PENDING: "warning", SUBMITTED: "info", PROCESSING: "info", SUCCEEDED: "success", FAILED: "danger", UNKNOWN: "warning", CANCEL_PENDING: "neutral", CANCELLED: "neutral",
};
export const SOURCE_LABEL: Record<string, string> = { pos_return: "Return", checkout_failure: "Checkout not completed", payment_exception: "Duplicate / excess payment" };
