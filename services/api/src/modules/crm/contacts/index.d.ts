import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type ContactStatus = "active" | "inactive" | "archived";
export type ContactViewKey = "all" | "mine" | "team" | "active" | "inactive" | "decision_makers" | "without_company" | "recently_created" | "recently_updated" | "archived";
export type ContactRelatedList = "opportunities" | "quotations" | "orders" | "projects" | "tickets";

type CodeLabel<Code extends string = string> = { code: Code; label: string };

export const CONTACT_STATUSES: ReadonlyArray<CodeLabel<ContactStatus>>;
export const CONTACT_ROLES: ReadonlyArray<CodeLabel>;
export const PREFERRED_CONTACT_METHODS: ReadonlyArray<CodeLabel<"email" | "phone" | "mobile" | "other">>;
export const MARKETING_CONSENT: ReadonlyArray<CodeLabel<"unknown" | "opted_in" | "opted_out">>;
export const CONTACT_ACTIVITY_TYPES: ReadonlyArray<CodeLabel<"call" | "email" | "meeting" | "other">>;
export const CONTACT_FOLLOW_UP_TYPES: ReadonlyArray<"call" | "email" | "meeting" | "task" | "other">;
export const CONTACT_PERMISSIONS: Readonly<{
  view: "crm.contacts.view"; viewAll: "crm.contacts.view_all"; viewSensitive: "crm.contacts.view_sensitive"; create: "crm.contacts.create";
  edit: "crm.contacts.edit"; archive: "crm.contacts.archive"; delete: "crm.contacts.delete"; assign: "crm.contacts.assign";
  reassign: "crm.contacts.reassign"; merge: "crm.contacts.merge"; import: "crm.contacts.import"; export: "crm.contacts.export";
}>;
export const CONTACT_NUMBER_DOCUMENT_TYPE: "crm_contact";
export function contactStatusLabel(code: string): string;
export function contactRoleLabel(code: string): string;
export const CONTACT_VIEWS: ReadonlyArray<{ key: ContactViewKey; label: string }>;
export const CONTACT_RELATED_LISTS: ReadonlyArray<ContactRelatedList>;
export const CONTACT_MERGE_FIELDS: Readonly<Record<string, string>>;
export const CONTACT_IMPORT_FIELDS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;

export type ContactCapabilities = Record<keyof typeof CONTACT_PERMISSIONS, boolean>;
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

export type ContactInput = Partial<{
  firstName: string; middleName: string | null; lastName: string | null; displayName: string | null; email: string | null; secondaryEmail: string | null;
  phone: string | null; mobile: string | null; alternatePhone: string | null; preferredContactMethod: string | null; jobTitle: string | null;
  department: string | null; role: string | null; isDecisionMaker: boolean; description: string | null; sourceId: string | null;
  doNotEmail: boolean; doNotCall: boolean; doNotSms: boolean; marketingConsent: string; useAccountAddress: boolean; addressLine1: string | null;
  addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null; countryCode: string | null;
  accountId: string | null; ownerUserId: string | null; teamId: string | null; tagIds: string[];
}>;

export type ContactListFilters = Partial<{
  view: ContactViewKey; search: string; status: string; accountId: string; ownerId: string; teamId: string; department: string; role: string;
  sourceId: string; countryCode: string; createdFrom: string; createdTo: string; lastActivityBefore: string; isDecisionMaker: "yes" | "no";
  isPrimary: "yes" | "no"; tagId: string; ids: string[]; sortBy: string; sortDirection: "asc" | "desc"; limit: number; offset: number;
}>;

export type ContactBulkResult = { results: Array<{ contactId: string; ok: boolean; message?: string; changed?: boolean }>; succeeded: number; failed: number };

export type ContactDuplicateMatch = {
  id: string; signals: Array<"email" | "phone" | "name_company" | "name_email_domain" | "similar_name">; strength: "exact" | "possible"; canOpen: boolean;
  code?: string | null; name?: string; jobTitle?: string | null; email?: string | null; mobile?: string | null; status?: ContactStatus;
  accountId?: string | null; accountName?: string | null; ownerName?: string | null;
};

export type ContactAccountLink = {
  id: string; accountId: string; accountName: string; accountCode: string; accountType: string; accountStatus: string; jobTitle: string | null;
  department: string | null; role: string | null; isPrimaryAccount: boolean; isPrimaryContact: boolean; isDecisionMaker: boolean;
  status: "active" | "inactive"; endedAt: string | null; createdAt: string;
};

export type ContactActivity = {
  id: string; source: string; sourceId: string; type: string; subject: string; notes: string | null; status: string; priority: string; outcome: string | null;
  dueAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string; channel: string | null; assignedTo: string | null;
  assignedName: string | null; createdByName: string | null; accountId: string | null; accountName: string | null; opportunityId: string | null;
  opportunityName: string | null;
};

export type ContactHistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };

export type ContactSummary = {
  access: { sales: boolean; projects: boolean; support: boolean };
  accountId: string | null; accountName: string | null; role: string | null; ownerName: string | null; openOpportunities: number; openTasks: number;
  nextFollowUpAt: string | null; lastActivityAt: string | null; openQuotations?: number; orders?: number; openTickets?: number;
};

export type ContactRelatedRow = {
  id: string; code: string | null; title: string | null; status: string | null; stage: string | null; kind: string | null; priority: string | null;
  paymentStatus: string | null; amount: number | null; outstanding: number | null; currencyCode: string | null; percentComplete: number | null;
  date: string | null; dueDate: string | null; ownerName: string | null; href: string | null;
};

export type ContactMergePreview = { keep: Contact; duplicate: Contact; fields: string[]; moves: Record<string, number>; blockers: string[] };

export type ContactImportAnalysis = {
  fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>; suggestedMapping: Record<string, string>;
  fields: Array<{ key: string; label: string }>;
};
export type ContactImportResult = {
  total: number; created: number; failed: number; duplicates: number; errors: Array<{ row: number; message: string; duplicate?: boolean }>;
  warnings: Array<{ row: number; message: string }>; errorCsv: string | null;
};

export type ContactOptions = {
  views: ReadonlyArray<{ key: ContactViewKey; label: string }>; statuses: ReadonlyArray<CodeLabel<ContactStatus>>; roles: ReadonlyArray<CodeLabel>;
  preferredContactMethods: ReadonlyArray<CodeLabel>; marketingConsent: ReadonlyArray<CodeLabel>; activityTypes: ReadonlyArray<CodeLabel>;
  followUpTypes: ReadonlyArray<string>; relatedLists: ReadonlyArray<ContactRelatedList>; sources: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  users: Array<{ id: string; name: string; email: string }>; teams: Array<{ id: string; name: string }>; tags: ContactTag[]; departments: string[];
  currentUserId: string; capabilities: ContactCapabilities; moduleAccess: { sales: boolean; projects: boolean; support: boolean };
};

type Changed = Promise<{ changed: boolean }>;

export function contactCan(context: CrmContext, permission: string): boolean;
export function requireContactPermission(context: CrmContext, permission: string, message?: string): void;
export function contactCapabilities(context: CrmContext): ContactCapabilities;
export function canViewAllContacts(context: CrmContext): boolean;
export function canViewSensitiveContactContent(context: CrmContext): boolean;
export function contactScopeSql(context: CrmContext, bind: (value: unknown) => string, alias?: string): string;
export function contactScopeValues(context: CrmContext, values: unknown[], alias?: string): string;
export function projectContactForContext<T>(context: CrmContext, record: T): T;

export function listContacts(client: QueryClient, context: CrmContext, filters?: ContactListFilters): Promise<{ contacts: Contact[]; total: number; limit: number; offset: number; capabilities: ContactCapabilities }>;
export function getContact(client: QueryClient, context: CrmContext, contactId: string): Promise<Contact>;
export function createContact(client: QueryClient, context: CrmContext, input: ContactInput, options?: { allowDuplicate?: boolean; origin?: string; makePrimary?: boolean; historySummary?: string | null }): Promise<Contact>;
export function updateContact(client: QueryClient, context: CrmContext, contactId: string, input: ContactInput, options?: { allowDuplicate?: boolean; expectedUpdatedAt?: string | null }): Promise<Contact>;
export function setContactTags(client: QueryClient, context: CrmContext, contactId: string, tagIds: string[]): Promise<void>;
export function setContactStatus(client: QueryClient, context: CrmContext, contactId: string, status: ContactStatus, options?: { note?: string | null }): Changed;
export function deactivateContact(client: QueryClient, context: CrmContext, contactId: string, options?: { note?: string | null }): Changed;
export function reactivateContact(client: QueryClient, context: CrmContext, contactId: string, options?: { note?: string | null }): Changed;
export function archiveContact(client: QueryClient, context: CrmContext, contactId: string, options?: { note?: string | null }): Changed;
export function bulkSetContactStatus(client: QueryClient, context: CrmContext, input: { contactIds: string[]; status: ContactStatus }): Promise<ContactBulkResult>;
export function contactReferences(client: QueryClient, context: CrmContext, contactId: string): Promise<string[]>;
export function deleteUnusedContact(client: QueryClient, context: CrmContext, contactId: string): Promise<{ deleted: true }>;

export function applyContactAssignment(client: QueryClient, context: CrmContext, contact: Record<string, any>, target: { ownerUserId?: string | null; teamId?: string | null }, options?: { reason?: string; notify?: boolean }): Promise<boolean>;
export function assignContact(client: QueryClient, context: CrmContext, contactId: string, input: { ownerUserId?: string | null; teamId?: string | null; reason?: string }): Changed;
export function reassignContact(client: QueryClient, context: CrmContext, contactId: string, input: { ownerUserId?: string | null; teamId?: string | null; reason?: string }): Changed;
export function bulkAssignContacts(client: QueryClient, context: CrmContext, input: { contactIds: string[]; ownerUserId?: string | null; teamId?: string | null }): Promise<ContactBulkResult>;

export function listContactAccounts(client: QueryClient, context: CrmContext, contactId: string): Promise<ContactAccountLink[]>;
export function linkContactToAccount(client: QueryClient, context: CrmContext, contactId: string, input: { accountId: string; jobTitle?: string | null; department?: string | null; role?: string | null; isDecisionMaker?: boolean; makePrimaryAccount?: boolean }): Changed;
export function updateContactRelationship(client: QueryClient, context: CrmContext, contactId: string, accountId: string, input: { jobTitle?: string | null; department?: string | null; role?: string | null; isDecisionMaker?: boolean; status?: "active" | "inactive" }): Changed;
export function unlinkContactFromAccount(client: QueryClient, context: CrmContext, contactId: string, accountId: string): Changed;
export function setPrimaryAccount(client: QueryClient, context: CrmContext, contactId: string, accountId: string): Changed;

export function findDuplicateContacts(client: QueryClient, context: CrmContext, input: Record<string, unknown>, options?: { excludeId?: string | null; limit?: number }): Promise<{ matches: ContactDuplicateMatch[]; hasBlockingMatch: boolean }>;
export function assertNoBlockingContactDuplicate(client: QueryClient, context: CrmContext, input: Record<string, unknown>, options?: { excludeId?: string | null; allowDuplicate?: boolean }): Promise<{ matches: ContactDuplicateMatch[]; hasBlockingMatch: boolean }>;
export function previewContactMerge(client: QueryClient, context: CrmContext, keepId: string, duplicateId: string): Promise<ContactMergePreview>;
export function mergeContacts(client: QueryClient, context: CrmContext, input: { keepId: string; duplicateId: string; choices?: Record<string, "keep" | "duplicate"> }): Promise<{ keptContactId: string; mergedContactId: string }>;

export function listContactActivities(client: QueryClient, context: CrmContext, contactId: string): Promise<ContactActivity[]>;
export function addContactActivity(client: QueryClient, context: CrmContext, contactId: string, input: Record<string, unknown>): Promise<{ activityId: string; followUpId: string | null }>;
export function scheduleContactFollowUp(client: QueryClient, context: CrmContext, contactId: string, input: Record<string, unknown>): Promise<Record<string, any>>;
export function getContactSummary(client: QueryClient, context: CrmContext, contactId: string): Promise<ContactSummary>;
export function listContactRelated(client: QueryClient, context: CrmContext, contactId: string, list: string): Promise<ContactRelatedRow[]>;
export function recordContactHistory(client: QueryClient, context: CrmContext, contactId: string, eventType: string, summary: string, changes?: Record<string, unknown>): Promise<void>;
export function listContactHistory(client: QueryClient, context: CrmContext, contactId: string, options?: { limit?: number }): Promise<ContactHistoryEntry[]>;

export function buildContactImportTemplate(): string;
export function analyzeContactImport(client: QueryClient, context: CrmContext, file: { bytes: Uint8Array; fileName: string }): Promise<ContactImportAnalysis>;
export function importContacts(client: QueryClient, context: CrmContext, input: { bytes: Uint8Array; fileName: string; mapping: Record<string, string>; defaultSourceId?: string | null; defaultOwnerUserId?: string | null; skipDuplicates?: boolean }): Promise<ContactImportResult>;
export function exportContacts(client: QueryClient, context: CrmContext, filters?: ContactListFilters): Promise<{ fileName: string; rowCount: number; csv: string }>;
export function getContactOptions(client: QueryClient, context: CrmContext): Promise<ContactOptions>;
