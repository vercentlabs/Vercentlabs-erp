"use client";

import { request, post } from "@/features/pos/shared/http";

export type PosInvoice = {
  id: string;
  invoice_number: string;
  invoice_type: "invoice" | "credit_note" | "debit_note" | "opening";
  status: string;
  invoice_date: string;
  due_date: string;
  currency_code: string;
  grand_total: string;
  outstanding_amount: string;
  customer_name?: string;
  [key: string]: unknown;
};
export type PosInvoiceLine = {
  id: string;
  sequence: number;
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  net_amount: string;
  tax_amount: string;
  line_total: string;
};
export type PosInvoiceDetail = { invoice: PosInvoice; lines: PosInvoiceLine[]; [key: string]: unknown };
export type PosInvoiceListRow = {
  sale_id: string;
  receipt_number: string;
  store_id: string;
  customer_id: string | null;
  customer_name: string | null;
  sale_date: string;
  grand_total: string;
  currency_code: string;
  invoice_generated_at: string;
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  due_date: string;
};

// F290
export const generatePosSaleInvoice = (saleId: string, input?: { notes?: string | null; idempotencyKey?: string }) =>
  post<PosInvoiceDetail>(`/sales/${saleId}/invoice`, input ?? {});
export const getPosSaleInvoice = (saleId: string) => request<PosInvoiceDetail>(`/sales/${saleId}/invoice`);
export const listPosInvoices = (query: { storeId?: string; customerId?: string; limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (query.storeId) params.set("storeId", query.storeId);
  if (query.customerId) params.set("customerId", query.customerId);
  if (query.limit) params.set("limit", String(query.limit));
  return request<{ rows: PosInvoiceListRow[] }>(`/invoices${params.size ? `?${params}` : ""}`);
};
