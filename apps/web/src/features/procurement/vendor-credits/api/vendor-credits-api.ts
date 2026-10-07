"use client";

// Debit Notes & Vendor Credits: the shapes the screens read and the calls they make. Amounts and quantities are the server's decimal strings.
import { ProcApiError } from "@/features/procurement/shared/http";

export class CreditApiError extends ProcApiError {
  constructor(message: string, status: number, code: string | undefined, readonly details: Record<string, unknown>) {
    super(message, status, code);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/procurement${path}`, {
    credentials: "same-origin", ...init,
    headers: { Accept: "application/json", ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new CreditApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const get = <T>(path: string) => call<T>(path);
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const issuesOf = (error: unknown): string[] => {
  if (!(error instanceof CreditApiError)) return [];
  const issues = (error.details.issues ?? (error.details.details as Record<string, unknown> | undefined)?.issues) as Array<{ message: string }> | undefined;
  return (issues ?? []).map((issue) => issue.message);
};

export type Choice = { code: string; label: string };
export type ListRow = {
  id: string; kind: "claim" | "credit"; number: string; status: string; statusLabel: string; settlementStatus: string | null; settlementLabel: string | null; supplierId: string;
  supplierName: string | null; originLabel: string; supplierCreditNoteNumber: string | null; date: string; currencyCode: string; reason: string | null; total: string;
  accepted?: string; disputed?: string; available: string | null; href: string;
};

export type CreditOptions = {
  reasons: Choice[]; origins: Choice[]; taxTreatments: Choice[]; views: Array<{ key: string; label: string }>;
  permissions: Record<"claimsManage" | "claimsRespond" | "creditsManage" | "exceptional" | "post" | "settle", boolean>;
  suppliers: Array<{ id: string; number: string; name: string }>;
  bankAccounts: Array<{ id: string; name: string; currencyCode?: string }>;
  supplier?: { id: string; name: string; currencyCode: string | null };
  bills: Array<{ id: string; number: string; supplierInvoice: string | null; date: string; currencyCode: string; total: string; outstanding: string;
    lines: Array<{ id: string; sequence: number; description: string; quantity: string; unitPrice: string; taxable: string; tax: string; reverseCharge: boolean; openQuantity: string;
      openTaxable: string }> }>;
  returns: Array<{ id: string; number: string; date: string; lines: Array<{ returnId: string; lineId: string; lineNumber: number; description: string; returned: string; billed: string; open: string }> }>;
  claims: Array<{ id: string; number: string; accepted: string; remaining: string; currencyCode: string }>;
};

export type ClaimView = {
  id: string; claimNumber: string; status: string; statusLabel: string; supplierId: string; supplierName: string | null;
  supplier: { supplierName?: string; legalName?: string; gstin?: string | null; supplierNumber?: string } | null; currencyCode: string; issueDate: string; reason: string;
  claimedAmount: string; acceptedAmount: string; disputedAmount: string; supplierReference: string | null; purchaseReturnId: string | null; notes: string | null; issuedAt: string | null;
  closedAt: string | null; closeReason: string | null; version: number; creditedAmount: string; creditPending: string; remainingToCredit: string;
};
export type ClaimLine = {
  id: string; lineNumber: number; billId: string | null; billNumber: string | null; billLineId: string | null; billLineSequence: number | null; purchaseReturnLineId: string | null;
  reason: string; reasonLabel: string; description: string; basis: "quantity" | "amount"; quantity: string | null; unitValue: string | null; amount: string; taxAmount: string; total: string;
  notes: string | null;
};
export type ClaimDetail = {
  claim: ClaimView; lines: ClaimLine[];
  responses: Array<{ id: string; decision: string; acceptedAmount: string; disputedAmount: string; supplierReference: string | null; respondedOn: string | null; notes: string | null;
    recordedBy: string | null; recordedAt: string }>;
  credits: Array<{ id: string; number: string; status: string; total: string; date: string; href: string }>;
  history: Array<{ id: string; type: string; summary: string; actor: string | null; at: string }>;
  actions: Record<"edit" | "issue" | "respond" | "createCredit" | "close" | "pdf", boolean>;
};

export type CreditView = {
  id: string; number: string; status: string; statusLabel: string; settlementStatus: string; settlementLabel: string; supplierId: string; supplierName: string | null;
  origin: string | null; originLabel: string; supplierCreditNoteNumber: string | null; supplierCreditNoteDate: string | null; date: string; postingDate: string; currencyCode: string;
  taxTreatment: string; taxTreatmentLabel: string; reason: string | null; taxable: string; tax: string; withholding: string; total: string; available: string; settled: string;
  applied: string; refunded: string; authorizationReason: string | null; notes: string | null; debitClaimId: string | null; claim: { id: string; number: string; status: string; href: string } | null;
  supplier: { legalName?: string; displayName?: string; gstin?: string } | null; placeOfSupply: string | null; cancelReason: string | null; reversalReason: string | null; postedAt: string | null;
};
export type CreditLine = {
  id: string; sequence: number; description: string; reason: string | null; reasonLabel: string | null; basis: "quantity" | "amount"; quantity: string; unitPrice: string; taxable: string;
  tax: string; withholding: string; total: string; hsnSac: string | null; billId: string | null; billNumber: string | null; billLineId: string | null; purchaseReturnLineId: string | null; billLineSequence: number | null; billedQuantity: string | null;
  billedTaxable: string | null; returnId: string | null; returnNumber: string | null; returnLineNumber: number | null;
  components: Array<{ taxType: string; label: string; rate: string; taxable: string; amount: string }>;
};
type Journal = { id: string; number: string; status: string; date: string; lines: Array<{ account: string; description: string; debit: string; credit: string }> } | null;
export type CreditDetail = {
  credit: CreditView; lines: CreditLine[];
  sourceBills: Array<{ id: string; number: string; supplierInvoice: string | null; date: string; total: string; outstanding: string; status: string; creditedHere: string; href: string }>;
  sourceReturns: Array<{ id: string; number: string; date: string; quantity: string; href: string }>;
  allocations: Array<{ billId: string; billNumber: string; supplierInvoice: string | null; amount: string; billOutstanding: string; at: string; href: string }>;
  refunds: Array<{ id: string; refundNumber: string; amount: string; date: string; bankName: string | null; reference: string | null; status: string; reversedAt: string | null; reversalReason: string | null }>;
  openBills: Array<{ id: string; number: string; supplierInvoice: string | null; date: string; dueDate: string | null; outstanding: string }>;
  accounting: { journal: Journal; reversal: Journal };
  history: Array<{ type: string; from: string | null; to: string | null; details: Record<string, unknown>; actor: string | null; at: string }>;
  actions: Record<"edit" | "post" | "approve" | "cancel" | "allocate" | "refund" | "unapply" | "reverse" | "reverseRefund" | "pdf", boolean>;
};
export type CreditPreview = {
  currencyCode: string; taxTreatment: string; warnings: string[]; totals: { taxable: string; tax: string; withholding: string; total: string };
  lines: Array<{ description: string; billNumber: string | null; basis: string; quantity: string; taxable: string; tax: string; withholding: string; components: Array<{ label: string; rate: string; amount: string }> }>;
};

// ---------------------------------------------------------------- calls

export const listDebitNotesAndCredits = (filters: Record<string, string | undefined>) => get<{ rows: ListRow[]; views: Array<{ key: string; label: string }> }>(`/vendor-credits${qs(filters)}`);
export const getCreditOptions = (supplierId?: string | null, excludeCreditId?: string | null) =>
  get<CreditOptions>(`/vendor-credits/options${qs({ supplierId: supplierId ?? undefined, excludeCreditId: excludeCreditId ?? undefined })}`);
export const getCredit = (id: string) => get<CreditDetail>(`/vendor-credits/${id}`);
export const createCredit = (input: Record<string, unknown>) => post<{ result: { id: string; creditNumber: string; status: string; total: string; warnings: string[] } }>("/vendor-credits", input)
  .then((payload) => payload.result);
export const updateCredit = (id: string, input: Record<string, unknown>) => patch<{ result: { id: string; total: string; warnings: string[] } }>(`/vendor-credits/${id}`, input).then((payload) => payload.result);
export const previewCredit = (input: Record<string, unknown>) => post<CreditPreview>("/vendor-credits/preview", input);
export const creditAction = (id: string, action: "validate" | "post" | "approve" | "cancel" | "reverse" | "allocate" | "unapply" | "refunds", input: Record<string, unknown> = {}) =>
  post<{ result: Record<string, unknown> }>(`/vendor-credits/${id}/${action}`, input).then((payload) => payload.result);
export const reverseRefund = (refundId: string, reason: string) => post<{ result: Record<string, unknown> }>(`/vendor-credits/refunds/${refundId}/reverse`, { reason }).then((payload) => payload.result);
export const checkDuplicateCreditNote = (supplierId: string, number: string, excludeCreditId?: string) =>
  get<{ duplicate: boolean; existing: { id: string; number: string } | null }>(`/vendor-credits/duplicate-check${qs({ supplierId, number, excludeCreditId })}`);

export const getClaim = (id: string) => get<ClaimDetail>(`/debit-claims/${id}`);
export const createClaim = (input: Record<string, unknown>) => post<{ result: { id: string; claimNumber: string; status: string } }>("/debit-claims", input).then((payload) => payload.result);
export const updateClaim = (id: string, input: Record<string, unknown>) => patch<{ result: { id: string } }>(`/debit-claims/${id}`, input).then((payload) => payload.result);
export const claimAction = (id: string, action: "issue" | "respond" | "close", input: Record<string, unknown> = {}) =>
  post<{ result: Record<string, unknown> }>(`/debit-claims/${id}/${action}`, input).then((payload) => payload.result);

export const claimPdfUrl = (id: string, inline = false) => `/api/documents/procurement.debit_claim/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const creditVoucherUrl = (id: string, inline = false) => `/api/documents/procurement.vendor_credit/${id}/pdf${inline ? "?disposition=inline" : ""}`;
