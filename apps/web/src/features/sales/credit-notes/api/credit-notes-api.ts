"use client";

import { del, post, request, SalesApiError } from "@/features/sales/shared/http";
import type { SalesDocumentEvent } from "@/features/sales/quotations/api/quotations-api";

// Shapes returned by the Credit Notes module (services/api/src/modules/sales/
// credit-notes). The credit note is Finance's customer credit note made
// against a posted sales invoice; how much of it was applied to invoices, and
// the customer credit left, come from what Finance applied.
export type CreditNoteStatusKey = "draft" | "posted" | "reversed" | "cancelled";
export type ApplicationStatusKey = "not_applicable" | "unapplied" | "partially_applied" | "applied" | "refunded" | "settled";
export type CreditType = "quantity" | "amount";
type Snapshot = Record<string, string | null | undefined> | null;

export type CreditNoteRow = {
  id: string;
  invoice_number: string;
  status: CreditNoteStatusKey;
  statusLabel: string;
  finance_status: string;
  invoice_date: string;
  grand_total: string;
  tax_total: string;
  currency_code: string;
  party_id: string;
  customer_name: string | null;
  customer_number: string | null;
  reason_code: string;
  reasonLabel: string;
  source_invoice_id: string;
  source_invoice_number: string;
  sales_order_id: string;
  sales_order_number: string;
  sales_return_id: string | null;
  return_number: string | null;
  sent_at: string | null;
  creditTypes: CreditType[];
  applied: number | null;
  unapplied: number | null;
  refunded: number | null;
  applicationStatus: ApplicationStatusKey;
  applicationStatusLabel: string;
};
export type CreditNoteList = {
  rows: CreditNoteRow[]; total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; reasons: Array<{ code: string; label: string }>;
  capabilities: Record<string, boolean>;
};

export type CreditNoteTax = { customer_invoice_line_id: string; sequence: number; tax_type: string; label: string | null; rate: string; taxable_amount: string; tax_amount: string };
export type CreditNoteLine = {
  id: string;
  sequence: number;
  source_invoice_line_id: string;
  sales_return_line_id: string | null;
  sales_return_id: string | null;
  return_number: string | null;
  credit_type: CreditType;
  item_code_snapshot: string | null;
  item_name_snapshot: string;
  hsn_sac_code: string | null;
  hsn_sac_kind: "hsn" | "sac" | null;
  uom_snapshot: string | null;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  net_amount: string;
  tax_amount: string;
  line_total: string;
  invoiced_quantity: string;
  invoiced_unit_price: string;
  invoiced_net_amount: string;
  taxes: CreditNoteTax[];
};
export type CreditNoteActions = Record<
  "edit" | "editLines" | "post" | "cancel" | "print" | "send" | "markSent" | "reverse" | "creditAmount" | "viewApplication" | "viewAccounting" | "applyCredit" | "refund", boolean>;

export type CreditNoteDetail = {
  creditNote: {
    id: string;
    invoice_number: string;
    status: CreditNoteStatusKey;
    statusLabel: string;
    financeStatus: string;
    reason_code: string;
    reasonLabel: string;
    reason_note: string | null;
    applicationStatus: ApplicationStatusKey;
    applicationStatusLabel: string;
    applied: number | null;
    unapplied: number | null;
    // Paid back to the customer by Finance's posted refunds of this credit.
    refunded: number | null;
    sent: boolean;
    sentLabel: string;
    version: number;
    invoice_date: string;
    accounting_date: string;
    currency_code: string;
    subtotal: string;
    discount_total: string;
    tax_total: string;
    grand_total: string;
    party_id: string;
    customer_number: string | null;
    sales_customer_snapshot: Snapshot;
    contact_snapshot: Snapshot;
    billing_address_snapshot: Snapshot;
    seller_snapshot: Snapshot;
    place_of_supply: string | null;
    place_of_supply_name: string | null;
    supply_nature: string | null;
    customer_po_number: string | null;
    customer_notes: string | null;
    internal_notes: string | null;
    source_invoice_id: string;
    sourceInvoice: { id: string; invoiceNumber: string; invoiceDate: string; grandTotal: number; outstanding: number | null; creditedTotal: number };
    sales_order_id: string;
    sales_order_number: string;
    order_status: string;
    sales_return_id: string | null;
    return_number: string | null;
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
    reversal_entry_number: string | null;
  };
  lines: CreditNoteLine[];
  taxSummary: Array<{ taxType: string; label: string | null; rate: number; taxableAmount: number; taxAmount: number }>;
  allocations: Array<{ id: string; customer_invoice_id: string; allocated_amount: string; allocated_at: string; invoice_number: string; invoice_date: string; is_sales_invoice: boolean }>;
  // Finance's refunds of this credit note's credit (cancelled drafts left out).
  refunds: Array<{ id: string; refund_number: string; status: string; refund_date: string; amount: number; payment_method: string; external_reference: string | null }>;
  deliveries: Array<{ id: string; delivery_number: string }>;
  sends: Array<{ id: string; channel: string; recipients: string | null; subject: string | null; note: string | null; sent_at: string; sent_by_name: string | null }>;
  events: SalesDocumentEvent[];
  problems: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  reasons: Array<{ code: string; label: string }>;
  sentChannels: Array<{ code: string; label: string }>;
  actions: CreditNoteActions;
};

export type CreditProposalLine = {
  invoiceLineId: string; itemName: string; itemCode: string | null; hsnSacCode: string | null; unit: string | null; invoicedQuantity: number; unitPrice: number; taxableAmount: number;
  taxAmount: number; taxes: Array<{ taxType: string; label: string | null; rate: number }>; creditedQuantity: number; creditedValue: number; quantityLeft: number; valueLeft: number;
  draftQuantity: number; draftCreditNotes: string[];
};
export type CreditProposal = {
  invoiceId: string; invoiceNumber: string; invoiceDate: string; currencyCode: string; customerName: string | null; grandTotal: number; outstanding: number; creditedTotal: number;
  canCredit: boolean; canCreditAmount: boolean; reasons: Array<{ code: string; label: string }>; lines: CreditProposalLine[];
};
export type CreditLineInput = { invoiceLineId: string; creditType: CreditType; quantity?: number; amount?: number };
export type CreditPostingCheck = { ready: boolean; problems: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }> };
export type CreditNoteFilters = {
  view?: string; search?: string; status?: string; partyId?: string; reasonCode?: string; salesOrderId?: string; invoiceId?: string; returnId?: string; fromReturn?: string;
  unapplied?: string; dateFrom?: string; dateTo?: string; sort?: string; direction?: string; limit?: number; offset?: number;
};
export type CreditNoteFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
type Warning = { item: string; message: string };

const qs = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};

export const listCreditNotes = (filters: CreditNoteFilters) => request<CreditNoteList>(`/credit-notes${qs(filters)}`);
export const getCreditNote = (id: string) => request<{ creditNote: CreditNoteDetail }>(`/credit-notes/${id}`);
export const getCreditProposal = (invoiceId: string) => request<{ proposal: CreditProposal }>(`/invoices/${invoiceId}/credit-notes`);
export const createCreditNote = (invoiceId: string, input: {
  idempotencyKey: string; reasonCode: string; reasonNote?: string; creditDate?: string; customerNotes?: string; internalNotes?: string; lines: CreditLineInput[];
}) => post<{ result: { creditNoteId: string; creditNoteNumber: string; warnings: Warning[] } }>(`/invoices/${invoiceId}/credit-notes`, input);
export const updateDraftCreditNote = (id: string, input: {
  expectedVersion?: number; lines?: CreditLineInput[]; reasonCode?: string; reasonNote?: string | null; creditDate?: string; customerNotes?: string | null; internalNotes?: string | null;
}) => request<{ result: { version: number; changed: boolean; warnings: Warning[] } }>(`/credit-notes/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const validateCreditNote = (id: string) => request<{ check: CreditPostingCheck }>(`/credit-notes/${id}/validate`);
export const postCreditNote = (id: string, expectedVersion?: number) =>
  post<{ result: { creditNoteNumber: string; status: CreditNoteStatusKey; awaitingApproval?: boolean; applied?: number; unapplied?: number; replayed: boolean } }>(`/credit-notes/${id}/post`, { expectedVersion });
export const cancelCreditNote = (id: string, reason?: string) => post<{ result: unknown }>(`/credit-notes/${id}/cancel`, { reason });
export const reverseCreditNote = (id: string, reason: string) =>
  post<{ result: { unapplied?: Array<{ invoiceNumber: string; amount: string }> } }>(`/credit-notes/${id}/reverse`, { reason });
export const sendCreditNote = (id: string, input: { to: string; cc?: string; subject?: string; message?: string; idempotencyKey: string }) =>
  post<{ result: { sentTo: string } }>(`/credit-notes/${id}/send`, input);
export const markCreditNoteSent = (id: string, input: { channel: string; recipient?: string; note?: string; idempotencyKey?: string }) => post<{ result: unknown }>(`/credit-notes/${id}/mark-sent`, input);
export const creditNotePdfUrl = (id: string, inline = false) => `/api/documents/sales.credit_note/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const listCreditNoteFiles = (id: string) => request<{ files: CreditNoteFile[] }>(`/credit-notes/${id}/files`);
export const creditNoteFileUrl = (id: string, fileId: string) => `/api/sales/credit-notes/${id}/files/${fileId}`;
// Multipart, so the browser sets the content type and boundary itself.
export async function uploadCreditNoteFile(id: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`/api/sales/credit-notes/${id}/files`, { method: "POST", body, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The file could not be uploaded.", response.status, payload.code, payload);
  return payload as { file: CreditNoteFile };
}
export const removeCreditNoteFile = (id: string, fileId: string) => del<{ result: { removed: boolean } }>(`/credit-notes/${id}/files/${fileId}`);
