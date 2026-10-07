"use client";

// Settings → Payment Terms (services/api/src/core/payment-terms): the shared master for Sales, Procurement and Finance. A term is a set of
// rules — each a share of the document with its due date (N days after a reference date, month end + N days, or a fixed day of a month).
export type TermType = "immediate" | "net_days" | "invoice_receipt" | "end_of_month" | "fixed_day" | "installments" | "advance" | "custom";
export type Rule = { sequence?: number; percentage: string; basis: "invoice_date" | "invoice_received" | "posting_date"; kind: "days" | "end_of_month" | "fixed_day"; days: number; monthsOffset: number;
  dayOfMonth: number | null };
export type Choice = { code: string; label: string };
export type PaymentTerm = {
  id: string; code: string; name: string; description: string | null; termType: TermType; termTypeLabel: string; rules: Rule[]; summary: string; advancePercentage: string | null;
  version: number; buyingRegistrationId: string | null; company: string; salesEnabled: boolean; purchaseEnabled: boolean; isDefaultSales: boolean; isDefaultPurchase: boolean;
  status: "active" | "inactive"; customers: number; suppliers: number; documents: number; inUse: boolean; createdAt: string; createdByName: string | null; updatedAt: string;
  updatedByName: string | null;
};
type Options = { termTypes: Choice[]; referenceBases: Choice[]; ruleKinds: Choice[] };
export type PaymentTermList = Options & { rows: PaymentTerm[]; registrations: Array<{ id: string; name: string }>; capabilities: { manage: boolean; setDefault: boolean } };
export type PaymentTermDetail = Options & {
  term: PaymentTerm;
  events: Array<{ id: string; event_type: string; metadata: Record<string, unknown>; occurred_at: string; actor_name: string | null }>;
  versions: Array<{ version: number; summary: string; termType: string; reason: string | null; createdAt: string; createdByName: string | null }>;
};
export type Preview = { summary: string; advancePercentage: string | null; lines: Array<{ sequence: number; percentage: string; amount: string; dueDate: string | null; referenceDate: string | null;
  basis: string; missing: boolean }> };

export class TermsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | undefined) { super(message); }
}
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/settings/payment-terms${path}`, {
    credentials: "same-origin", ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new TermsApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload;
}
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

export const listPaymentTerms = (filters: Record<string, string | undefined> = {}) => {
  const search = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  return call<PaymentTermList>(search ? `?${search}` : "");
};
export const getPaymentTerm = (id: string) => call<PaymentTermDetail>(`/${id}`);
export const createPaymentTerm = (input: Record<string, unknown>) => call<{ term: PaymentTerm }>("", { method: "POST", body: JSON.stringify(input) });
export const updatePaymentTerm = (id: string, input: Record<string, unknown>) => call<{ term: PaymentTerm }>(`/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const termAction = (id: string, action: "activate" | "deactivate" | "default-sales" | "default-purchase") => call<Record<string, unknown>>(`/${id}/${action}`, { method: "POST", body: "{}" });
export const clearDefault = (direction: "sales" | "purchase") => call<Record<string, unknown>>("/defaults", { method: "POST", body: JSON.stringify({ direction, termId: null }) });
export const previewPaymentTerm = (input: Record<string, unknown>) => call<Preview>("/preview", { method: "POST", body: JSON.stringify(input) });
