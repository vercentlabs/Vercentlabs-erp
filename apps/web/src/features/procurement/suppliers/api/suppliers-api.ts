"use client";

// The Supplier Master's browser client. Every rule (who may change what,
// duplicates, statuses, tax details) is the server's; these are its shapes.
import { ProcApiError, post, request } from "@/features/procurement/shared/http";

export type SupplierStatus = "active" | "inactive" | "blocked";
export type Coded = { code: string; label: string };

export type SupplierAddress = {
  id: string; addressType: string; addressTypeLabel: string; label: string | null; line1: string; line2: string | null; city: string; district: string | null; state: string | null;
  stateCode: string | null; postalCode: string | null; countryCode: string | null; gstRegistrationType: string | null; gstRegistrationLabel: string | null; gstin: string | null;
  isPrimary: boolean; status: "active" | "inactive";
};
export type SupplierContact = {
  id: string; contactId: string; contactNumber: string | null; name: string; firstName: string; lastName: string | null; designation: string | null; email: string | null;
  phone: string | null; mobile: string | null; role: string; roleLabel: string; isPrimary: boolean; status: "active" | "inactive";
};
export type Supplier = {
  id: string; supplierNumber: string; partyId: string; supplierName: string; legalName: string | null; supplierType: string; supplierTypeLabel: string; category: string;
  categoryLabel: string; status: SupplierStatus; statusLabel: string; statusReason: string | null; statusChangedAt: string | null; statusChangedByName: string | null;
  blockedReason: string | null; blockedAt: string | null; blockedByName: string | null; primaryEmail: string | null; primaryPhone: string | null; website: string | null;
  countryCode: string | null; notes: string | null; gstRegistrationType: string | null; gstRegistrationLabel: string | null; gstin: string | null; pan: string | null;
  registeredStateCode: string | null; registeredStateName: string | null; defaultCurrency: string; paymentTermId: string; paymentTermName: string | null;
  assignedBuyerId: string | null; assignedBuyerName: string | null; isCustomer: boolean; customerNumber: string | null;
  primaryAddress: { id: string; addressType: string; addressTypeLabel: string; label: string | null; line1: string; city: string; state: string | null; stateCode: string | null; postalCode: string | null; countryCode: string | null } | null;
  primaryContact: { relationshipId: string; contactId: string; name: string; email: string | null; phone: string | null; role: string; roleLabel: string } | null;
  version: number; createdAt: string; updatedAt: string;
};
export type SupplierActions = {
  edit: boolean; createPurchaseOrder: boolean; deactivate: boolean; activate: boolean; block: boolean; unblock: boolean; manageAddresses: boolean; manageContacts: boolean;
  viewPayables: boolean; viewPaymentDetails: boolean; managePaymentDetails: boolean;
};
export type SupplierDetail = { supplier: Supplier; addresses: SupplierAddress[]; contacts: SupplierContact[]; actions: SupplierActions; capabilities: Record<string, boolean> };
export type SupplierOptions = {
  baseCurrency: string | null; countryCode: string; currencies: Array<{ code: string; name: string }>;
  paymentTerms: Array<{ id: string; code: string; name: string; days: number | null }>; buyers: Array<{ id: string; name: string; email: string }>;
  types: Coded[]; categories: Coded[]; gstRegistrationTypes: Array<Coded & { needsGstin: boolean }>; addressTypes: Coded[]; contactRoles: Coded[];
  states: Array<{ code: string; name: string }>; statuses: Coded[]; views: Array<{ key: string; label: string }>; capabilities: Record<string, boolean>;
};
export type DuplicateMatch = {
  kind: "supplier" | "organization"; supplierId: string | null; partyId: string; number: string | null; name: string; legalName: string | null; gstin: string | null;
  city: string | null; status: string | null; isCustomer: boolean; strength: "strong" | "possible"; reasons: Array<{ code: string; label: string }>; canOpen: boolean;
};
export type SupplierListFilters = Partial<Record<"view" | "search" | "status" | "category" | "buyerId" | "countryCode" | "stateCode" | "currency" | "paymentTermId" | "gstRegistrationType" | "sort" | "direction", string>>;
export type HistoryEntry = { id: string; type: string; summary: string; at: string; actor: string | null };
export type PurchaseSummary = { purchaseOrders: number; openPurchaseOrders: number; lastPurchaseAt: string | null; openGoodsReceipts: number; purchaseReturns: number };
export type PayablesSummary = {
  openBills: number; overdueBills: number; amountsVisible: boolean; openPayables?: number; overduePayables?: number; unappliedCredits?: number;
  lastPayment?: { number: string; date: string; amount: number; currency: string } | null;
};
export type SupplierDocument = {
  id: string; number: string; status: string; date: string | null; href: string | null; title?: string | null; expected?: string | null; currency?: string | null; total?: number | null;
  orderNumber?: string | null; supplierInvoiceNumber?: string | null; type?: string; dueDate?: string | null; outstanding?: number | null; amount?: number; unapplied?: number;
};
export type BankAccount = {
  id: string; accountHolder: string; bankName: string; accountNumber: string | null; accountNumberMasked: string; ifscCode: string | null; swiftCode: string | null; currencyCode: string;
  isPrimary: boolean; status: "active" | "inactive"; updatedAt: string; updatedByName: string | null;
};
export type SupplierFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
export type ImportAnalysis = { fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>; suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string }> };
export type ImportResult = {
  dryRun: boolean; total: number; created: number; duplicates: number; failed: number;
  results: Array<{ rowNumber: number; name: string | null; outcome: "created" | "duplicate" | "failed"; message: string; field?: string | null; supplierId?: string; supplierNumber?: string }>;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

// Some refusals carry details the screens act on (duplicate matches, the field in error).
export class SupplierApiError extends ProcApiError {
  constructor(message: string, status: number, code: string | undefined, readonly details: Record<string, unknown>) {
    super(message, status, code);
  }
}
async function send<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/procurement${path}`, {
    credentials: "same-origin", ...init,
    // A file goes as multipart (the browser sets its boundary); everything else as JSON.
    headers: { Accept: "application/json", ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SupplierApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorCode = (error: unknown) => (error instanceof ProcApiError ? error.code : undefined);
export const duplicateMatchesOf = (error: unknown) =>
  error instanceof SupplierApiError && ["SUPPLIER_DUPLICATE", "SUPPLIER_GSTIN_TAKEN", "SUPPLIER_ORGANIZATION_EXISTS", "SUPPLIER_DUPLICATE_REASON"].includes(error.code ?? "")
    ? ((error.details.matches as DuplicateMatch[] | undefined) ?? []) : null;
export const fieldIssuesOf = (error: unknown) =>
  error instanceof SupplierApiError ? Object.fromEntries(((error.details.issues as Array<{ field: string; message: string }> | undefined) ?? []).map((issue) => [issue.field, issue.message])) : {};

export const listSuppliers = (filters: SupplierListFilters & { limit?: number; offset?: number }) =>
  request<{ rows: Supplier[]; total: number; views: Array<{ key: string; label: string }> }>(`/suppliers${qs(filters)}`);
export const getSupplierOptions = () => request<{ options: SupplierOptions }>("/suppliers/options").then((result) => result.options);
export const getSupplier = (id: string) => request<SupplierDetail>(`/suppliers/${id}`);
export const createSupplier = (input: Record<string, unknown>) => send<{ supplier: SupplierDetail }>("/suppliers", { method: "POST", body: JSON.stringify(input) }).then((result) => result.supplier);
export const updateSupplier = (id: string, input: Record<string, unknown>) => send<SupplierDetail>(`/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteSupplier = (id: string) => send<{ result: { deleted: boolean } }>(`/suppliers/${id}`, { method: "DELETE", body: "{}" });
export const checkDuplicates = (probe: Record<string, unknown>) => post<{ matches: DuplicateMatch[] }>("/suppliers/duplicates", probe).then((result) => result.matches);
export const changeSupplierStatus = (id: string, action: "activate" | "deactivate" | "block" | "unblock", input: Record<string, unknown>) =>
  send<SupplierDetail>(`/suppliers/${id}/${action}`, { method: "POST", body: JSON.stringify(input) });
export const addAddress = (id: string, input: Record<string, unknown>) => send<{ addressId: string }>(`/suppliers/${id}/addresses`, { method: "POST", body: JSON.stringify(input) });
export const updateAddress = (id: string, addressId: string, input: Record<string, unknown>) =>
  send<{ addressId: string }>(`/suppliers/${id}/addresses/${addressId}`, { method: "PATCH", body: JSON.stringify(input) });
export const addContact = (id: string, input: Record<string, unknown>) => send<{ relationshipId: string }>(`/suppliers/${id}/contacts`, { method: "POST", body: JSON.stringify(input) });
export const updateContact = (id: string, relationshipId: string, input: Record<string, unknown>) =>
  send<{ relationshipId: string }>(`/suppliers/${id}/contacts/${relationshipId}`, { method: "PATCH", body: JSON.stringify(input) });
export const getSummary = (id: string) => request<{ purchases: PurchaseSummary; payables: PayablesSummary }>(`/suppliers/${id}/summary`);
export const getDocuments = (id: string, kind: string) => request<{ documents: SupplierDocument[] }>(`/suppliers/${id}/documents/${kind}`).then((result) => result.documents);
export const getHistory = (id: string) => request<{ history: HistoryEntry[] }>(`/suppliers/${id}/history`).then((result) => result.history);
export const listFiles = (id: string) => request<{ files: SupplierFile[] }>(`/suppliers/${id}/files`).then((result) => result.files);
export const fileUrl = (id: string, fileId: string) => `/api/procurement/suppliers/${id}/files/${fileId}`;
export const removeFile = (id: string, fileId: string) => send<{ result: { removed: boolean } }>(`/suppliers/${id}/files/${fileId}`, { method: "DELETE", body: "{}" });
export async function uploadFile(id: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  return send<{ file: SupplierFile }>(`/suppliers/${id}/files`, { method: "POST", body: form }).then((result) => result.file);
}
export const exportUrl = (filters: SupplierListFilters) => `/api/procurement/suppliers/export${qs(filters)}`;
export const templateUrl = "/api/procurement/suppliers/import/template";
export async function analyzeImport(file: File) {
  const form = new FormData();
  form.set("file", file);
  return send<{ analysis: ImportAnalysis }>("/suppliers/import/analyze", { method: "POST", body: form }).then((result) => result.analysis);
}
export async function runImport(file: File, options: { mapping: Record<string, string>; dryRun: boolean; countryCode?: string; currency?: string; paymentTermId?: string; category?: string }) {
  const form = new FormData();
  form.set("file", file);
  form.set("mapping", JSON.stringify(options.mapping));
  form.set("dryRun", String(options.dryRun));
  for (const key of ["countryCode", "currency", "paymentTermId", "category"] as const) if (options[key]) form.set(key, options[key] as string);
  return send<{ result: ImportResult; errorFile: string | null }>("/suppliers/import", { method: "POST", body: form });
}

// Finance's payment details live under Accounting.
async function finance<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/accounting/suppliers${path}`, {
    credentials: "same-origin", ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SupplierApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
export const listPaymentDetails = (id: string) => finance<{ accounts: BankAccount[]; canManage: boolean }>(`/${id}/payment-details`);
export const addBankAccount = (id: string, input: Record<string, unknown>) => finance<{ accountId: string }>(`/${id}/payment-details`, { method: "POST", body: JSON.stringify(input) });
export const updateBankAccount = (id: string, accountId: string, input: Record<string, unknown>) =>
  finance<{ accountId: string }>(`/${id}/payment-details/${accountId}`, { method: "PATCH", body: JSON.stringify(input) });

