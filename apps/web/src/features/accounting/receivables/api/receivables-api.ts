"use client";

// Receivables (Finance MVP F4): the client of /api/accounting/{receivables, receipts, receipt-allocations}.
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

export type ReceivableInvoice = {
  id: string; number: string; type: "invoice" | "credit_note" | "debit_note" | "opening"; date: string | null; dueDate: string | null; currency: string; total: number; outstanding: number;
  baseOutstanding: number; status: string; daysOverdue: number; partyId: string; party: string; href: string | null;
};
export const listReceivableInvoices = (filters: Record<string, string | undefined>) =>
  call<{ invoices: ReceivableInvoice[] }>(`/receivables/invoices${qs(filters)}`).then((r) => r.invoices);
export const applyCreditNote = (creditNoteId: string, allocations: Array<{ invoiceId: string; amount: string }>) =>
  post(`/receivables/credit-notes/${creditNoteId}/apply`, { allocations });

export type Receipt = {
  id: string; number: string; date: string | null; partyId: string; party: string; currency: string; amount: number; unapplied: number; applied: number; method: string;
  reference: string | null; status: "posted" | "partially_applied" | "applied" | "reversed" | "cancelled" | "draft"; account: string | null; notes: string | null;
  journalEntryId: string | null; reversedAt: string | null; reversalReason: string | null; reversalJournalEntryId: string | null; createdBy: string | null; createdAt: string;
};
export type OpenInvoice = { id: string; number: string; date: string | null; dueDate: string | null; total: number; outstanding: number; overdue: boolean };
export type ReceiptRecord = Receipt & {
  allocations: Array<{ id: string; invoiceId: string; invoice: string; invoiceDate: string | null; href: string | null; amount: number; settled: number; discount: number; writeoff: number;
    at: string; by: string | null; undone: { at: string; by: string | null; reason: string } | null }>;
  openInvoices: OpenInvoice[];
  history: Array<{ label: string; at: string; actor: string | null; detail: string | null }>;
};
export type ReceiptOptions = {
  baseCurrency: string; today: string; customers: Array<{ id: string; name: string; number: string | null; currency: string | null }>;
  accounts: Array<{ id: string; label: string; cash: boolean; currency: string | null }>; currencies: Array<{ code: string; name: string }>; openInvoices: OpenInvoice[]; unapplied: number;
};
export type ReceiptInput = {
  partyId: string; receiptDate: string; amount: string; currencyCode?: string; bankAccountId?: string | null; paymentMethod: string; reference?: string | null; notes?: string | null;
  allocations?: Array<{ invoiceId: string; amount: string; discountTaken?: string; writeoffAmount?: string }>;
};
export const listReceipts = (filters: Record<string, string | undefined>) => call<{ receipts: Receipt[] }>(`/receipts${qs(filters)}`).then((r) => r.receipts);
export const getReceipt = (id: string) => call<{ receipt: ReceiptRecord }>(`/receipts/${id}`).then((r) => r.receipt);
export const receiptOptions = (partyId?: string | null, currencyCode?: string | null) =>
  call<{ options: ReceiptOptions }>(`/receipts/options${qs({ partyId, currencyCode })}`).then((r) => r.options);
export const recordReceipt = (input: ReceiptInput) => post<{ receipt: { id: string; number: string } }>("/receipts", input).then((r) => r.receipt);
export const receiptStep = (id: string, step: "apply" | "apply-oldest" | "reverse", input: Record<string, unknown> = {}) =>
  post<{ receipt: ReceiptRecord }>(`/receipts/${id}/${step}`, input).then((r) => r.receipt);
export const undoAllocation = (allocationId: string, reason: string) => post(`/receipt-allocations/${allocationId}/undo`, { reason });

export const METHODS: Array<[string, string]> = [["bank_transfer", "Bank transfer (NEFT / RTGS / IMPS)"], ["upi", "UPI"], ["cheque", "Cheque"], ["cash", "Cash"], ["card", "Card"],
  ["gateway", "Payment gateway"], ["other", "Other"]];
export const methodLabel = (value: string) => METHODS.find(([key]) => key === value)?.[1] ?? value;
export const RECEIPT_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  posted: { label: "Not applied", tone: "warning" }, partially_applied: { label: "Partly applied", tone: "info" }, applied: { label: "Applied", tone: "success" },
  reversed: { label: "Reversed", tone: "danger" }, cancelled: { label: "Cancelled", tone: "neutral" }, draft: { label: "Draft", tone: "neutral" },
};
export const INVOICE_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  posted: { label: "Open", tone: "info" }, partially_paid: { label: "Partly paid", tone: "info" }, paid: { label: "Paid", tone: "success" }, overdue: { label: "Overdue", tone: "danger" },
  disputed: { label: "Disputed", tone: "warning" }, reversed: { label: "Reversed", tone: "neutral" }, cancelled: { label: "Cancelled", tone: "neutral" },
};
// Money in the company's format; cents-exact arithmetic for the forms.
export const inr = (value: number | string | null | undefined, currency = "INR") => {
  const n = Number(value ?? 0);
  return n.toLocaleString("en-IN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const cents = (value: string | number | null | undefined) => { const n = Number(value ?? 0); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export const fromCents = (value: number) => (value / 100).toFixed(2);
