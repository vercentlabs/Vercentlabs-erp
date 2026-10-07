"use client";

// Purchase returns: the shapes the screens read and the calls they make. Quantities and amounts are the server's decimal strings.
import { ProcApiError } from "@/features/procurement/shared/http";

export class ReturnApiError extends ProcApiError {
  constructor(message: string, status: number, code: string | undefined, readonly details: Record<string, unknown>) {
    super(message, status, code);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/procurement${path}`, {
    credentials: "same-origin", ...init,
    headers: { Accept: "application/json", ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new ReturnApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const get = <T>(path: string) => call<T>(path);
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const issuesOf = (error: unknown): string[] => {
  if (!(error instanceof ReturnApiError)) return [];
  const issues = (error.details.issues ?? (error.details.details as Record<string, unknown> | undefined)?.issues) as Array<{ message: string }> | undefined;
  return (issues ?? []).map((issue) => issue.message);
};

export type StatusFields = {
  financialStatus: string; financialLabel: string; resolutionStatus: string; resolutionLabel: string; replacementStatus: string; replacementLabel: string;
};
export type ReturnRow = StatusFields & {
  id: string; returnNumber: string; returnDate: string; status: "draft" | "posted" | "cancelled" | "reversed"; statusLabel: string; supplierId: string; supplierName: string;
  purchaseOrderId: string; purchaseOrderNumber: string; receipts: string[]; warehouseName: string | null; items: number; quantity: string; reason: string;
  expectedResolution: string | null; expectedResolutionLabel: string | null; createdByName: string | null;
};
export type ReturnOptions = {
  reasons: Array<{ code: string; label: string }>; expectedResolutions: Array<{ code: string; label: string }>; views: Array<{ key: string; label: string }>;
  capabilities: Record<"manage" | "post" | "reverse" | "commercial" | "resolve" | "createCredit", boolean>;
};
export type EligibleLine = {
  goodsReceiptLineId: string; goodsReceiptId: string; receiptNumber: string; receiptDate: string; lineNumber: number; orderLineNumber: number; purchaseOrderLineId: string;
  productId: string | null; description: string; productType: string; uom: string | null; trackingType: string | null; batchNumber: string | null; warehouseId: string | null;
  warehouseName: string | null; locationCode: string | null; received: string; returned: string; entitlement: string; usable: string; unitValue: string; draftQuantity: string;
  draftReturns: string[]; holds: Array<{ id: string; disposition: string; open: string }>; rejections: Array<{ id: string; rejectionNumber: string; open: string; reason: string }>;
};
export type Eligible = { order: { id: string; purchaseOrderNumber: string; supplierId: string; currencyCode: string }; lines: EligibleLine[] };
export type ReturnLine = {
  id: string; lineNumber: number; goodsReceiptLineId: string; goodsReceiptId: string; receiptNumber: string; receiptLineNumber: number; orderLineNumber: number; productId: string | null;
  product: { code?: string; name?: string } | null; description: string; uom: { code?: string } | null; quantity: string; baseQuantity: string | null; received: string;
  returnedElsewhere: string; reason: string; reasonLabel: string; reasonNotes: string | null; stockDisposition: string | null; locationCode: string | null; batchNumber: string | null;
  expiryDate: string | null; serialNumbers: string[]; rejectionId: string | null; rejectionNumber: string | null; dispositionId: string | null; expectedCredit: string | null;
  billingAllocation: string | null; notes: string | null;
};
export type ReturnDetail = {
  purchaseReturn: StatusFields & {
    id: string; returnNumber: string; status: "draft" | "posted" | "cancelled" | "reversed"; statusLabel: string; returnDate: string; reason: string; purchaseOrderId: string;
    purchaseOrderNumber: string; supplierId: string; supplierName: string | null; supplier: { legalName?: string; gstin?: string | null; supplierNumber?: string } | null;
    returnTo: { line1?: string; line2?: string | null; city?: string; state?: string; postalCode?: string } | null; warehouseId: string | null; warehouseName: string | null;
    expectedResolution: string | null; expectedResolutionLabel: string | null; supplierRmaReference: string | null; carrierReference: string | null; trackingReference: string | null;
    dispatchReference: string | null; internalNotes: string | null; supplierAcknowledgedAt: string | null; supplierAcknowledgementReference: string | null; dispatchedAt: string | null;
    createdAt: string; createdByName: string | null; postedAt: string | null; postedByName: string | null; cancelledAt: string | null; cancelReason: string | null; reversedAt: string | null;
    reversedByName: string | null; reversalReason: string | null; version: number; replacementPurchaseOrderId: string | null; replacementNoCharge: boolean;
  };
  lines: ReturnLine[];
  movements: Array<{ id: string; number: string | null; type: string; direction: "out" | "in"; quantity: string; item: string | null; warehouseName: string | null; locationCode: string | null; reason: string | null; at: string }>;
  resolution: StatusFields & {
    expected: string | null; figures: Record<string, string>; replacementOrder: { purchaseOrderId: string; purchaseOrderNumber: string; orderStatus: string; ordered: string; received: string } | null;
    entries: Array<{ id: string; type: string; typeLabel: string; quantity: string | null; amount: string | null; reference: string | null; notes: string | null; relatedDocumentType: string | null;
      relatedDocumentId: string | null; recordedAt: string; recordedBy: string | null }>;
  };
  financial: {
    status: string; label: string; figures: Record<string, string>;
    allocations: Array<{ id: string; lineNumber: number; type: "unbilled" | "billed" | "debit_note"; quantity: string; value: string | null; billId: string | null; billNumber: string | null;
      creditId: string | null; creditNumber: string | null; creditStatus: string | null }>;
    bills: Array<{ id: string; billNumber: string; supplierInvoiceNumber: string | null; status: string; total: string; outstanding: string; href: string }>;
    vendorCredits: Array<{ id: string; number: string; status: string; total: string; href: string }>;
  };
  related: { purchaseOrder: { id: string; number: string; href: string }; receipts: Array<{ id: string; number: string; href: string }>;
    rejections: Array<{ id: string; number: string; href: string }>; replacement: { id: string; number: string; href: string } | null };
  history: Array<{ id: string; type: string; summary: string; at: string; actor: string | null }>;
  actions: Record<"edit" | "cancel" | "validate" | "post" | "reverse" | "acknowledge" | "createCredit" | "refund" | "resolve" | "replacement" | "print", boolean>;
};
export type ReturnFile = { id: string; fileName: string; mimeType: string | null; sizeBytes: number; uploadedAt: string };

export const listReturns = (filters: Record<string, string | undefined> = {}) => get<{ rows: ReturnRow[] }>(`/purchase-returns${qs(filters)}`).then((result) => result.rows);
export const getReturnOptions = () => get<{ options: ReturnOptions }>("/purchase-returns/options").then((result) => result.options);
export const getEligible = (params: { order?: string; receipt?: string; exclude?: string }) =>
  get<{ eligible: Eligible }>(`/purchase-returns/eligible${qs(params)}`).then((result) => result.eligible);
export const getReturn = (id: string) => get<ReturnDetail>(`/purchase-returns/${id}`);
export const createReturn = (input: Record<string, unknown>) =>
  post<{ result: { id: string; returnNumber: string; status: string; warnings: string[] } }>("/purchase-returns", input).then((result) => result.result);
export const updateReturn = (id: string, input: Record<string, unknown>) =>
  patch<{ result: { id: string; version: number; warnings: string[] } }>(`/purchase-returns/${id}`, input).then((result) => result.result);
export const returnAction = (id: string, action: "validate" | "post" | "cancel" | "reverse" | "acknowledge" | "resolutions" | "refunds" | "credits" | "replacement",
  input: Record<string, unknown> = {}) => post<{ result: Record<string, unknown> }>(`/purchase-returns/${id}/${action}`, input).then((result) => result.result);
export const listReturnFiles = (id: string) => get<{ files: ReturnFile[] }>(`/purchase-returns/${id}/files`).then((result) => result.files);
export const uploadReturnFile = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: ReturnFile }>(`/purchase-returns/${id}/files`, { method: "POST", body: form });
};
export const removeReturnFile = (id: string, fileId: string) => call<{ result: { removed: boolean } }>(`/purchase-returns/${id}/files/${fileId}`, { method: "DELETE", body: "{}" });
export const returnFileUrl = (id: string, fileId: string) => `/api/procurement/purchase-returns/${id}/files/${fileId}`;
export const returnNoteUrl = (id: string, inline = false) => `/api/documents/procurement.purchase_return/${id}/pdf${inline ? "?disposition=inline" : ""}`;
