"use client";

// Browser client for the contact routes under /api/crm/contacts. One
// function per contact operation; a failed request throws ContactApiError
// carrying the server's message, code and (for duplicates) the matches.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class ContactApiError extends CrmApiErrorWithBody {}

const { request, parseResponse } = crmApiClient(ContactApiError, "body");

export type ContactStatus = "active" | "inactive" | "archived";
export type ContactViewKey = "all" | "mine" | "team" | "active" | "inactive" | "decision_makers" | "without_company" | "recently_created" | "recently_updated" | "archived";
export type ContactRelatedList = "opportunities" | "quotations" | "orders" | "projects" | "tickets";

export type ContactTag = { id: string; name: string; color: string };

export type Contact = {
  id: string;
  contactNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  displayName: string;
  accountId: string | null;
  accountName: string | null;
  accountCode: string | null;
  accountType: string | null;
  jobTitle: string | null;
  department: string | null;
  role: string | null;
  roleLabel: string | null;
  isDecisionMaker: boolean;
  isPrimary: boolean;
  email?: string | null;
  secondaryEmail?: string | null;
  phone?: string | null;
  mobile?: string | null;
  alternatePhone?: string | null;
  preferredContactMethod: string | null;
  doNotEmail: boolean;
  doNotCall: boolean;
  doNotSms: boolean;
  marketingConsent: "unknown" | "opted_in" | "opted_out";
  useAccountAddress: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  status: ContactStatus;
  sourceId: string | null;
  sourceName: string | null;
  description: string | null;
  tags: ContactTag[];
  ownerUserId: string | null;
  ownerName: string | null;
  teamId: string | null;
  teamName: string | null;
  assignedAt: string | null;
  companyCount: number;
  openOpportunities: number;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
  archivedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
  sensitiveDataRestricted?: boolean;
};

export type ContactCapabilities = Record<
  "view" | "viewAll" | "viewSensitive" | "create" | "edit" | "archive" | "delete" | "assign" | "reassign" | "merge" | "import" | "export",
  boolean
>;

type CodeLabel = { code: string; label: string };

export type ContactOptions = {
  views: Array<{ key: ContactViewKey; label: string }>;
  statuses: Array<{ code: ContactStatus; label: string }>;
  roles: CodeLabel[];
  preferredContactMethods: CodeLabel[];
  marketingConsent: CodeLabel[];
  activityTypes: CodeLabel[];
  followUpTypes: string[];
  relatedLists: ContactRelatedList[];
  sources: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  users: Array<{ id: string; name: string; email: string }>;
  teams: Array<{ id: string; name: string }>;
  tags: ContactTag[];
  departments: string[];
  currentUserId: string;
  capabilities: ContactCapabilities;
  moduleAccess: { sales: boolean; projects: boolean; support: boolean };
};

export type ContactListFilters = {
  view?: ContactViewKey;
  search?: string;
  status?: string;
  accountId?: string;
  ownerId?: string;
  teamId?: string;
  department?: string;
  role?: string;
  sourceId?: string;
  countryCode?: string;
  createdFrom?: string;
  createdTo?: string;
  lastActivityBefore?: string;
  isDecisionMaker?: string;
  isPrimary?: string;
  tagId?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type ContactDuplicateMatch = {
  id: string;
  signals: string[];
  strength: "exact" | "possible";
  canOpen: boolean;
  code?: string | null;
  name?: string;
  jobTitle?: string | null;
  email?: string | null;
  mobile?: string | null;
  status?: ContactStatus;
  accountId?: string | null;
  accountName?: string | null;
  ownerName?: string | null;
};

export type ContactBulkResult = { results: Array<{ contactId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };

export type ContactAccountLink = {
  id: string;
  accountId: string;
  accountName: string;
  accountCode: string;
  accountType: string;
  accountStatus: string;
  jobTitle: string | null;
  department: string | null;
  role: string | null;
  isPrimaryAccount: boolean;
  isPrimaryContact: boolean;
  isDecisionMaker: boolean;
  status: "active" | "inactive";
  endedAt: string | null;
  createdAt: string;
};

export type ContactActivity = {
  id: string;
  source: string;
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
  accountId: string | null;
  accountName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
};

export type ContactHistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };

export type ContactSummary = {
  access: { sales: boolean; projects: boolean; support: boolean };
  accountId: string | null;
  accountName: string | null;
  role: string | null;
  ownerName: string | null;
  openOpportunities: number;
  openTasks: number;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  openQuotations?: number;
  orders?: number;
  openTickets?: number;
};

export type ContactRelatedRow = {
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

export type ContactMergePreview = { keep: Contact; duplicate: Contact; fields: string[]; moves: Record<string, number>; blockers: string[] };

export type ContactImportAnalysis = {
  fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string }>;
};
export type ContactImportResult = {
  total: number; created: number; failed: number; duplicates: number;
  errors: Array<{ row: number; message: string; duplicate?: boolean }>; warnings: Array<{ row: number; message: string }>; errorCsv: string | null;
};

const BASE = "/api/crm/contacts";

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
export const getContactOptions = () => request<{ options: ContactOptions }>(`${BASE}/options`).then((result) => result.options);
export const listContacts = (filters: ContactListFilters = {}) =>
  request<{ rows: Contact[]; total: number; limit: number; offset: number; capabilities: ContactCapabilities }>(`${BASE}${query(filters)}`);
export const getContact = (id: string) => request<{ record: Contact }>(`${BASE}/${id}`).then((result) => result.record);
export const createContact = (input: Record<string, unknown>) => post<{ record: Contact }>(BASE, input).then((result) => result.record);
export const updateContact = (id: string, input: Record<string, unknown>) =>
  request<{ record: Contact }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.record);
export const deleteContact = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" });
export const setContactStatus = (id: string, status: ContactStatus, note?: string) => post<Changed>(`${BASE}/${id}/status`, { status, note });
export const assignContact = (id: string, input: { ownerUserId?: string | null; teamId?: string | null }) => post<Changed>(`${BASE}/${id}/assign`, input);
export const bulkContactAction = (input: { action: "assign" | "status"; contactIds: string[] } & Record<string, unknown>) => post<ContactBulkResult>(`${BASE}/bulk`, input);
export const checkContactDuplicates = (input: Record<string, unknown>) =>
  post<{ matches: ContactDuplicateMatch[]; hasBlockingMatch: boolean }>(`${BASE}/duplicates`, input);

// ---- companies
export const listContactAccounts = (id: string) => request<{ accounts: ContactAccountLink[] }>(`${BASE}/${id}/accounts`).then((result) => result.accounts);
export const linkContactAccount = (id: string, input: Record<string, unknown>) => post<Changed>(`${BASE}/${id}/accounts`, input);
export const updateContactAccount = (id: string, accountId: string, input: Record<string, unknown>) =>
  request<Changed>(`${BASE}/${id}/accounts/${accountId}`, { method: "PATCH", json: input });
export const setContactPrimaryAccount = (id: string, accountId: string) => post<Changed>(`${BASE}/${id}/accounts/${accountId}/primary`);

// ---- merge
export const previewContactMerge = (keepId: string, duplicateId: string) =>
  request<{ preview: ContactMergePreview }>(`${BASE}/merge${query({ keepId, duplicateId })}`).then((result) => result.preview);
export const mergeContacts = (input: { keepId: string; duplicateId: string; choices: Record<string, "keep" | "duplicate"> }) =>
  post<{ merge: { keptContactId: string; mergedContactId: string } }>(`${BASE}/merge`, input).then((result) => result.merge);

// ---- work, summary and history
export const listContactActivities = (id: string) => request<{ activities: ContactActivity[] }>(`${BASE}/${id}/activities`).then((result) => result.activities);
export const logContactActivity = (id: string, input: Record<string, unknown>) => post<{ activityId: string; followUpId: string | null }>(`${BASE}/${id}/activities`, input);
export const scheduleContactFollowUp = (id: string, input: Record<string, unknown>) => post<{ followUp: { id: string } }>(`${BASE}/${id}/follow-ups`, input);
export const listContactHistory = (id: string) => request<{ history: ContactHistoryEntry[] }>(`${BASE}/${id}/history`).then((result) => result.history);
export const getContactSummary = (id: string) => request<{ summary: ContactSummary }>(`${BASE}/${id}/summary`).then((result) => result.summary);
export const listContactRelated = (id: string, list: ContactRelatedList) =>
  request<{ rows: ContactRelatedRow[] }>(`${BASE}/${id}/related/${list}`).then((result) => result.rows);

// ---- import and export
export const contactImportTemplateUrl = `${BASE}/import/template`;
export const contactExportUrl = (filters: ContactListFilters & { ids?: string }) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;

async function upload<T>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return parseResponse<T>(await fetch(url, { method: "POST", body: form }));
}

export const analyzeContactImport = (file: File) => upload<{ analysis: ContactImportAnalysis }>(`${BASE}/import/analyze`, file).then((result) => result.analysis);
export const importContacts = (file: File, options: { mapping: Record<string, string>; defaultSourceId?: string; defaultOwnerUserId?: string; skipDuplicates: boolean }) =>
  upload<{ result: ContactImportResult }>(`${BASE}/import`, file, {
    mapping: JSON.stringify(options.mapping),
    defaultSourceId: options.defaultSourceId ?? "",
    defaultOwnerUserId: options.defaultOwnerUserId ?? "",
    skipDuplicates: String(options.skipDuplicates),
  }).then((result) => result.result);

export function duplicateMatchesOf(error: unknown): ContactDuplicateMatch[] | null {
  if (error instanceof ContactApiError && error.code === "CRM_CONTACT_DUPLICATE") return (error.details.matches as ContactDuplicateMatch[]) ?? [];
  return null;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
