"use client";

import { del, post, request, SalesApiError } from "@/features/sales/shared/http";

// Shapes returned by the Sales Returns module (services/api/src/modules/sales/returns).
// What came back is worked out from received returns; prices are never shown here.
export type ReturnStatusKey = "draft" | "received" | "cancelled";
export type Disposition = "restock" | "inspection" | "damaged" | "other";
type Option = { code: string; label: string };

export type ReturnRow = {
  id: string; return_number: string; status: ReturnStatusKey; statusLabel: string; return_date: string; reason_code: string; reasonLabel: string;
  sales_order_id: string; sales_order_number: string; delivery_id: string; delivery_number: string; customer_name: string | null; warehouse_name: string | null;
  line_count: number; total_quantity: string; invoice_numbers: string | null; credit_note_numbers: string | null; creditStatus: string; creditStatusLabel: string;
};
export type ReturnList = { rows: ReturnRow[]; total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; reasons: Option[]; capabilities: Record<string, boolean> };

export type ReturnLine = {
  id: string; sequence: number; delivery_line_id: string; sales_order_line_id: string; item_id: string; item_code_snapshot: string | null; item_name_snapshot: string;
  uom_snapshot: string | null; quantity: number; base_quantity: number; disposition: Disposition; dispositionLabel: string; sellable: boolean; reason_code: string | null;
  reasonLabel: string | null; location_code: string | null; location_name: string | null; movement_number: string | null; delivered: number | null;
  returned_elsewhere: number | null; returnable_now: number | null; on_other_drafts: number;
};
export type ReturnDetail = {
  salesReturn: {
    id: string; return_number: string; status: ReturnStatusKey; statusLabel: string; version: number; return_date: string; reason_code: string; reasonLabel: string;
    reason_note: string | null; sales_order_id: string; sales_order_number: string; delivery_id: string; delivery_number: string; party_id: string;
    customer_snapshot: Record<string, string | null> | null; customer_number: string | null; customer_po_number: string | null; warehouse_id: string; warehouse_name: string | null;
    delivery_warehouse_id: string | null; delivery_warehouse_name: string | null; customer_notes: string | null; internal_notes: string | null;
    created_at: string; created_by_name: string | null; received_at: string | null; received_by_name: string | null; cancelled_at: string | null; cancelled_by_name: string | null;
    cancel_reason: string | null; total_quantity: number; creditStatus: string; creditStatusLabel: string;
  };
  lines: ReturnLine[];
  credit: { status: string; label: string; creditable: number; lines: Array<{ returnLineId: string; item: string; quantity: number; invoiced: number; credited: number; creditable: number }> };
  movements: Array<{ id: string; movement_number: string; quantity: string; created_at: string; item_name: string; warehouse_name: string; location_code: string | null; location_type: string | null }>;
  // The credit notes made for the return, each with Finance's refunds of its credit.
  credits: Array<{
    id: string; invoice_number: string; status: string; invoice_date: string; source_invoice_id: string; source_invoice_number: string;
    refunds: Array<{ id: string; refundNumber: string; status: string; amount: string; currencyCode: string }>;
  }>;
  invoices: Array<{ id: string; invoice_number: string; status: string; invoice_date: string }>;
  events: Array<{ id: string; event_type: string; metadata: Record<string, unknown> | null; occurred_at: string; actor_name: string | null }>;
  draftWarnings: Array<{ item: string; message: string }>;
  reasons: Option[];
  dispositions: Array<Option & { sellable: boolean }>;
  actions: Record<"edit" | "receive" | "cancel" | "print" | "creditNote" | "selectWarehouse", boolean>;
};
export type ReturnProposal = {
  deliveryId: string; deliveryNumber: string; canReturn: boolean; warehouseId: string | null;
  lines: Array<{ deliveryLineId: string; itemName: string; itemCode: string | null; unit: string | null; delivered: number; returned: number; returnable: number; onDrafts: number; stockTracked: boolean }>;
  reasons: Option[];
  dispositions: Array<Option & { sellable: boolean }>;
};
export type ReturnLineInput = { deliveryLineId: string; quantity: number; disposition: Disposition };
export type ReturnFilters = Record<string, string | number | undefined>;
export type ReturnFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };

const qs = (values: ReturnFilters) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};

export const listReturns = (filters: ReturnFilters) => request<ReturnList>(`/returns${qs(filters)}`);
export const getReturn = (id: string) => request<{ salesReturn: ReturnDetail }>(`/returns/${id}`);
export const getReturnProposal = (deliveryId: string) => request<{ proposal: ReturnProposal }>(`/deliveries/${deliveryId}/returns`);
export const createReturn = (deliveryId: string, input: {
  idempotencyKey: string; lines: ReturnLineInput[]; reasonCode: string; reasonNote?: string; warehouseId?: string; returnDate?: string; customerNotes?: string; internalNotes?: string;
}) => post<{ result: { returnId: string; returnNumber: string; warnings: Array<{ message: string }> } }>(`/deliveries/${deliveryId}/returns`, input);
export const updateReturn = (id: string, input: {
  expectedVersion?: number; lines?: ReturnLineInput[]; reasonCode?: string; reasonNote?: string | null; warehouseId?: string; returnDate?: string; customerNotes?: string | null; internalNotes?: string | null;
}) => request<{ result: { changed: boolean } }>(`/returns/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const receiveReturn = (id: string, expectedVersion?: number) => post<{ result: { returnNumber: string } }>(`/returns/${id}/receive`, { expectedVersion });
export const cancelReturn = (id: string, reason?: string) => post<{ result: unknown }>(`/returns/${id}/cancel`, { reason });
export const creditReturn = (id: string, input: { idempotencyKey: string; reason?: string; lines?: Array<{ returnLineId: string; quantity: number }> }) =>
  post<{ result: { creditNotes: Array<{ creditNoteId: string; creditNoteNumber: string }> } }>(`/returns/${id}/credit-notes`, input);
export const returnNotePdfUrl = (id: string, inline = false) => `/api/documents/sales.return/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const listReturnFiles = (id: string) => request<{ files: ReturnFile[] }>(`/returns/${id}/files`);
export const returnFileUrl = (id: string, fileId: string) => `/api/sales/returns/${id}/files/${fileId}`;
export async function uploadReturnFile(id: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`/api/sales/returns/${id}/files`, { method: "POST", body, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The file could not be uploaded.", response.status, payload.code, payload);
  return payload as { file: ReturnFile };
}
export const removeReturnFile = (id: string, fileId: string) => del<{ result: { removed: boolean } }>(`/returns/${id}/files/${fileId}`);
