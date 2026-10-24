"use client";

// Payments Received (Sales plan, Flow 4): the customer's open bills, recording a payment against them, one payment's page.
import { post, request } from "@/features/sales/shared/http";

export type OpenInvoice = { id: string; invoice_number: string; invoice_type: string; invoice_date: string; due_date: string | null; currency_code: string; grand_total: number;
  outstanding_amount: number; days_overdue: number };
export type Advance = { id: string; receipt_number: string; receipt_date: string; currency_code: string; amount: number; unapplied_amount: number; payment_method: string | null;
  external_reference: string | null };
export type OpenItems = {
  customer: { id: string; name: string; currencyCode: string | null };
  invoices: OpenInvoice[];
  advances: Advance[];
  credits: Array<{ id: string; invoice_number: string; invoice_date: string; currency_code: string; outstanding_amount: number }>;
};
export type PaymentInput = {
  partyId: string; amount: number; receiptDate?: string; paymentMethod?: string; reference?: string; chequeNumber?: string; chequeDate?: string; draweeBank?: string;
  bankAccountId?: string | null; notes?: string; allocations?: Array<{ invoiceId: string; amount: number; tdsAmount?: number; tdsSection?: string }>;
};
export type PaymentResult = { postDated?: boolean; chequeId?: string; receiptId: string | null; receiptNumber: string | null; amount: number; applied: number; advance: number;
  allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: number; tds: number }> };
export type PaymentDetail = {
  payment: { id: string; number: string; date: string; amount: number; unapplied: number; currencyCode: string; method: string; methodLabel: string; reference: string | null;
    chequeNumber: string | null; chequeDate: string | null; draweeBank: string | null; bankAccount: string | null; status: string; notes: string | null; reversedAt: string | null;
    reversalReason: string | null; customer: { id: string; name: string; legalName: string | null; gstin: string | null; customerNumber: string | null } };
  allocations: Array<{ invoiceId: string; invoiceNumber: string; invoiceDate: string; invoiceTotal: number; amount: number; tds: number; tdsSection: string | null }>;
};
export type InvoiceAdvances = { outstanding: number; payable: boolean; advances: Advance[]; available: number };

export const getOpenItems = (partyId: string) => request<OpenItems>(`/customers/${partyId}/open-items`);
export const recordPayment = (input: PaymentInput) => post<{ result: PaymentResult }>("/payments", input);
export const getPayment = (id: string) => request<PaymentDetail>(`/payments/${id}`);
export const getInvoiceAdvances = (invoiceId: string) => request<InvoiceAdvances>(`/invoices/${invoiceId}/advances`);
export const applyAdvance = (invoiceId: string, input: { receiptId?: string; amount?: number } = {}) =>
  post<{ result: { applied: number; outstanding: number; status: string } }>(`/invoices/${invoiceId}/advances`, input);
export const receiptPdfUrl = (id: string, inline = false) => `/api/documents/sales.receipt/${id}/pdf${inline ? "?disposition=inline" : ""}`;

// Oldest bill first: as much of the amount as each still owes (the server does the same when no allocation is sent).
export function oldestFirst(invoices: OpenInvoice[], amount: number) {
  let left = Math.round(amount * 100);
  const result: Record<string, number> = {};
  for (const invoice of invoices) {
    const take = Math.max(0, Math.min(left, Math.round(invoice.outstanding_amount * 100)));
    result[invoice.id] = take / 100;
    left -= take;
  }
  return result;
}
