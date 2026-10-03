import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type AccountType = "prospect" | "customer" | "partner" | "other";
export type AccountStatus = "active" | "inactive" | "archived";
export type AccountViewKey = "all" | "mine" | "team" | "prospects" | "customers" | "active" | "inactive" | "recently_created" | "recently_updated" | "archived";
export type AccountAddressType = "registered" | "billing" | "shipping" | "office" | "other";
export type AccountRelatedList = "leads" | "opportunities" | "quotations" | "orders" | "returns" | "invoices" | "payments" | "projects" | "tickets";

type CodeLabel<Code extends string = string> = { code: Code; label: string };

export const ACCOUNT_TYPES: ReadonlyArray<CodeLabel<AccountType>>;
export const ACCOUNT_STATUSES: ReadonlyArray<CodeLabel<AccountStatus>>;
export const EMPLOYEE_RANGES: ReadonlyArray<string>;
export const ADDRESS_TYPES: ReadonlyArray<CodeLabel<AccountAddressType>>;
export const ACCOUNT_ACTIVITY_TYPES: ReadonlyArray<CodeLabel<"call" | "email" | "meeting" | "other">>;
export const ACCOUNT_FOLLOW_UP_TYPES: ReadonlyArray<"call" | "email" | "meeting" | "task" | "other">;
export const ACCOUNT_PERMISSIONS: Readonly<{
  view: "crm.accounts.view"; viewAll: "crm.accounts.view_all"; viewSensitive: "crm.accounts.view_sensitive"; create: "crm.accounts.create";
  edit: "crm.accounts.edit"; archive: "crm.accounts.archive"; delete: "crm.accounts.delete"; assign: "crm.accounts.assign";
  reassign: "crm.accounts.reassign"; merge: "crm.accounts.merge"; import: "crm.accounts.import"; export: "crm.accounts.export";
  createCustomer: "crm.accounts.create_customer";
}>;
export const ACCOUNT_NUMBER_DOCUMENT_TYPE: "business_party";
export const CUSTOMER_NUMBER_DOCUMENT_TYPE: "customer";
export function CRM_ACCOUNT_PARTY_SQL(alias: string): string;
export function accountTypeLabel(code: string): string;
export function accountStatusLabel(code: string): string;
export const ACCOUNT_VIEWS: ReadonlyArray<{ key: AccountViewKey; label: string }>;
export const ACCOUNT_RELATED_LISTS: ReadonlyArray<AccountRelatedList>;
export const MERGE_FIELDS: Readonly<Record<string, string>>;
export const ACCOUNT_IMPORT_FIELDS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;

export type AccountCapabilities = Record<keyof typeof ACCOUNT_PERMISSIONS, boolean>;
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

export type AccountInput = Partial<{
  displayName: string; legalName: string | null; accountType: AccountType; industry: string | null; website: string | null;
  email: string | null; phone: string | null; secondaryPhone: string | null; employeeRange: string | null; annualRevenue: number | string | null;
  description: string | null; sourceId: string | null; sourceDetail: string | null; currencyCode: string | null;
  tagIds: string[]; ownerUserId: string | null; teamId: string | null;
}>;

export type AccountListFilters = Partial<{
  view: AccountViewKey; search: string; accountType: string; status: string; industry: string; sourceId: string; teamId: string; ownerId: string;
  countryCode: string; state: string; createdFrom: string; createdTo: string; lastActivityBefore: string; hasOpenOpportunity: "yes" | "no";
  isCustomer: "yes" | "no"; tagId: string; ids: string[]; sortBy: string; sortDirection: "asc" | "desc"; limit: number; offset: number;
}>;

export type AccountBulkResult = {
  results: Array<{ partyId: string; ok: boolean; message?: string; changed?: boolean }>;
  succeeded: number;
  failed: number;
};

export type AccountDuplicateMatch = {
  id: string;
  signals: Array<"website" | "gstin" | "name" | "similar_name" | "name_city" | "name_phone" | "name_email_domain">;
  strength: "exact" | "possible";
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

export type AccountAddress = {
  id: string; addressType: AccountAddressType; line1: string; line2: string | null; city: string; state: string; stateCode: string | null;
  postalCode: string; countryCode: string | null; isDefaultBilling: boolean; isDefaultShipping: boolean; status: string;
};

export type AccountContact = {
  id: string; name: string; firstName: string; lastName: string | null; jobTitle: string | null; department: string | null;
  email?: string | null; phone?: string | null; isPrimary: boolean; isDecisionMaker: boolean; status: string;
};

export type AccountHistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };

export type AccountActivity = {
  id: string; source: "account" | "contact" | "opportunity"; sourceId: string; type: string; subject: string; notes: string | null; status: string;
  priority: string; outcome: string | null; dueAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string; channel: string | null;
  assignedTo: string | null; assignedName: string | null; createdByName: string | null; contactId: string | null; contactName: string | null;
  opportunityName: string | null;
};

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
  id: string; code: string | null; title: string | null; status: string | null; stage: string | null; kind: string | null; priority: string | null;
  paymentStatus: string | null; amount: number | null; outstanding: number | null; currencyCode: string | null; percentComplete: number | null;
  date: string | null; dueDate: string | null; ownerName: string | null; href: string | null;
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

export type AccountOptions = {
  views: ReadonlyArray<{ key: AccountViewKey; label: string }>;
  types: ReadonlyArray<CodeLabel<AccountType>>;
  statuses: ReadonlyArray<CodeLabel<AccountStatus>>;
  employeeRanges: ReadonlyArray<string>;
  addressTypes: ReadonlyArray<CodeLabel<AccountAddressType>>;
  activityTypes: ReadonlyArray<CodeLabel>;
  followUpTypes: ReadonlyArray<string>;
  relatedLists: ReadonlyArray<AccountRelatedList>;
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

type Changed = Promise<{ changed: boolean }>;

// access
export function accountCan(context: CrmContext, permission: string): boolean;
export function requireAccountPermission(context: CrmContext, permission: string, message?: string): void;
export function accountCapabilities(context: CrmContext): AccountCapabilities;
export function canViewAllAccounts(context: CrmContext): boolean;
export function canViewSensitiveAccountContent(context: CrmContext): boolean;
export function accountScopeSql(context: CrmContext, values: unknown[], alias?: string): string;
export function projectAccountForContext<T>(context: CrmContext, record: T): T;

// records
export function listAccounts(client: QueryClient, context: CrmContext, filters?: AccountListFilters): Promise<{ accounts: Account[]; total: number; limit: number; offset: number; capabilities: AccountCapabilities }>;
export function getAccount(client: QueryClient, context: CrmContext, partyId: string): Promise<Account>;
export function createAccount(client: QueryClient, context: CrmContext, input: AccountInput, options?: { allowDuplicate?: boolean; origin?: "manual" | "import" | "lead_conversion"; historySummary?: string | null }): Promise<Account>;
export function updateAccount(client: QueryClient, context: CrmContext, partyId: string, input: AccountInput, options?: { allowDuplicate?: boolean; expectedUpdatedAt?: string | null }): Promise<Account>;
export function setAccountTags(client: QueryClient, context: CrmContext, partyId: string, tagIds: string[]): Promise<void>;
export function setAccountStatus(client: QueryClient, context: CrmContext, partyId: string, status: AccountStatus, options?: { note?: string | null }): Changed;
export function deactivateAccount(client: QueryClient, context: CrmContext, partyId: string, options?: { note?: string | null }): Changed;
export function reactivateAccount(client: QueryClient, context: CrmContext, partyId: string, options?: { note?: string | null }): Changed;
export function archiveAccount(client: QueryClient, context: CrmContext, partyId: string, options?: { note?: string | null }): Changed;
export function bulkSetAccountStatus(client: QueryClient, context: CrmContext, input: { partyIds: string[]; status: AccountStatus }): Promise<AccountBulkResult>;
export function accountReferences(client: QueryClient, context: CrmContext, partyId: string): Promise<string[]>;
export function deleteUnusedAccount(client: QueryClient, context: CrmContext, partyId: string): Promise<{ deleted: true }>;

// assignment and hierarchy
export function applyAccountAssignment(client: QueryClient, context: CrmContext, account: Record<string, any>, target: { ownerUserId?: string | null; teamId?: string | null }, options?: { reason?: string; notify?: boolean }): Promise<boolean>;
export function assignAccount(client: QueryClient, context: CrmContext, partyId: string, input: { ownerUserId?: string | null; teamId?: string | null; reason?: string }): Changed;
export function bulkAssignAccounts(client: QueryClient, context: CrmContext, input: { partyIds: string[]; ownerUserId?: string | null; teamId?: string | null }): Promise<AccountBulkResult>;
export function setAccountParent(client: QueryClient, context: CrmContext, partyId: string, input: { parentPartyId: string | null }): Changed;
export function getAccountHierarchy(client: QueryClient, context: CrmContext, partyId: string): Promise<AccountHierarchy>;

// addresses
export function listAccountAddresses(client: QueryClient, context: CrmContext, partyId: string, options?: { includeInactive?: boolean }): Promise<AccountAddress[]>;
export function addAccountAddress(client: QueryClient, context: CrmContext, partyId: string, input: Record<string, unknown>): Promise<AccountAddress>;
export function updateAccountAddress(client: QueryClient, context: CrmContext, partyId: string, addressId: string, input: Record<string, unknown>): Promise<AccountAddress>;
export function removeAccountAddress(client: QueryClient, context: CrmContext, partyId: string, addressId: string): Changed;

// contacts
export function listAccountContacts(client: QueryClient, context: CrmContext, partyId: string, options?: { includeInactive?: boolean }): Promise<AccountContact[]>;
export function createAccountContact(client: QueryClient, context: CrmContext, partyId: string, input: Record<string, unknown>): Promise<any>;
export function linkContact(client: QueryClient, context: CrmContext, partyId: string, contactId: string): Changed;
export function unlinkContact(client: QueryClient, context: CrmContext, partyId: string, contactId: string): Changed;
export function setPrimaryContact(client: QueryClient, context: CrmContext, partyId: string, contactId: string | null): Changed;
export function updateAccountContactRole(client: QueryClient, context: CrmContext, partyId: string, contactId: string, input: { department?: string | null; isDecisionMaker?: boolean }): Changed;
export function searchLinkableContacts(client: QueryClient, context: CrmContext, partyId: string, search?: string): Promise<Array<{ id: string; name: string; jobTitle: string | null; accountName: string | null }>>;

// duplicates, merge and customer
export function findDuplicateAccounts(client: QueryClient, context: CrmContext, input: AccountInput & Record<string, unknown>, options?: { excludeId?: string | null; limit?: number }): Promise<{ matches: AccountDuplicateMatch[]; hasBlockingMatch: boolean }>;
export function assertNoBlockingAccountDuplicate(client: QueryClient, context: CrmContext, input: Record<string, unknown>, options?: { excludeId?: string | null; allowDuplicate?: boolean }): Promise<{ matches: AccountDuplicateMatch[]; hasBlockingMatch: boolean }>;
export function previewAccountMerge(client: QueryClient, context: CrmContext, keepId: string, duplicateId: string): Promise<AccountMergePreview>;
export function mergeAccounts(client: QueryClient, context: CrmContext, input: { keepId: string; duplicateId: string; choices?: Record<string, "keep" | "duplicate"> }, options?: { linkingCustomer?: boolean }): Promise<{ keptAccountId: string; mergedAccountId: string }>;
export function customerReadiness(client: QueryClient, context: CrmContext, partyId: string): Promise<{ account: Account; ready: boolean; missing: string[] }>;
export function createCustomerFromAccount(client: QueryClient, context: CrmContext, partyId: string, input?: { gstin?: string; pan?: string; paymentTermId?: string; creditLimit?: number | string; currencyCode?: string }): Promise<Account>;
export function searchLinkableCustomers(client: QueryClient, context: CrmContext, partyId: string, search?: string): Promise<Array<{ id: string; code: string; customerNumber: string | null; name: string; gstin: string | null }>>;
export function linkCustomer(client: QueryClient, context: CrmContext, partyId: string, input: { customerId: string; choices?: Record<string, "keep" | "duplicate"> }): Promise<{ keptAccountId: string; mergedAccountId: string }>;

// Customer 360, activities and history
export function getAccountSummary(client: QueryClient, context: CrmContext, partyId: string): Promise<AccountSummary>;
export function listAccountRelated(client: QueryClient, context: CrmContext, partyId: string, list: string): Promise<AccountRelatedRow[]>;
export function listAccountActivities(client: QueryClient, context: CrmContext, partyId: string): Promise<AccountActivity[]>;
export function addAccountActivity(client: QueryClient, context: CrmContext, partyId: string, input: Record<string, unknown>): Promise<{ activityId: string; followUpId: string | null }>;
export function scheduleAccountFollowUp(client: QueryClient, context: CrmContext, partyId: string, input: Record<string, unknown>): Promise<Record<string, any>>;
export function recordAccountHistory(client: QueryClient, context: CrmContext, partyId: string, eventType: string, summary: string, changes?: Record<string, unknown>): Promise<void>;
export function listAccountHistory(client: QueryClient, context: CrmContext, partyId: string, options?: { limit?: number }): Promise<AccountHistoryEntry[]>;

// import / export and reports
export function buildAccountImportTemplate(): string;
export function analyzeAccountImport(client: QueryClient, context: CrmContext, file: { bytes: Uint8Array; fileName: string }): Promise<AccountImportAnalysis>;
export function importAccounts(client: QueryClient, context: CrmContext, input: { bytes: Uint8Array; fileName: string; mapping: Record<string, string>; defaultSourceId?: string | null; defaultOwnerUserId?: string | null; skipDuplicates?: boolean }): Promise<AccountImportResult>;
export function exportAccounts(client: QueryClient, context: CrmContext, filters?: AccountListFilters): Promise<{ fileName: string; rowCount: number; csv: string }>;
export function getAccountListSummary(client: QueryClient, context: CrmContext, filters?: AccountListFilters): Promise<AccountListSummary>;
export function getAccountReport(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<AccountReport>;
export function getAccountOptions(client: QueryClient, context: CrmContext): Promise<AccountOptions>;
