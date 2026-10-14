"use client";

// Finished-Goods Receipt: the client of /api/manufacturing/finished-goods-receipts, /finished-goods-receipt-reports and the order's receivable output.
import { call, qs, send } from "@/features/manufacturing/orders/api/mo-api";

export type ReceiptStatus = "DRAFT" | "PENDING_APPROVAL" | "POSTING" | "POSTED" | "CANCELLED" | "RECOVERY_REQUIRED";
type Ref = { id: string; code: string; name: string };
export type ReceiptPlace = { warehouse: Ref | null; location: (Ref & { disposition?: string }) | null };
export type ReceiptLine = {
  id: string; lineNumber: number; productionEntryId: string; entryNumber: string; producedAt: string | null; productionBatchId: string | null; productionBatch: string | null;
  qualityDecisionId: string | null; quantity: string; uomId: string; uom: string; baseQuantity: string; factor: string; accepted: string | null; received: string | null; receivable: string | null;
  lotNumber: string | null; manufacturedOn: string | null; expiresOn: string | null; serialNumbers: string[];
  lot: { id: string; number: string; manufacturedOn: string | null; expiresOn: string | null } | null;
  serials: Array<{ number: string; serialId: string | null; stockMovementId: string | null }>; stockMovementIds: string[]; unitCost: string | null; totalCost: string | null;
};
export type Correction = { id: string; number: string; status: "REQUESTED" | "APPROVED" | "REJECTED"; quantity: string; reason: string; evidence: string | null; requestedBy: string | null;
  requestedAt: string; decidedBy: string | null; decidedAt: string | null; note: string | null; cost: string | null; stockMovementIds: string[] };
export type FinishedGoodsReceipt = {
  id: string; number: string; status: ReceiptStatus; statusLabel: string; rowVersion: number; receiptDate: string | null; notes: string | null; createdBy: string | null; createdAt: string;
  postedBy: string | null; postedAt: string | null; cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null; correctionStatus: "NONE" | "REQUESTED" | "REVERSED" | "REJECTED";
  order: { id: string; number: string; status: string; statusLabel: string; version: number; revisionNumber: number | null; snapshotId: string | null; finishedGoodsWarehouseId: string;
    accepted: string; received: string; receivable: string };
  item: { id: string; code: string; name: string; uomId: string; uom: string; trackingType: string };
  source: ReceiptPlace; destination: ReceiptPlace;
  approval: { required: boolean; valid: boolean; status: string; message: string | null; reason: string | null; requestedBy: string | null; requestedAt: string | null; decidedBy: string | null;
    decidedAt: string | null; note: string | null };
  lines: ReceiptLine[];
  totals: { lines: number; quantity: string; uom: string; unitCost: string | null; cost: string | null; costBasis: { policy: string; lines: Array<{ code: string; perUnit: string; rate: string; source: string }> } | null };
  posting: { key: string; documentVersion: number; inventoryStatus: string; stockMovementIds: string[]; financeStatus: string; journalEntryId: string | null; at: string; goodsReceiptId: string } | null;
  salesAllocation: "NONE" | "DONE" | "FAILED"; corrections: Correction[];
  print: { count: number; lastPrintedAt: string | null; watermark: string | null };
  history: Array<{ action: string; label: string; fromStatus: string | null; toStatus: string | null; summary: string | null; actor: string | null; at: string }>;
  can: Record<"edit" | "cancel" | "requestApproval" | "decideApproval" | "post" | "requestCorrection" | "decideCorrection" | "print" | "viewCost" | "recover", boolean>;
};
export type ReceiptListRow = {
  id: string; number: string; status: ReceiptStatus; statusLabel: string; correctionStatus: string; orderId: string; orderNumber: string; orderStatusLabel: string; item: string; quantity: string;
  uom: string; warehouse: string; location: string | null; entries: string | null; lots: string | null; receiptDate: string | null; createdBy: string | null; receivedBy: string | null; createdAt: string;
  postedAt: string | null; totalCost: string | null; approvalStatus: string; printed: number;
};
export type ReceiptPreview = {
  receiptId: string; receiptNumber: string; ok: boolean; readiness: "READY_TO_POST" | "PENDING_APPROVAL" | "BLOCKED"; checkedAt: string; problems: Array<{ code: string; message: string }>;
  approval: FinishedGoodsReceipt["approval"]; quantity: string; uom: string; trackingType: string;
  cost: { status: string; unitCost: string | null; total: string | null; wipBefore: string | null; wipAfter: string | null; basis: Array<{ code: string; perUnit: string; rate: string; source: string }> } | null;
  lines: Array<{ lineId: string; entryNumber: string; quantity: string; accepted: string; received: string; receivable: string; ok: boolean }>;
};
export type ReceivableOutput = {
  orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; orderVersion: number; eligible: boolean; reason: string | null;
  item: { id: string; code: string; name: string; uomId: string; uom: string; trackingType: string };
  totals: { planned: string; reported: string; accepted: string; rejected: string; pending: string; received: string; receivable: string };
  defaultWarehouseId: string; sourceWarehouseId: string; warehouses: Array<Ref & { isOrderDefault: boolean }>;
  bins: Array<{ id: string; warehouseId: string; code: string; name: string; disposition: string; defaultReceiving: boolean }>;
  entries: Array<{ id: string; number: string; status: string; producedAt: string | null; batchId: string | null; batch: string | null; qualityDecisionId: string | null; reported: string; accepted: string;
    rejected: string; pending: string; received: string; receivable: string; inspection: string; receipt: string; drafted: { quantity: string; receipts: string } | null }>;
};
export type ReceiptPostingCheck = { receiptId: string; receiptNumber: string; status: string; consistent: boolean; problems: string[]; checkedAt: string;
  inventory: { status: string; movements: number; quantity: string }; finance: { status: string; journalEntryId: string | null; amount: string | null } };
export type ReceiptException = { kind: "APPROVAL_PENDING" | "CORRECTION_PENDING" | "SALES_ALLOCATION_FAILED" | "POSTING_MISMATCH" | "ACCEPTED_NOT_RECEIVED"; receiptId: string | null;
  receiptNumber: string | null; orderId: string; orderNumber: string | null; since: string | null; message: string };
export type ReceiptDraftInput = {
  manufacturingOrderId?: string; destinationWarehouseId?: string; destinationLocationId?: string | null; receiptDate?: string | null; notes?: string; idempotencyKey?: string; expectedVersion?: number;
  lines: Array<{ productionEntryId: string; quantity: string; uomId?: string; lotNumber?: string | null; manufacturedOn?: string | null; expiresOn?: string | null; serialNumbers?: string[] | null }>;
};

export const RECEIPT_TONE: Record<ReceiptStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "info", PENDING_APPROVAL: "warning", POSTING: "warning", POSTED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger",
};
export const FGR_BASE = "/manufacturing/finished-goods-receipts";

export const listReceipts = (filters: Record<string, string | undefined>) => call<{ receipts: ReceiptListRow[] }>(`/finished-goods-receipts${qs(filters)}`).then((r) => r.receipts);
export const getReceipt = (id: string) => call<{ receipt: FinishedGoodsReceipt }>(`/finished-goods-receipts/${id}`).then((r) => r.receipt);
export const createReceipt = (input: ReceiptDraftInput) => send<{ receipt: FinishedGoodsReceipt }>(`/finished-goods-receipts`, input).then((r) => r.receipt);
export const updateReceipt = (id: string, input: ReceiptDraftInput) => send<{ receipt: FinishedGoodsReceipt }>(`/finished-goods-receipts/${id}`, input, "PATCH").then((r) => r.receipt);
export const previewReceipt = (id: string) => call<{ preview: ReceiptPreview }>(`/finished-goods-receipts/${id}/preview`).then((r) => r.preview);
export const receiptPostingStatus = (id: string) => call<{ posting: ReceiptPostingCheck }>(`/finished-goods-receipts/${id}/posting-status`).then((r) => r.posting);
export const receiptAction = <T = { receipt: FinishedGoodsReceipt }>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/finished-goods-receipts/${id}/${action}`, input);
export const receivableOutput = (orderId: string) => call<{ receivable: ReceivableOutput }>(`/orders/${orderId}/receivable-output`).then((r) => r.receivable);
export const receiptExceptions = () => call<{ exceptions: ReceiptException[] }>(`/finished-goods-receipts/exceptions`).then((r) => r.exceptions);
export const receiptReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/finished-goods-receipt-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
