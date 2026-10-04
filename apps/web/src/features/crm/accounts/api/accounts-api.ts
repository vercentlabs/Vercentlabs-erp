"use client";

// Browser client for the account routes under /api/crm/accounts. One
// function per account operation; a failed request throws AccountApiError
// carrying the server's message, code and (for duplicates) the matches.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class AccountApiError extends CrmApiErrorWithBody {}

const { request, parseResponse } = crmApiClient(AccountApiError, "body");

export type AccountType = "prospect" | "customer" | "partner" | "other";
export type AccountStatus = "active" | "inactive" | "archived";
export type AccountViewKey = "all" | "mine" | "team" | "prospects" | "customers" | "active" | "inactive" | "recently_created" | "recently_updated" | "archived";
export type AccountRelatedList = "leads" | "opportunities" | "quotations" | "orders" | "returns" | "invoices" | "payments" | "projects" | "tickets";

export type AccountTag = { id: string; name: string; color: string };

export type Account = {
  id: string;
  code: string;
  displayName: string;
  legalName: string | null;
  accountType: AccountType;
  status: AccountStatus;
  partyType: string;
  industry: string | null;
  website: string | null;
  email?: string | null;
  phone?: string | null;
  secondaryPhone?: string | null;
  employeeRange: string | null;
  annualRevenue: number | null;
  currencyCode: string | null;
  description: string | null;
  tags: AccountTag[];
  ownerUserId: string | null;
  ownerName: string | null;
  teamId: string | null;
  teamName: string | null;
  assignedAt: string | null;
  sourceId: string | null;
  sourceName: string | null;
  sourceDetail: string | null;
  parentPartyId: string | null;
  parentName: string | null;
  customerNumber: string | null;
  customerSince: string | null;
  isCustomer: boolean;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  contactCount: number;
  openOpportunities: number;
  openPipelineValue: number;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
  archivedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
  sensitiveDataRestricted?: boolean;
};

export type AccountCapabilities = Record<
  "view" | "viewAll" | "viewSensitive" | "create" | "edit" | "archive" | "delete" | "assign" | "reassign" | "merge" | "import" | "export" | "createCustomer",
  boolean
>;

type CodeLabel = { code: string; label: string };

export type AccountOptions = {
  views: Array<{ key: AccountViewKey; label: string }>;
  types: Array<{ code: AccountType; label: string }>;
  statuses: Array<{ code: AccountStatus; label: string }>;
  employeeRanges: string[];
  addressTypes: CodeLabel[];
  activityTypes: CodeLabel[];
  followUpTypes: string[];
  relatedLists: AccountRelatedList[];
  sources: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  users: Array<{ id: string; name: string; email: string }>;
  teams: Array<{ id: string; name: string }>;
  tags: AccountTag[];
  industries: string[];
  paymentTerms: Array<{ id: string; code: string; name: string; dueDays: number }>;
  currencies: string[];
  baseCurrency: string;
  currentUserId: string;
  capabilities: AccountCapabilities;
  moduleAccess: { sales: boolean; finance: boolean; projects: boolean; support: boolean };
};

export type AccountListFilters = {
  view?: AccountViewKey;
  search?: string;
  accountType?: string;
  status?: string;
  industry?: string;
  sourceId?: string;
  teamId?: string;
  ownerId?: string;
  countryCode?: string;
  state?: string;
  createdFrom?: string;
  createdTo?: string;
  lastActivityBefore?: string;
  hasOpenOpportunity?: string;
  isCustomer?: string;
  tagId?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type AccountDuplicateMatch = {
  id: string;
  signals: string[];
  strength: "exact" | "possible";
  matchStrength?: "strong" | "possible";
  score?: number;
  reasons?: Array<{ signal: string; label: string; strong: boolean }>;
  isArchived?: boolean;
  isInactive?: boolean;
  canOpen: boolean;
  code?: string;
  name?: string;
  legalName?: string | null;
  website?: string | null;
  city?: string | null;
  accountType?: AccountType;
  status?: AccountStatus;
  customerNumber?: string | null;
  ownerName?: string | null;
};

export type AccountBulkResult = { results: Array<{ partyId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };

export type AccountAddress = {
  id: string;
  addressType: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  stateCode: string | null;
  postalCode: string;
  countryCode: string | null;
  isDefaultBilling: boolean;
  isDefaultShipping: boolean;
  status: string;
};

export type AccountContact = {
  id: string;
  name: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
  isDecisionMaker: boolean;
  status: string;
};

export type AccountActivity = {
  id: string;
  source: "account" | "contact" | "opportunity";
  sourceId: string;
  type: string;
  subject: string;
  notes: string | null;
  status: string;
  priority: string;
  outcome: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  channel: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  createdByName: string | null;
  contactId: string | null;
  contactName: string | null;
  opportunityName: string | null;
};

export type AccountHistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };

export type AccountSummary = {
  access: { sales: boolean; finance: boolean; projects: boolean; support: boolean };
  crm: {
    openOpportunities: number; openPipelineValue: number; wonOpportunities: number; wonValue: number; contacts: number; convertedLeads: number;
    openTasks: number; lastActivityAt: string | null; nextFollowUpAt: string | null;
  };
  sales?: { openQuotations: number; openQuotationValue: number; orders: number; orderValue: number; lastOrderDate: string | null };
  finance?: { invoiced: number; outstanding: number; overdue: number; lastPaymentDate: string | null };
  projects?: { active: number; total: number };
  support?: { openTickets: number; total: number };
};

export type AccountRelatedRow = {
  id: string;
  code: string | null;
  title: string | null;
  status: string | null;
  stage: string | null;
  kind: string | null;
  priority: string | null;
  paymentStatus: string | null;
  amount: number | null;
  outstanding: number | null;
  currencyCode: string | null;
  percentComplete: number | null;
  date: string | null;
  dueDate: string | null;
  ownerName: string | null;
  href: string | null;
};

export type AccountHierarchy = {
  parents: Array<{ id: string; code: string; name: string }>;
  children: Array<{ id: string; code: string; name: string; accountType: AccountType; status: AccountStatus; ownerName: string | null }>;
};

export type AccountMergePreview = { keep: Account; duplicate: Account; fields: string[]; moves: Record<string, number>; blockers: string[] };

export type AccountListSummary = {
  total: number; active: number; prospects: number; customers: number; withOpenOpportunities: number; openPipelineValue: number;
  withoutRecentActivity: number; unassigned: number; staleDays: number;
};

export type AccountReportRow = {
  group: string; total: number; prospects: number; customers: number; newLast30Days: number; withOpenOpportunities: number;
  openPipelineValue: number; withoutRecentActivity: number;
};
export type AccountReport = { groupBy: string; groupLabel: string; staleDays: number; rows: AccountReportRow[]; totals: Omit<AccountReportRow, "group"> };

export type AccountImportAnalysis = {
  fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string }>;
};
export type AccountImportResult = {
  total: number; created: number; failed: number; duplicates: number;
  errors: Array<{ row: number; message: string; duplicate?: boolean }>; errorCsv: string | null;
};

export type CustomerReadiness = { account: Account; ready: boolean; missing: string[] };
export type LinkableCustomer = { id: string; code: string; customerNumber: string | null; name: string; gstin: string | null };

const BASE = "/api/crm/accounts";

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const post = <T>(url: string, json: unknown = {}) => request<T>(url, { method: "POST", json });
type Changed = { changed: boolean };

// ---- options, list, record
export const getAccountOptions = () => request<{ options: AccountOptions }>(`${BASE}/options`).then((result) => result.options);
export const listAccounts = (filters: AccountListFilters = {}) =>
  request<{ rows: Account[]; total: number; limit: number; offset: number; capabilities: AccountCapabilities }>(`${BASE}${query(filters)}`);
export const getAccountListSummary = (filters: AccountListFilters = {}) =>
  request<{ summary: AccountListSummary }>(`${BASE}/summary${query({ ...filters, limit: undefined, offset: undefined })}`).then((result) => result.summary);
export const getAccount = (id: string) => request<{ record: Account }>(`${BASE}/${id}`).then((result) => result.record);
export const createAccount = (input: Record<string, unknown>) => post<{ record: Account }>(BASE, input).then((result) => result.record);
export const updateAccount = (id: string, input: Record<string, unknown>) =>
  request<{ record: Account }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.record);
export const deleteAccount = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" });
export const setAccountStatus = (id: string, status: AccountStatus, note?: string) => post<Changed>(`${BASE}/${id}/status`, { status, note });
export const assignAccount = (id: string, input: { ownerUserId?: string | null; teamId?: string | null }) => post<Changed>(`${BASE}/${id}/assign`, input);
export const bulkAccountAction = (input: { action: "assign" | "status"; partyIds: string[] } & Record<string, unknown>) => post<AccountBulkResult>(`${BASE}/bulk`, input);
export const checkAccountDuplicates = (input: Record<string, unknown>) =>
  post<{ matches: AccountDuplicateMatch[]; hasBlockingMatch: boolean }>(`${BASE}/duplicates`, input);

// ---- hierarchy, merge, customer
export const getAccountHierarchy = (id: string) => request<{ hierarchy: AccountHierarchy }>(`${BASE}/${id}/hierarchy`).then((result) => result.hierarchy);
export const setAccountParent = (id: string, parentPartyId: string | null) =>
  request<Changed>(`${BASE}/${id}/hierarchy`, { method: "PUT", json: { parentPartyId } });
export const previewAccountMerge = (keepId: string, duplicateId: string) =>
  request<{ preview: AccountMergePreview }>(`${BASE}/merge${query({ keepId, duplicateId })}`).then((result) => result.preview);
export const mergeAccounts = (input: { keepId: string; duplicateId: string; choices: Record<string, "keep" | "duplicate"> }) =>
  post<{ merge: { keptAccountId: string; mergedAccountId: string } }>(`${BASE}/merge`, input).then((result) => result.merge);
export const getCustomerReadiness = (id: string) => request<{ readiness: CustomerReadiness }>(`${BASE}/${id}/customer`).then((result) => result.readiness);
export const searchLinkableCustomers = (id: string, search: string) =>
  request<{ customers: LinkableCustomer[] }>(`${BASE}/${id}/customer?search=${encodeURIComponent(search)}`).then((result) => result.customers);
export const createCustomer = (id: string, input: Record<string, unknown>) => post<{ record: Account }>(`${BASE}/${id}/customer`, input).then((result) => result.record);
export const linkCustomer = (id: string, linkCustomerId: string) =>
  post<{ link: { keptAccountId: string } }>(`${BASE}/${id}/customer`, { linkCustomerId }).then((result) => result.link);

// ---- addresses and contacts
export const listAccountAddresses = (id: string) => request<{ addresses: AccountAddress[] }>(`${BASE}/${id}/addresses`).then((result) => result.addresses);
export const addAccountAddress = (id: string, input: Record<string, unknown>) => post<{ address: AccountAddress }>(`${BASE}/${id}/addresses`, input);
export const updateAccountAddress = (id: string, addressId: string, input: Record<string, unknown>) =>
  request<{ address: AccountAddress }>(`${BASE}/${id}/addresses/${addressId}`, { method: "PATCH", json: input });
export const removeAccountAddress = (id: string, addressId: string) => request<Changed>(`${BASE}/${id}/addresses/${addressId}`, { method: "DELETE" });
export const listAccountContacts = (id: string) => request<{ contacts: AccountContact[] }>(`${BASE}/${id}/contacts`).then((result) => result.contacts);
export const searchLinkableContacts = (id: string, search: string) =>
  request<{ contacts: Array<{ id: string; name: string; jobTitle: string | null; accountName: string | null }> }>(`${BASE}/${id}/contacts?linkable=${encodeURIComponent(search)}`)
    .then((result) => result.contacts);
export const createAccountContact = (id: string, input: Record<string, unknown>) => post<{ contact: { id: string } }>(`${BASE}/${id}/contacts`, input);
export const linkAccountContact = (id: string, contactId: string) => post<Changed>(`${BASE}/${id}/contacts`, { contactId });
export const updateAccountContact = (id: string, contactId: string, input: { department?: string | null; isDecisionMaker?: boolean; isPrimary?: boolean }) =>
  request<Changed>(`${BASE}/${id}/contacts/${contactId}`, { method: "PATCH", json: input });
export const unlinkAccountContact = (id: string, contactId: string) => request<Changed>(`${BASE}/${id}/contacts/${contactId}`, { method: "DELETE" });

// ---- work, 360 and history
export const listAccountActivities = (id: string) => request<{ activities: AccountActivity[] }>(`${BASE}/${id}/activities`).then((result) => result.activities);
export const logAccountActivity = (id: string, input: Record<string, unknown>) => post<{ activityId: string; followUpId: string | null }>(`${BASE}/${id}/activities`, input);
export const scheduleAccountFollowUp = (id: string, input: Record<string, unknown>) => post<{ followUp: { id: string } }>(`${BASE}/${id}/follow-ups`, input);
export const listAccountHistory = (id: string) => request<{ history: AccountHistoryEntry[] }>(`${BASE}/${id}/history`).then((result) => result.history);
export const getAccountSummary = (id: string) => request<{ summary: AccountSummary }>(`${BASE}/${id}/summary`).then((result) => result.summary);
export const listAccountRelated = (id: string, list: AccountRelatedList) =>
  request<{ rows: AccountRelatedRow[] }>(`${BASE}/${id}/related/${list}`).then((result) => result.rows);

// ---- report, import and export
export const getAccountReport = (filters: Record<string, string>) => request<{ report: AccountReport }>(`${BASE}/report${query(filters)}`).then((result) => result.report);
export const accountImportTemplateUrl = `${BASE}/import/template`;
export const accountExportUrl = (filters: AccountListFilters & { ids?: string }) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;

async function upload<T>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return parseResponse<T>(await fetch(url, { method: "POST", body: form }));
}

export const analyzeAccountImport = (file: File) => upload<{ analysis: AccountImportAnalysis }>(`${BASE}/import/analyze`, file).then((result) => result.analysis);
export const importAccounts = (file: File, options: { mapping: Record<string, string>; defaultSourceId?: string; defaultOwnerUserId?: string; skipDuplicates: boolean }) =>
  upload<{ result: AccountImportResult }>(`${BASE}/import`, file, {
    mapping: JSON.stringify(options.mapping),
    defaultSourceId: options.defaultSourceId ?? "",
    defaultOwnerUserId: options.defaultOwnerUserId ?? "",
    skipDuplicates: String(options.skipDuplicates),
  }).then((result) => result.result);

// The duplicate matches carried by a refused save, if that is why it failed.
export function duplicateMatchesOf(error: unknown): AccountDuplicateMatch[] | null {
  if (error instanceof AccountApiError && error.code === "CRM_ACCOUNT_DUPLICATE") return (error.details.matches as AccountDuplicateMatch[]) ?? [];
  return null;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
