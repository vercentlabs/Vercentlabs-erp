"use client";

// Payables (Finance MVP F5): the client of /api/accounting/{payables, payments, payment-allocations}.
import { AccountingApiError } from "@/features/accounting/shared/client";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/accounting${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload as T;
}
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AccountingApiError ? error.status : 0);

export type PayableBill = {
  id: string; number: string; supplierInvoice: string | null; type: string; date: string | null; dueDate: string | null; currency: string; total: number; outstanding: number;
  baseOutstanding: number; inPayment: number; status: string; daysOverdue: number; partyId: string; party: string; href: string;
};
export const listPayableBills = (filters: Record<string, string | undefined>) => call<{ bills: PayableBill[] }>(`/payables/bills${qs(filters)}`).then((r) => r.bills);

export type PaymentStatus = "draft" | "pending_approval" | "approved" | "posted" | "partially_applied" | "applied" | "reversed" | "cancelled";
export type Payment = {
  id: string; number: string; date: string | null; partyId: string; party: string; currency: string; amount: number; unapplied: number; applied: number; planned: number;
  method: string; reference: string | null; status: PaymentStatus; account: string | null; notes: string | null; submittedById: string | null; submittedBy: string | null;
  approvedBy: string | null; approvedAt: string | null; contentHash: string | null; journalEntryId: string | null; reversedAt: string | null; reversalReason: string | null;
  reversalJournalEntryId: string | null; cancelReason: string | null; createdBy: string | null; createdAt: string;
};
export type OpenBill = { id: string; number: string; supplierInvoice: string | null; date: string | null; dueDate: string | null; total: number; outstanding: number; overdue: boolean };
export type PaymentRecord = Payment & {
  plannedAllocations: Array<{ billId: string; bill: string; supplierInvoice: string | null; dueDate: string | null; amount: number; stillOwed: number; href: string }>;
  allocations: Array<{ id: string; billId: string; bill: string; supplierInvoice: string | null; href: string; amount: number; settled: number; at: string; by: string | null;
    undone: { at: string; by: string | null; reason: string } | null }>;
  openBills: OpenBill[];
  history: Array<{ label: string; at: string; actor: string | null; detail: string | null }>;
};
export type PaymentOptions = {
  baseCurrency: string; today: string; approval: { required: boolean; threshold: number };
  suppliers: Array<{ id: string; name: string; number: string | null; currency: string | null }>; accounts: Array<{ id: string; label: string; cash: boolean; currency: string | null }>;
  openBills: OpenBill[]; unapplied: number;
};
export type PaymentInput = {
  partyId: string; paymentDate: string; amount: string; currencyCode?: string; bankAccountId?: string | null; paymentMethod: string; reference?: string | null; notes?: string | null;
  allocations?: Array<{ billId: string; amount: string }>;
};
export const listPayments = (filters: Record<string, string | undefined>) => call<{ payments: Payment[] }>(`/payments${qs(filters)}`).then((r) => r.payments);
export const getPayment = (id: string) => call<{ payment: PaymentRecord }>(`/payments/${id}`).then((r) => r.payment);
export const paymentOptions = (partyId?: string | null) => call<{ options: PaymentOptions }>(`/payments/options${qs({ partyId })}`).then((r) => r.options);
export const preparePayment = (input: PaymentInput) => post<{ payment: { id: string; number: string; status: string } }>("/payments", input).then((r) => r.payment);
export type PaymentStep = "approve" | "reject" | "post" | "apply" | "apply-oldest" | "resubmit" | "discard" | "reverse";
export const paymentStep = (id: string, step: PaymentStep, input: Record<string, unknown> = {}) => post<{ payment: PaymentRecord }>(`/payments/${id}/${step}`, input).then((r) => r.payment);
export const undoPaymentAllocation = (allocationId: string, reason: string) => post(`/payment-allocations/${allocationId}/undo`, { reason });

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Sent back", tone: "warning" }, pending_approval: { label: "Awaiting approval", tone: "info" }, approved: { label: "Approved — to post", tone: "info" },
  posted: { label: "Not applied", tone: "warning" }, partially_applied: { label: "Partly applied", tone: "info" }, applied: { label: "Paid", tone: "success" },
  reversed: { label: "Reversed", tone: "danger" }, cancelled: { label: "Discarded", tone: "neutral" },
};
export const BILL_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  posted: { label: "To pay", tone: "info" }, partially_paid: { label: "Partly paid", tone: "info" }, paid: { label: "Paid", tone: "success" }, overdue: { label: "Overdue", tone: "danger" },
  disputed: { label: "Disputed", tone: "warning" }, reversed: { label: "Reversed", tone: "neutral" },
};
export { METHODS, methodLabel, inr, cents, fromCents } from "@/features/accounting/receivables/api/receivables-api";
