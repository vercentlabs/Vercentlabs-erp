"use client";

// GST Invoice (0098): POS invoices are issued by the server when a sale completes; the screen previews, looks up and reports them — it never
// computes a tax, a number or a document type.
import type { InvoiceRegistration, InvoiceSeries, PosGstSummary, PosInvoice, PosInvoicePreview } from "@vercentlabs/api";

import { request } from "@/features/pos/shared/http";

export const invoicePreview = (cartId: string) => request<{ preview: PosInvoicePreview }>(`/carts/${cartId}/invoice-preview`).then((result) => result.preview);
export const saleInvoice = (saleId: string) => request<{ invoice: PosInvoice | null; note: string | null }>(`/sales/${saleId}/invoice`);
export const listInvoices = (filters: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)]));
  return request<{ rows: PosInvoice[]; total: number }>(`/invoices${params.size ? `?${params}` : ""}`);
};
export const gstSummary = () => request<{ summary: PosGstSummary }>("/reports/gst").then((result) => result.summary);
export const invoiceSeries = () => request<{ currentFinancialYear: string; einvoiceProviderAvailable: boolean; registrations: InvoiceRegistration[]; series: InvoiceSeries[];
  defaultPrefixes: Record<string, string> }>("/invoice-series");
export const saveSeries = (input: Record<string, unknown>) => request<{ series: unknown }>("/invoice-series", { method: "POST", body: JSON.stringify(input) });
export const saveEInvoice = (registrationId: string, input: { applicable: boolean; applicableFrom?: string | null }) =>
  request<{ registration: unknown }>(`/invoice-registrations/${registrationId}/einvoice`, { method: "PUT", body: JSON.stringify(input) });

export const DOCUMENT_LABEL: Record<string, string> = {
  tax_invoice: "Tax invoice", bill_of_supply: "Bill of supply", invoice_cum_bill_of_supply: "Tax invoice cum bill of supply", credit_note: "Credit note", debit_note: "Debit note",
  receipt: "Receipt (non-GST)",
};
export const SERIES_LABEL: Record<string, string> = { tax_invoice: "Tax invoices", bill_of_supply: "Bills of supply", credit_note: "Credit notes", debit_note: "Debit notes" };
