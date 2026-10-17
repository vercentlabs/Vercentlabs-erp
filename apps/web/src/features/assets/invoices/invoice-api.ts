"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/invoice-sources and /api/assets/invoice-registrations: creating assets from a supplier invoice.
export const INVOICES_BASE = "/assets/capitalization/invoices";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T,>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Issue = { code: string; message: string };
export type EligibleInvoice = { invoiceId: string; number: string; supplierInvoice: string | null; date: string | null; supplier: string | null; status: string; total?: string | null; currency: string;
  quantity: number; registered: number; remaining: number; href: string };
export type InvoiceLine = { sourceLineId: string; sequence: number; description: string; kind: string; kindLabel: string; uom: string | null; invoiced: number; received: number | null; returned: number;
  receiptRequired: boolean; registered: number; remaining: number; suggested: boolean; eligible: boolean; reason: string | null; code: string | null; serviceReview: boolean;
  purchaseOrder: { id: string; number: string; line: number } | null; unitPrice?: string; lineDiscount?: string; invoiceDiscount?: string; net?: string; tax?: string; unitNet?: string | null };
export type LinkedAsset = { assetId: string; asset: string; serialNumber: string | null; lifecycle: string; sourceLineId: string; line: string; via: string; cost?: string | null; outcome: string; outcomeLabel: string; href: string };
export type Batch = { id: string; number: string; invoice: string; invoiceId: string; status: string; statusLabel: string; assetsCreated: number; failedLines: number; requestedBy: string | null; at: string; href: string };
export type InvoiceSource = { invoiceId: string; number: string; supplierInvoice: string | null; supplier: string | null; date: string | null; status: string; currency: string; exchangeRate?: string; total?: string | null;
  tax?: string | null; discount?: string | null; eligible: boolean; block: string | null; billHref: string; lines: InvoiceLine[]; assets: LinkedAsset[]; batches: Batch[];
  can: { create: boolean; bulk: boolean; cost: boolean; requestCapitalization: boolean }; note: string };
export type Preview = { invoiceId: string; invoice: string; eligible: boolean; block: string | null; ready: boolean;
  lines: Array<{ index: number; sourceLineId: string; description: string; quantity: number; remainingUnits: number; remainingAfter: number; unitCost?: string; allocation?: string; errors: Issue[]; warnings: Issue[] }> };
export type BatchResult = { batchId: string; number: string; invoiceId: string; status: string; assetsCreated: number; code?: string; replayed?: boolean;
  lines: Array<{ sourceLineId: string; description: string; requested: number; registered: number; status: string; errors: Issue[]; assets: string[] }>;
  assets: Array<{ assetId: string; assetNumber: string; sourceLineId: string; outcome: string; note: string | null }> };
export type BatchDetail = BatchResult & { invoice: string; statusLabel: string; invoiceHref: string; createdAt: string; completedAt: string | null;
  assetsNow: Array<{ assetId: string; asset: string; serialNumber: string | null; lifecycle: string; outcome: string; outcomeLabel: string; href: string }> };

export const getEligibleInvoices = (search = "") => call<{ rows: EligibleInvoice[] }>(`/invoice-sources${qs({ search })}`).then((r) => r.rows);
export const getInvoiceSource = (id: string) => call<InvoiceSource>(`/invoice-sources/${id}`);
export const getBatches = () => call<{ rows: Batch[] }>("/invoice-registrations").then((r) => r.rows);
export const getBatch = (id: string) => call<BatchDetail>(`/invoice-registrations/${id}`);
export const previewRegistration = (input: Record<string, unknown>) => send<Preview>("/invoice-registrations/preview", input);
export const createRegistration = (input: Record<string, unknown>) => send<BatchResult>("/invoice-registrations", input);
export const batchExportHref = (id: string) => `/api/assets/invoice-registrations/${id}/export`;
export const OUTCOME_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { REGISTERED_COST_PENDING: "warning", REGISTERED_CAPITALIZATION_PENDING: "info", REGISTERED_CAPITALIZATION_CONFIRMED: "success", TRACKED_ONLY: "neutral" };
