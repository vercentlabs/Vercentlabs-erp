"use client";

import { post, request } from "@/features/procurement/shared/http";

// Supplier Payments, MSME payments and the advances a supplier holds (Procurement plan Phase 1).
const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type SupplierPaymentRow = {
  id: string; number: string; date: string; method: string; methodLabel: string; reference: string | null; amount: string; unapplied: string; status: string; statusLabel: string;
  currencyCode: string; supplierId: string; supplierNumber: string; supplierName: string; bills: Array<{ id: string; number: string }>; purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
};
export type SupplierPaymentList = { rows: SupplierPaymentRow[]; total: number; views: Array<{ key: string; label: string }>; methods: Array<{ code: string; label: string }> };
export type SupplierPaymentDetail = {
  payment: {
    id: string; number: string; date: string; method: string; methodLabel: string; reference: string | null; amount: string; unapplied: string; status: string; statusLabel: string;
    currencyCode: string; notes: string | null; bankAccount: string | null; purchaseOrderId: string | null; purchaseOrderNumber: string | null; reversedAt: string | null;
    reversalReason: string | null; createdBy: string | null; tdsWithheld: string; accountingHref: string | null; canPost: boolean;
  };
  supplier: { id: string; number: string; name: string; legalName: string | null; gstin: string | null; pan: string | null; msme: { classification: string; udyam: string | null } | null };
  allocations: Array<{ id: string; billId: string; billNumber: string; supplierInvoice: string | null; billDate: string; dueDate: string | null; billTotal: string; taxable: string; tds: string;
    tdsSection: string | null; amount: string; balance: string; reversed: boolean; href: string }>;
  planned: Array<{ billId: string; billNumber: string | null; supplierInvoice: string | null; billDate: string | null; amount: string; tds: string; href: string }>;
};
export type PayResult = { payments: Array<{ paymentId: string; paymentNumber: string; status: "posted" | "awaiting_approval"; amount: string; bills: string[]; advice?: string | null }> };
export type SupplierAdvances = { total: string; advances: Array<{ id: string; number: string; date: string; available: string; currencyCode: string; purchaseOrderNumber: string | null; againstThisOrder: boolean }> };
export type MsmeRow = {
  id: string; billId: string; billNumber: string; supplierInvoice: string | null; supplierId: string; supplierName: string; classification: string | null; udyam: string | null;
  sourceReference: string; acceptanceDate: string; statutoryDays: number; statutoryDueDate: string; daysLeft: number; bucket: string; disputed: boolean; disputeReference: string | null;
  outstanding: string; currencyCode: string; href: string;
};
export type MsmePayments = { today: string; bucket: string; buckets: Array<{ key: string; label: string; count: number; total: string }>; rows: MsmeRow[]; total: number };

export const listSupplierPayments = (filters: Record<string, string | undefined>) => request<SupplierPaymentList>(`/payments${qs(filters)}`);
export const getSupplierPayment = (id: string) => request<SupplierPaymentDetail>(`/payments/${id}`);
export const paySupplierBills = (input: { bills: Array<{ billId: string; amount?: string }>; paymentDate?: string; paymentMethod?: string; bankAccountId?: string; reference?: string }) =>
  post<{ result: PayResult }>("/payments", input).then((result) => result.result);
export const completeSupplierPayment = (id: string) => post<{ result: { paymentId: string; status: string; skipped?: string[] } }>(`/payments/${id}/complete`).then((result) => result.result);
export const getSupplierAdvances = (supplierId: string, purchaseOrderId?: string) => request<SupplierAdvances>(`/payments/advances${qs({ supplierId, purchaseOrderId })}`);
export const listMsmePayments = (filters: Record<string, string | undefined>) => request<MsmePayments>(`/payables/msme${qs(filters)}`);
export const paymentAdviceUrl = (id: string, inline = false) => `/api/documents/procurement.payment_advice/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

// MSME-1 and the year-end figures (Procurement report Phase 3).
export type Msme1 = { period: { half: string; from: string; to: string }; asOf: string; total: string;
  rows: Array<{ supplierId: string; supplierName: string; udyam: string | null; billId: string; billNumber: string; dueDate: string; daysOverdue: number; amount: string }> };
export type MsmeYearEnd = { asOf: string; bankRate: string; interestRate: string; owed: string; pastDue: string; interest: string;
  suppliers: Array<{ supplierId: string; supplierName: string; udyam: string | null; owed: string; pastDue: string; interest: string }> };
export const getMsme1 = (half: string) => request<Msme1>(`/payables/msme/msme-1?half=${encodeURIComponent(half)}`);
export const msme1CsvUrl = (half: string) => `/api/procurement/payables/msme/msme-1?half=${encodeURIComponent(half)}&format=csv`;
export const getMsmeYearEnd = (year: number, bankRate: string) => request<MsmeYearEnd>(`/payables/msme/year-end?year=${year}&bankRate=${encodeURIComponent(bankRate)}`);
