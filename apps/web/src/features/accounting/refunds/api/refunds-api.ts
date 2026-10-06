"use client";

import { AccountingApiError } from "@/features/accounting/shared/client";

// Shapes returned by Finance's Customer Refunds (services/api/src/modules/
// accounting/refunds). A refund pays a customer back out of one credit
// source: what is left on a posted credit note, or unapplied on a receipt.
export type RefundStatusKey = "draft" | "posted" | "reversed" | "cancelled";
export type RefundSourceType = "credit_note" | "receipt";
type Choice = { code: string; label: string };
type Check = { code: string; message: string; field?: string };
export type RefundAccount = { id: string; code: string; bank_name: string; account_name: string; masked_account_number: string | null; account_type: string; currency_code: string };
export type RefundEvent = { id: string; event_type: string; from_status: string | null; to_status: string | null; metadata: Record<string, unknown> | null; occurred_at: string; actor_name: string | null };

export type RefundRow = {
  id: string;
  refund_number: string;
  status: RefundStatusKey;
  statusLabel: string;
  refund_date: string;
  amount: number;
  currency_code: string;
  party_id: string;
  customer_name: string;
  customer_number: string | null;
  reason_code: string;
  reasonLabel: string;
  payment_method: string;
  paymentMethodLabel: string;
  bank_account_id: string | null;
  bank_account_name: string | null;
  external_reference: string | null;
  sent_at: string | null;
  source_type: RefundSourceType;
  source_id: string;
  source_number: string;
  sourceLabel: string;
};
export type RefundList = {
  rows: RefundRow[]; total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; reasons: Choice[]; methods: Choice[]; accounts: RefundAccount[];
  capabilities: Record<string, boolean>;
};

export type RefundActions = Record<"edit" | "selectAccount" | "post" | "cancel" | "reverse" | "print" | "send" | "markSent" | "viewAccounting" | "viewCredit" | "applyCredit", boolean>;
export type RefundDetail = {
  refund: {
    id: string;
    refund_number: string;
    status: RefundStatusKey;
    statusLabel: string;
    version: number;
    party_id: string;
    customer_name: string;
    customer_number: string | null;
    customer_email: string | null;
    refund_date: string;
    accounting_date: string;
    currency_code: string;
    amount: string;
    reason_code: string;
    reasonLabel: string;
    reason_note: string | null;
    payment_method: string;
    paymentMethodLabel: string;
    bank_account_id: string | null;
    bank_account_name: string | null;
    bank_name: string | null;
    masked_account_number: string | null;
    external_reference: string | null;
    customer_notes: string | null;
    internal_notes: string | null;
    sent: boolean;
    sentLabel: string;
    sent_at: string | null;
    sent_to: string | null;
    sent_by_name: string | null;
    created_at: string;
    created_by_name: string | null;
    posted_at: string | null;
    posted_by_name: string | null;
    reversed_at: string | null;
    reversed_by_name: string | null;
    reversal_reason: string | null;
    cancelled_at: string | null;
    cancelled_by_name: string | null;
    cancel_reason: string | null;
    journal_entry_id: string | null;
    journal_entry_number: string | null;
    reversal_entry_number: string | null;
  };
  source: {
    type: RefundSourceType; typeLabel: string; id: string; number: string; date: string; currencyCode: string; status: string; fromSales: boolean;
    total: number | null; applied: number | null; refunded: number | null; available: number | null;
  };
  otherRefunds: Array<{ id: string; refund_number: string; status: RefundStatusKey; statusLabel: string; refund_date: string; amount: number }>;
  related: {
    invoice: { id: string; number: string; fromSales: boolean } | null;
    salesOrder: { id: string; number: string } | null;
    salesReturn: { id: string; number: string } | null;
  };
  sends: Array<{ id: string; channel: string; recipients: string | null; subject: string | null; note: string | null; sent_at: string; sent_by_name: string | null }>;
  events: RefundEvent[];
  problems: Check[];
  warnings: Check[];
  accounts: RefundAccount[];
  reasons: Choice[];
  methods: Choice[];
  sentChannels: Choice[];
  actions: RefundActions;
};

export type CreditSource = {
  sourceType: RefundSourceType; sourceId: string; number: string; label: string; date: string; currencyCode: string; total: number; applied: number; refunded: number; available: number;
  onDraftRefunds: number; reference: string | null; fromSales: boolean;
};
export type CustomerCredit = {
  customer: { id: string; name: string; customerNumber: string | null; currencyCode: string | null };
  available: Array<{ currencyCode: string; amount: number }>;
  owed: Array<{ currencyCode: string; amount: number; invoices: number }>;
  sources: CreditSource[];
};
export type RefundPostingCheck = { ready: boolean; problems: Check[]; warnings: Check[] };
export type RefundFilters = {
  view?: string; search?: string; status?: string; partyId?: string; paymentMethod?: string; bankAccountId?: string; currencyCode?: string; reasonCode?: string; creditNoteId?: string;
  receiptId?: string; dateFrom?: string; dateTo?: string; sort?: string; direction?: string; limit?: number; offset?: number;
};
export type RefundFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
export type RefundDraftInput = {
  amount?: number; refundDate?: string; reasonCode?: string; reasonNote?: string | null; paymentMethod?: string; bankAccountId?: string | null; externalReference?: string | null;
  customerNotes?: string | null; internalNotes?: string | null;
};

const BASE = "/api/accounting/customer-refunds";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload as T;
}
const post = <T>(path: string, body?: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const qs = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};

export const listRefunds = (filters: RefundFilters) => call<RefundList>(qs(filters));
export const getRefund = (id: string) => call<{ refund: RefundDetail }>(`/${id}`);
export const getCustomerCredit = (partyId: string) => call<{ credit: CustomerCredit }>(`/sources${qs({ partyId })}`);
export const createRefund = (input: RefundDraftInput & { idempotencyKey: string; sourceType: RefundSourceType; sourceId: string; amount: number }) =>
  post<{ result: { refundId: string; refundNumber: string; warnings: Check[] } }>("", input);
export const updateRefund = (id: string, input: RefundDraftInput & { expectedVersion?: number }) =>
  call<{ result: { version: number; changed: boolean } }>(`/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const validateRefund = (id: string) => call<{ check: RefundPostingCheck }>(`/${id}/validate`);
export const postRefund = (id: string, input: { expectedVersion?: number; bankAccountId?: string; paymentMethod?: string; externalReference?: string; refundDate?: string }) =>
  post<{ result: { refundNumber: string; status: RefundStatusKey; creditLeft?: number; replayed: boolean } }>(`/${id}/post`, input);
export const cancelRefund = (id: string, reason?: string) => post<{ result: unknown }>(`/${id}/cancel`, { reason });
export const reverseRefund = (id: string, reason: string) => post<{ result: { creditRestored?: number } }>(`/${id}/reverse`, { reason });
export const sendRefund = (id: string, input: { to: string; cc?: string; subject?: string; message?: string; idempotencyKey: string }) => post<{ result: { sentTo: string } }>(`/${id}/send`, input);
export const markRefundSent = (id: string, input: { channel: string; recipient?: string; note?: string; idempotencyKey?: string }) => post<{ result: unknown }>(`/${id}/mark-sent`, input);
export const refundVoucherUrl = (id: string, inline = false) => `/api/documents/accounting.customer_refund/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const listRefundFiles = (id: string) => call<{ files: RefundFile[] }>(`/${id}/files`);
export const refundFileUrl = (id: string, fileId: string) => `${BASE}/${id}/files/${fileId}`;
export const uploadRefundFile = (id: string, file: File) => {
  // Multipart, so the browser sets the content type and boundary itself.
  const body = new FormData();
  body.set("file", file);
  return call<{ file: RefundFile }>(`/${id}/files`, { method: "POST", body });
};
export const removeRefundFile = (id: string, fileId: string) => call<{ result: { removed: boolean } }>(`/${id}/files/${fileId}`, { method: "DELETE" });
