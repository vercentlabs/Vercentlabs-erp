"use client";

// Browser client for the Customer Master routes under /api/sales/customers.
import { SalesApiError, post, request } from "@/features/sales/shared/http";

export type CustomerStatus = "active" | "inactive" | "blocked";
export type CustomerCapabilities = Record<
  | "view" | "viewTeam" | "viewAll" | "create" | "edit" | "inactivate" | "reactivate" | "block" | "unblock" | "delete" | "import" | "export"
  | "manageAddresses" | "manageContacts" | "linkAccount" | "editGstin" | "changeCurrency" | "changePaymentTerms" | "changePriceList" | "viewFinancials"
  | "viewAddresses" | "inactivateAddress" | "setDefaultBilling" | "setDefaultShipping" | "editAddressGstin" | "viewContacts" | "inactivateContact" | "setPrimaryContact", boolean>;

export type Customer = {
  id: string;
  customerNumber: string;
  accountNumber: string;
  displayName: string;
  legalName: string | null;
  customerKind: "business" | "individual";
  customerKindLabel: string;
  status: CustomerStatus;
  statusLabel: string;
  blockReason: string | null;
  blockedAt: string | null;
  blockedByName: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedByName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  countryCode: string | null;
  currencyCode: string | null;
  priceListId: string | null;
  priceListName: string | null;
  paymentTermId: string | null;
  paymentTermName: string | null;
  gstRegistrationType: string | null;
  gstRegistrationLabel: string | null;
  gstin: string | null;
  pan: string | null;
  gstStateCode: string | null;
  gstStateName: string | null;
  placeOfSupply: string | null;
  placeOfSupplyName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  notes: string | null;
  primaryContactId: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  city: string | null;
  state: string | null;
  customerSince: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
  outstanding?: number;
  overdue?: number;
  capabilities?: CustomerCapabilities;
};

export type CustomerAddress = {
  id: string;
  addressType: string;
  addressTypeLabel: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  district: string | null;
  state: string;
  stateCode: string | null;
  postalCode: string;
  countryCode: string | null;
  gstin: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  isDefaultBilling: boolean;
  isDefaultShipping: boolean;
  isActive: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
};
export type AddressInput = Partial<Omit<CustomerAddress, "id" | "addressTypeLabel" | "isActive" | "createdByName" | "createdAt" | "updatedByName" | "updatedAt">> & { allowDuplicate?: boolean };

export type CustomerContact = {
  id: string;
  contactNumber: string | null;
  name: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  role: string | null;
  roleLabel: string | null;
  email: string | null;
  phone: string | null;
  addressId: string | null;
  addressLabel: string | null;
  notes: string | null;
  isPrimary: boolean;
  isBillingContact: boolean;
  isShippingContact: boolean;
  isProcurementContact: boolean;
  isActive: boolean;
};
export type ExistingContact = {
  id: string; name: string; email: string | null; phone: string | null; jobTitle: string | null; accountName: string | null; reasons: string[];
  link: "none" | "linked" | "inactive";
};
export type ContactInput = {
  contactId?: string; firstName?: string; lastName?: string; email?: string; phone?: string; jobTitle?: string; department?: string; role?: string;
  addressId?: string | null; notes?: string; isPrimary?: boolean; isBillingContact?: boolean; isShippingContact?: boolean; isProcurementContact?: boolean;
  isActive?: boolean; allowDuplicate?: boolean; confirmOpenDocuments?: boolean;
};

export type CustomerInput = {
  displayName?: string; legalName?: string | null; customerKind?: string; status?: string; email?: string | null; phone?: string | null; website?: string | null;
  countryCode?: string; currencyCode?: string; priceListId?: string | null; paymentTermId?: string | null; gstRegistrationType?: string | null; gstin?: string | null;
  placeOfSupply?: string | null; ownerUserId?: string | null; notes?: string | null;
  billingAddress?: AddressInput | null; shippingAddress?: AddressInput | null;
  primaryContact?: { firstName: string; lastName?: string; email?: string; phone?: string; jobTitle?: string } | null;
  allowDuplicate?: boolean; duplicateReason?: string; origin?: string;
};

export type Choice = { code: string; label: string };
export type CustomerOptions = {
  kinds: Choice[];
  statuses: Choice[];
  gstRegistrationTypes: Array<Choice & { needsGstin: boolean }>;
  gstStates: Array<{ code: string; name: string }>;
  addressTypes: Choice[];
  contactRoles: Choice[];
  countries: Array<{ code: string; name: string }>;
  views: Array<{ key: string; label: string }>;
  currencies: Array<{ code: string; name: string }>;
  priceLists: Array<{ id: string; name: string; currencyCode: string | null }>;
  paymentTerms: Array<{ id: string; name: string; dueDays: number }>;
  salespeople: Array<{ id: string; name: string }>;
  defaults: { currencyCode: string | null; countryCode: string; ownerUserId: string | null };
  showsFinancials: boolean;
  canOverrideDuplicate: boolean;
  capabilities: CustomerCapabilities;
};

export type CustomerListFilters = {
  view?: string; search?: string; status?: string; customerKind?: string; ownerUserId?: string; state?: string; countryCode?: string; gstRegistrationType?: string;
  currencyCode?: string; priceListId?: string; paymentTermId?: string; createdFrom?: string; createdTo?: string; hasOutstanding?: string; hasOverdue?: string;
  sort?: string; direction?: string; limit?: number; offset?: number;
};
export type CustomerList = {
  customers: Customer[]; total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; showsFinancials: boolean; capabilities: CustomerCapabilities;
};

export type DuplicateMatch = {
  id: string; customerNumber: string | null; accountNumber: string | null; name: string | null; legalName: string | null; city: string | null; status: string | null;
  isCustomer: boolean; strength: "strong" | "possible"; reasons: Array<{ signal: string; label: string; strong: boolean }>; href: string;
};
export type DuplicateResult = { matches: DuplicateMatch[]; hasBlockingMatch: boolean; canOverride: boolean };

export type CustomerOverview = {
  access: { sales: boolean; finance: boolean; crm: boolean; projects: boolean; support: boolean; notes: boolean };
  crm: {
    accountId: string; accountNumber: string; accountName: string; ownerName: string | null;
    openOpportunities: Array<{ id: string; code: string; name: string; amount: number | null; currencyCode: string | null; expectedCloseDate: string | null; stageName: string | null; href: string }>;
  };
  sales?: { openQuotations: number; openSalesOrders: number; pendingDeliveries: number; lastOrderDate: string | null };
  finance?: {
    currencyCode: string | null; outstanding: number; overdue: number; unallocatedAdvance: number; openInvoices: number; lastPaymentDate: string | null;
    lastPaymentAmount: number | null; lastPaymentNumber: string | null; aging: Array<{ key: string; label: string; amount: number }>;
  };
};

export type RelatedRow = {
  id: string; code: string | null; title: string | null; status: string | null; detail: string | null; amount: number | null; outstanding: number | null;
  currencyCode: string | null; date: string | null; dueDate: string | null; href: string | null;
};
export type HistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };

export type AccountPrefill = {
  account: { id: string; accountNumber: string; name: string; status: string; ownerName: string | null };
  existingCustomer: { id: string; customerNumber: string; name: string } | null;
  values: CustomerInput;
  addresses: CustomerAddress[];
  primaryContact: { name: string; email: string | null; phone: string | null } | null;
};

export type ImportAnalysis = {
  fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>; suggestedMapping: Record<string, string>;
  fields: Array<{ key: string; label: string }>;
};
export type ImportKind = "customers" | "addresses" | "contacts";
export type ImportRow = { rowNumber: number; name: string | null; outcome: "created" | "updated" | "linked" | "skipped" | "review" | "failed"; message: string; customerId?: string | null; customerNumber?: string };
export type ImportResult = { dryRun: boolean; total: number; created: number; updated: number; linked?: number; skipped: number; review: number; failed: number; results: ImportRow[] };

const BASE = "/customers";
const query = (params: object) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });

export const getCustomerOptions = () => request<CustomerOptions>(`${BASE}/options`);
export const listCustomers = (filters: CustomerListFilters) => request<CustomerList>(`${BASE}${query(filters)}`);
export const customerExportUrl = (filters: CustomerListFilters) => `/api/sales${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;
export const searchCustomers = (search: string) => request<{ customers: Array<{ id: string; customerNumber: string; displayName: string; gstin: string | null; status: CustomerStatus }> }>(`${BASE}/search${query({ search })}`);
export const getCustomer = (id: string) => request<{ customer: Customer }>(`${BASE}/${id}`).then((response) => response.customer);
export const createCustomer = (input: CustomerInput) => post<{ customer: Customer }>(BASE, input).then((response) => response.customer);
export const updateCustomer = (id: string, input: CustomerInput) => patch<{ customer: Customer }>(`${BASE}/${id}`, input).then((response) => response.customer);
export const deleteCustomer = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" });
export const changeCustomerStatus = (id: string, action: "activate" | "deactivate" | "block" | "unblock", reason?: string) =>
  post<{ customer: Customer }>(`${BASE}/${id}/status`, { action, reason }).then((response) => response.customer);
export const findDuplicateCustomers = (probe: Record<string, unknown>) => post<DuplicateResult>(`${BASE}/duplicates`, probe);

export const getCustomerOverview = (id: string) => request<{ overview: CustomerOverview }>(`${BASE}/${id}/overview`).then((response) => response.overview);
export const listCustomerRelated = (id: string, list: string) => request<{ rows: RelatedRow[] }>(`${BASE}/${id}/related/${list}`).then((response) => response.rows);
export const listCustomerHistory = (id: string) => request<{ history: HistoryEntry[] }>(`${BASE}/${id}/history`).then((response) => response.history);

export const listCustomerAddresses = (id: string, search?: string) => request<{ addresses: CustomerAddress[] }>(`${BASE}/${id}/addresses${query({ search })}`).then((response) => response.addresses);
export const addCustomerAddress = (id: string, input: AddressInput) => post<{ address: CustomerAddress }>(`${BASE}/${id}/addresses`, input);
export const updateCustomerAddress = (id: string, addressId: string, input: AddressInput | { action: "default_billing" | "default_shipping" | "deactivate" | "reactivate" }) =>
  patch<{ address: CustomerAddress }>(`${BASE}/${id}/addresses/${addressId}`, input);

export const listCustomerContacts = (id: string, search?: string) => request<{ contacts: CustomerContact[] }>(`${BASE}/${id}/contacts${query({ search })}`).then((response) => response.contacts);
export const findExistingContact = (id: string, probe: { firstName?: string; lastName?: string; email?: string; phone?: string }) =>
  post<{ matches: ExistingContact[] }>(`${BASE}/${id}/contacts/existing`, probe).then((response) => response.matches);
export const addCustomerContact = (id: string, input: ContactInput) => post<{ contact: CustomerContact }>(`${BASE}/${id}/contacts`, input);
export const updateCustomerContact = (id: string, contactId: string, input: ContactInput) => patch<{ contact: CustomerContact }>(`${BASE}/${id}/contacts/${contactId}`, input);
export const searchLinkableContacts = (id: string, search: string) =>
  request<{ contacts: Array<{ id: string; name: string; email: string | null; jobTitle: string | null; accountName: string | null }> }>(`${BASE}/${id}/contacts/search${query({ search })}`).then((response) => response.contacts);

export const searchAccountsForCustomer = (search: string) =>
  request<{ accounts: Array<{ id: string; accountNumber: string; name: string; legalName: string | null; ownerName: string | null }> }>(`${BASE}/accounts${query({ search })}`).then((response) => response.accounts);
export const getAccountPrefill = (accountId: string) => request<AccountPrefill>(`${BASE}/accounts/${accountId}`);
export const createCustomerFromAccount = (accountId: string, input: CustomerInput) => post<{ customer: Customer }>(`${BASE}/accounts/${accountId}`, input).then((response) => response.customer);
export const linkCustomerToAccount = (id: string, accountId: string) => post<{ customer: Customer }>(`${BASE}/${id}/link-account`, { accountId }).then((response) => response.customer);

async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`/api/sales${path}`, { method: "POST", body: form, credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The file could not be processed.", response.status, payload.code, payload);
  return payload;
}
// Customers have their own import; addresses and contacts share one, by kind.
const importPath = (kind: ImportKind) => (kind === "customers" ? `${BASE}/import` : `${BASE}/import/${kind}`);
export const customerImportTemplateUrl = (kind: ImportKind) => `/api/sales${importPath(kind)}/template`;
export const customerRelatedExportUrl = (kind: "addresses" | "contacts", filters: CustomerListFilters) =>
  `/api/sales${BASE}/export/${kind}${query({ ...filters, limit: undefined, offset: undefined, sort: undefined, direction: undefined })}`;
export function analyzeCustomerImport(kind: ImportKind, file: File) {
  const form = new FormData();
  form.set("file", file);
  return upload<{ analysis: ImportAnalysis }>(`${importPath(kind)}/analyze`, form).then((response) => response.analysis);
}
export function importCustomers(kind: ImportKind, file: File, options: { mapping: Record<string, string>; duplicateMode: string; dryRun: boolean; countryCode?: string; currencyCode?: string }) {
  const form = new FormData();
  form.set("file", file);
  form.set("mapping", JSON.stringify(options.mapping));
  form.set("duplicateMode", options.duplicateMode);
  form.set("dryRun", String(options.dryRun));
  form.set("countryCode", options.countryCode ?? "");
  form.set("currencyCode", options.currencyCode ?? "");
  return upload<{ result: ImportResult; errorFile: string | null }>(importPath(kind), form);
}

// Error helpers. The route layer spreads error details flat into the body.
type Issue = { field: string; message: string };
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export function fieldErrors(error: unknown): Record<string, string> {
  const issues = error instanceof SalesApiError ? (error.payload?.issues as Issue[] | undefined) : undefined;
  return Object.fromEntries((issues ?? []).map((issue) => [issue.field, issue.message]));
}
export const errorPayload = (error: unknown) => (error instanceof SalesApiError ? error.payload ?? {} : {});
export function duplicateMatches(error: unknown): DuplicateResult | null {
  if (!(error instanceof SalesApiError) || !error.payload?.duplicateDetected) return null;
  return { matches: (error.payload.matches as DuplicateMatch[]) ?? [], hasBlockingMatch: true, canOverride: Boolean(error.payload.canOverride) };
}
