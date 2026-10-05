"use client";

import { del, post, request, SalesApiError } from "@/features/sales/shared/http";
import type { SalesDocumentEvent } from "@/features/sales/quotations/api/quotations-api";

// Shapes returned by the Sales Invoices module (services/api/src/modules/sales/
// invoices). The invoice is Finance's customer invoice; its payment status,
// amount paid and balance are worked out from what Finance applied.
export type InvoiceStatusKey = "draft" | "posted" | "reversed" | "cancelled";
export type PaymentStatusKey = "not_applicable" | "unpaid" | "partially_paid" | "paid";
type Snapshot = Record<string, string | null | undefined> | null;

export type InvoiceRow = {
  id: string;
  invoice_number: string;
  status: InvoiceStatusKey;
  statusLabel: string;
  finance_status: string;
  paymentStatus: PaymentStatusKey;
  paymentStatusLabel: string;
  overdue: boolean;
  invoice_date: string;
  due_date: string;
  grand_total: string;
  balance_due: number;
  currency_code: string;
  party_id: string;
  customer_name: string | null;
  customer_number: string | null;
  sales_order_id: string;
  sales_order_number: string;
  owner_name: string | null;
  sent_at: string | null;
};
export type InvoiceList = { rows: InvoiceRow[]; total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; capabilities: Record<string, boolean> };

export type InvoiceTax = { customer_invoice_line_id: string; sequence: number; tax_type: string; label: string | null; rate: string; taxable_amount: string; tax_amount: string };
export type InvoiceLine = {
  id: string;
  sequence: number;
  source_sales_order_line_id: string;
  source_sales_delivery_line_id: string | null;
  delivery_id: string | null;
  delivery_number: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string;
  description_snapshot: string | null;
  hsn_sac_code: string | null;
  hsn_sac_kind: "hsn" | "sac" | null;
  uom_snapshot: string | null;
  quantity: string;
  list_unit_price: string | null;
  unit_price: string;
  gross_amount: string | null;
  line_discount_amount: string | null;
  document_discount_amount: string | null;
  discount_amount: string;
  net_amount: string;
  tax_amount: string;
  line_total: string;
  taxes: InvoiceTax[];
};
export type InvoiceActions = Record<"edit" | "post" | "cancel" | "print" | "send" | "markSent" | "recordPayment" | "creditNote" | "reverse" | "viewPayments" | "viewAccounting", boolean>;

export type InvoiceDetail = {
  invoice: {
    id: string;
    invoice_number: string;
    status: InvoiceStatusKey;
    statusLabel: string;
    financeStatus: string;
    paymentStatus: PaymentStatusKey;
    paymentStatusLabel: string;
    overdue: boolean;
    amountPaid: number | null;
    credited: number | null;
    balanceDue: number;
    sent: boolean;
    sentLabel: string;
    version: number;
    invoice_date: string;
    accounting_date: string;
    due_date: string;
    currency_code: string;
    subtotal: string;
    discount_total: string;
    tax_total: string;
    rounding_adjustment: string;
    grand_total: string;
    party_id: string;
    customer_number: string | null;
    sales_customer_snapshot: Snapshot;
    contact_id: string | null;
    contact_snapshot: Snapshot;
    billing_address_snapshot: Snapshot;
    shipping_address_snapshot: Snapshot;
    seller_snapshot: Snapshot;
    payment_term_snapshot: { name?: string | null } | null;
    place_of_supply: string | null;
    place_of_supply_name: string | null;
    supply_nature: string | null;
    customer_po_number: string | null;
    customer_notes: string | null;
    internal_notes: string | null;
    terms_and_conditions: string | null;
    quantity_basis: "ordered" | "delivered";
    sales_order_id: string;
    sales_order_number: string;
    source_quotation_id: string | null;
    source_quotation_number: string | null;
    source_opportunity_id: string | null;
    source_opportunity_name: string | null;
    owner_name: string | null;
    created_at: string;
    created_by_name: string | null;
    posted_at: string | null;
    posted_by_name: string | null;
    reversed_at: string | null;
    reversed_by_name: string | null;
    reversal_reason: string | null;
    sent_at: string | null;
    sent_to: string | null;
    sent_by_name: string | null;
    journal_entry_id: string | null;
    journal_entry_number: string | null;
    e_invoice_status: string | null;
    e_invoice_reference: string | null;
  };
  lines: InvoiceLine[];
  taxSummary: Array<{ taxType: string; label: string | null; rate: number; taxableAmount: number; taxAmount: number }>;
  receipts: Array<{ id: string; allocated_amount: string; allocated_at: string; receipt_number: string; receipt_date: string; payment_method: string | null }>;
  credits: Array<{ id: string; allocated_amount: string; allocated_at: string; credit_note_number: string }>;
  creditNotes: Array<{ id: string; invoice_number: string; status: string; invoice_date: string; grand_total: string; currency_code: string }>;
  deliveries: Array<{ id: string; delivery_number: string; delivery_status: string; dispatch_date: string | null }>;
  sends: Array<{ id: string; channel: string; recipients: string | null; subject: string | null; note: string | null; sent_at: string; sent_by_name: string | null }>;
  events: SalesDocumentEvent[];
  sentChannels: Array<{ code: string; label: string }>;
  // Other drafts billing the same order lines, when together they bill more than is left.
  draftWarnings: Array<{ item: string; message: string }>;
  actions: InvoiceActions;
};

export type InvoiceProposal = {
  orderId: string;
  basis: "ordered" | "delivered";
  canInvoice: boolean;
  lines: Array<{
    salesOrderLineId: string; itemName: string; unit: string | null; ordered: number; delivered: number; invoiced: number; cancelled: number; remainingToInvoice: number;
    eligible: number; pendingDelivery: number; onDrafts: number; draftInvoices: Array<{ invoiceNumber: string; quantity: number }>; isService: boolean;
  }>;
};
export type PostingCheck = {
  ready: boolean; problems: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }>; taxDifferences: Array<{ item: string; invoiced: string; expected: string }>;
};
export type InvoiceFilters = {
  view?: string; search?: string; status?: string; paymentStatus?: string; partyId?: string; salesOrderId?: string; ownerUserId?: string; currencyCode?: string;
  dateFrom?: string; dateTo?: string; dueFrom?: string; dueTo?: string; overdue?: string; sort?: string; direction?: string; limit?: number; offset?: number;
};
export type InvoiceFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
type QuantityLine = { salesOrderLineId: string; quantity: number };
type Created = { result: { invoiceId: string; invoiceNumber: string; status: InvoiceStatusKey; replayed: boolean } };

const qs = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};

export const listInvoices = (filters: InvoiceFilters) => request<InvoiceList>(`/invoices${qs(filters)}`);
export const getInvoice = (id: string) => request<{ invoice: InvoiceDetail }>(`/invoices/${id}`);
export const getInvoiceProposal = (orderId: string) => request<{ proposal: InvoiceProposal }>(`/orders/${orderId}/invoices`);
export const createInvoiceFromOrder = (orderId: string, input: { idempotencyKey: string; lines: QuantityLine[]; invoiceDate?: string; customerNotes?: string; internalNotes?: string }) =>
  post<Created>(`/orders/${orderId}/invoices`, input);
export const createInvoiceFromDelivery = (deliveryId: string, input: { idempotencyKey: string; lines?: Array<{ deliveryLineId: string; quantity: number }>; invoiceDate?: string }) =>
  post<Created>(`/deliveries/${deliveryId}/invoices`, input);
export const updateDraftInvoice = (id: string, input: {
  expectedVersion?: number; lines?: QuantityLine[]; invoiceDate?: string; postingDate?: string; dueDate?: string; contactId?: string | null; customerNotes?: string | null;
  internalNotes?: string | null; recalculateTax?: boolean;
}) => request<{ result: { version: number; changed: boolean } }>(`/invoices/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const validateInvoice = (id: string) => request<{ check: PostingCheck }>(`/invoices/${id}/validate`);
export const postInvoice = (id: string, expectedVersion?: number) => post<{ result: { invoiceNumber: string; status: InvoiceStatusKey; awaitingApproval?: boolean; replayed: boolean } }>(`/invoices/${id}/post`, { expectedVersion });
export const cancelInvoice = (id: string, reason?: string) => post<{ result: unknown }>(`/invoices/${id}/cancel`, { reason });
export const reverseInvoice = (id: string, reason: string) => post<{ result: unknown }>(`/invoices/${id}/reverse`, { reason });
export const sendInvoice = (id: string, input: { to: string; cc?: string; subject?: string; message?: string; idempotencyKey: string }) =>
  post<{ result: { sentTo: string } }>(`/invoices/${id}/send`, input);
export const markInvoiceSent = (id: string, input: { channel: string; recipient?: string; note?: string; idempotencyKey?: string }) => post<{ result: unknown }>(`/invoices/${id}/mark-sent`, input);
export const createCreditNote = (id: string, input: { idempotencyKey: string; reason: string; lines: Array<{ invoiceLineId: string; quantity: number }> }) =>
  post<{ result: { creditNoteId: string; creditNoteNumber: string } }>(`/invoices/${id}/credit-notes`, input);
export const invoicePdfUrl = (id: string, inline = false) => `/api/documents/sales.invoice/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const listInvoiceFiles = (id: string) => request<{ files: InvoiceFile[] }>(`/invoices/${id}/files`);
export const invoiceFileUrl = (id: string, fileId: string) => `/api/sales/invoices/${id}/files/${fileId}`;
// Multipart, so the browser sets the content type and boundary itself.
export async function uploadInvoiceFile(id: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`/api/sales/invoices/${id}/files`, { method: "POST", body, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The file could not be uploaded.", response.status, payload.code, payload);
  return payload as { file: InvoiceFile };
}
export const removeInvoiceFile = (id: string, fileId: string) => del<{ result: { removed: boolean } }>(`/invoices/${id}/files/${fileId}`);
