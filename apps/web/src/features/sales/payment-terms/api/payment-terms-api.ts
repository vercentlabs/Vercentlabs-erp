"use client";

import { post, request } from "@/features/sales/shared/http";

// The Payment Terms master (services/api/src/core/payment-terms). A term says
// when payment is due: on receipt, N calendar days after the invoice date, or
// a commercial condition in words with no automatic due date.
export type CalculationType = "due_on_receipt" | "net_days" | "custom";
export type PaymentTerm = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  calculationType: CalculationType;
  calculationLabel: string;
  days: number | null;
  salesEnabled: boolean;
  purchaseEnabled: boolean;
  isDefaultSales: boolean;
  status: "active" | "inactive";
  customers: number;
  documents: number;
  inUse: boolean;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
};
export type PaymentTermList = { rows: PaymentTerm[]; calculationTypes: Array<{ code: CalculationType; label: string }>; capabilities: { manage: boolean; setDefault: boolean } };
export type PaymentTermInput = { name: string; calculationType: CalculationType; days?: number | null; description?: string | null; salesEnabled?: boolean; purchaseEnabled?: boolean };

export const listPaymentTerms = (status?: string) => request<PaymentTermList>(`/payment-terms${status && status !== "all" ? `?status=${status}` : ""}`);
export const createPaymentTerm = (input: PaymentTermInput & { code: string }) => post<{ term: PaymentTerm }>("/payment-terms", input);
export const updatePaymentTerm = (id: string, input: Partial<PaymentTermInput>) => request<{ term: PaymentTerm }>(`/payment-terms/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const activatePaymentTerm = (id: string) => post<{ term: PaymentTerm }>(`/payment-terms/${id}/activate`);
export const deactivatePaymentTerm = (id: string) => post<{ term: PaymentTerm }>(`/payment-terms/${id}/deactivate`);
export const setDefaultPaymentTerm = (id: string) => post<{ result: { changed: boolean } }>(`/payment-terms/${id}/default`);
