"use client";

// Debit notes to customers (Sales plan): raised on a posted invoice for an undercharge or a rate difference, posted to be collected.
import { post, request } from "@/features/sales/shared/http";

export type DebitNote = {
  id: string; number: string; date: string; dueDate: string | null; status: "draft" | "posted" | "cancelled" | "reversed"; financeStatus: string; currencyCode: string;
  subtotal: number; taxTotal: number; total: number; outstanding: number; reasonCode: string; reasonLabel: string; reasonNote: string | null;
  customer: { id: string; name: string | null; gstin: string | null }; sourceInvoice: { id: string; number: string; date: string | null };
  salesOrder: { id: string; number: string } | null; sentAt: string | null; sentChannel: string | null; postedAt: string | null; createdAt: string;
};
export type DebitNoteLine = { id: string; item_name_snapshot: string; hsn_sac_code: string | null; hsn_sac_kind: string | null; net_amount: string; tax_amount: string; line_total: string;
  taxes: Array<{ tax_type: string; rate: number; tax_amount: number }> };
export type DebitNoteProposal = {
  invoice: { id: string; number: string; date: string; currencyCode: string; customer: string | null };
  reasons: Array<{ code: string; label: string }>;
  lines: Array<{ invoiceLineId: string; item: string; hsnSacCode: string | null; quantity: number; unit: string | null; unitPrice: number; taxable: number; taxRate: number }>;
};

export const listDebitNotes = (query: URLSearchParams) => request<{ rows: DebitNote[]; total: number }>(`/debit-notes?${query}`);
export const getDebitNote = (id: string) => request<{ debitNote: DebitNote; lines: DebitNoteLine[]; actions: { post: boolean; cancel: boolean } }>(`/debit-notes/${id}`);
export const getDebitNoteProposal = (invoiceId: string) => request<{ proposal: DebitNoteProposal }>(`/invoices/${invoiceId}/debit-notes`).then((r) => r.proposal);
export const createDebitNote = (invoiceId: string, input: { idempotencyKey: string; reasonCode: string; reasonNote?: string; debitDate?: string; lines: Array<{ invoiceLineId: string; amount: number }> }) =>
  post<{ result: { debitNoteId: string; debitNoteNumber: string } }>(`/invoices/${invoiceId}/debit-notes`, input);
export const postDebitNote = (id: string) =>
  post<{ result: { status: string; awaitingApproval?: boolean; einvoice: { status: string; irn?: string; error?: string } | null } }>(`/debit-notes/${id}/post`);
export const cancelDebitNote = (id: string, reason?: string) => post(`/debit-notes/${id}/cancel`, { reason });
export const debitNotePdfUrl = (id: string, inline = false) => `/api/documents/sales.debit_note/${id}/pdf${inline ? "?disposition=inline" : ""}`;
