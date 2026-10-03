import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type LeadStage = "new" | "attempting_contact" | "contacted" | "nurturing" | "ready_to_qualify";
export type LeadStatus = "open" | "qualified" | "disqualified" | "converted";
export type LeadPriority = "low" | "medium" | "high";
export type LeadRating = "cold" | "warm" | "hot";
export type LeadTriState = "yes" | "no" | "unknown";
export type LeadBudgetStatus = "known" | "unknown";
export type LeadPurchaseTimeframe = "immediate" | "within_1_month" | "within_3_months" | "within_6_months" | "within_12_months" | "later" | "unknown";
export type LeadDisqualificationReason =
  | "not_interested" | "no_requirement" | "no_budget" | "not_decision_maker" | "bad_fit" | "duplicate"
  | "invalid_contact" | "unable_to_contact" | "competitor_selected" | "timing_not_suitable" | "other";
export type LeadViewKey = "all" | "mine" | "unassigned" | "new" | "follow_up" | "due_today" | "overdue" | "qualified" | "disqualified" | "converted" | "archived";

type CodeLabel<Code extends string = string> = { code: Code; label: string };

export const LEAD_STAGES: ReadonlyArray<CodeLabel<LeadStage>>;
export const LEAD_STATUSES: ReadonlyArray<CodeLabel<LeadStatus>>;
export const LEAD_PRIORITIES: ReadonlyArray<LeadPriority>;
export const LEAD_RATINGS: ReadonlyArray<LeadRating>;
export const LEAD_TRI_STATE: ReadonlyArray<LeadTriState>;
export const LEAD_BUDGET_STATUSES: ReadonlyArray<LeadBudgetStatus>;
export const LEAD_PURCHASE_TIMEFRAMES: ReadonlyArray<CodeLabel<LeadPurchaseTimeframe>>;
export const LEAD_DISQUALIFICATION_REASONS: ReadonlyArray<CodeLabel<LeadDisqualificationReason>>;
export const DEFAULT_LEAD_SOURCES: ReadonlyArray<{ code: string; name: string; channel: string }>;
export const LEAD_ACTIVITY_TYPES: ReadonlyArray<CodeLabel<"call" | "email" | "meeting" | "other">>;
export const LEAD_FOLLOW_UP_TYPES: ReadonlyArray<"call" | "email" | "meeting" | "task" | "other">;
export const LEAD_NUMBER_DOCUMENT_TYPE: "crm_lead";
export const LEAD_PERMISSIONS: Readonly<{
  view: "crm.leads.view"; viewAll: "crm.leads.view_all"; viewSensitive: "crm.leads.view_sensitive"; create: "crm.leads.create";
  edit: "crm.leads.edit"; delete: "crm.leads.delete"; assign: "crm.leads.assign"; reassign: "crm.leads.reassign";
  import: "crm.leads.import"; export: "crm.leads.export"; qualify: "crm.leads.qualify"; disqualify: "crm.leads.disqualify";
  reopen: "crm.leads.reopen"; convert: "crm.leads.convert";
}>;
export const LEAD_VIEWS: ReadonlyArray<{ key: LeadViewKey; label: string }>;
export function leadStageLabel(code: string): string;
export function leadStatusLabel(code: string): string;
export function leadDisqualificationReasonLabel(code: string): string;

export type LeadCapabilities = Record<keyof typeof LEAD_PERMISSIONS, boolean>;

export type LeadTag = { id: string; name: string; color: string };

export type Lead = {
  id: string;
  code: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  companyName: string | null;
  jobTitle: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  sourceId: string | null;
  sourceName: string | null;
  sourceDetail: string | null;
  industry: string | null;
  productInterest: string | null;
  estimatedValue: number;
  currencyCode: string | null;
  purchaseTimeframe: LeadPurchaseTimeframe | null;
  priority: LeadPriority;
  rating: LeadRating;
  description: string | null;
  tags: LeadTag[];
  ownerUserId: string | null;
  ownerName: string | null;
  teamId: string | null;
  teamName: string | null;
  assignedAt: string | null;
  stage: LeadStage;
  stageChangedAt: string;
  status: LeadStatus;
  needIdentified: LeadTriState;
  budgetStatus: LeadBudgetStatus;
  budgetAmount: number | null;
  decisionAuthority: LeadTriState;
  qualificationNotes: string | null;
  qualifiedAt: string | null;
  disqualificationReason: LeadDisqualificationReason | null;
  disqualificationNotes: string | null;
  disqualifiedAt: string | null;
  convertedAt: string | null;
  convertedBy: string | null;
  convertedPartyId: string | null;
  convertedContactId: string | null;
  convertedOpportunityId: string | null;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
  sensitiveDataRestricted?: boolean;
};

export type LeadInput = Partial<{
  firstName: string | null; lastName: string | null; companyName: string | null; jobTitle: string | null;
  email: string | null; phone: string | null; mobile: string | null; website: string | null;
  city: string | null; state: string | null; countryCode: string | null; currencyCode: string | null;
  sourceId: string | null; sourceDetail: string | null; industry: string | null; productInterest: string | null;
  estimatedValue: number | string | null; purchaseTimeframe: string | null; priority: string; rating: string;
  description: string | null; tagIds: string[]; ownerUserId: string | null; teamId: string | null;
}>;

export type LeadListFilters = Partial<{
  view: LeadViewKey; search: string; status: string; stage: string; priority: string; rating: string;
  ownerId: string; teamId: string; sourceId: string; tagId: string; createdFrom: string; createdTo: string;
  ids: string[]; sortBy: string; sortDirection: "asc" | "desc"; limit: number; offset: number;
}>;

export type LeadDuplicateMatch = {
  kind: "lead" | "contact";
  id: string;
  signals: Array<"email" | "phone" | "name_company" | "name">;
  strength: "exact" | "possible";
  canOpen: boolean;
  name?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  code?: string;
  status?: LeadStatus;
  ownerName?: string | null;
  partyId?: string | null;
};

export type LeadBulkResult = {
  results: Array<{ leadId: string; ok: boolean; message?: string; changed?: boolean }>;
  succeeded: number;
  failed: number;
};

export type LeadHistoryEntry = {
  id: string;
  eventType: string;
  summary: string;
  changes: Record<string, unknown>;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
};

export type LeadSource = { id: string; code: string; name: string; description: string | null; isActive: boolean; isSystem: boolean; sortOrder: number; leadCount?: number };

export type LeadAssignmentRule = {
  id: string; name: string; priority: number; isActive: boolean;
  sourceId: string | null; sourceName: string | null; countryCode: string | null; state: string | null; city: string | null; productKeyword: string | null;
  ownerUserId: string | null; ownerName: string | null; teamId: string | null; teamName: string | null;
};

export type LeadConversionPreview = {
  lead: Lead;
  canConvert: boolean;
  canCreateContact: boolean;
  blockedReason: string | null;
  accountMatches: Array<{ id: string; name: string; code: string; strength: string }>;
  contactMatches: Array<{ id: string; partyId: string | null; name: string; accountName: string | null; email: string | null; phone: string | null; strength: string }>;
  stages: Array<{ id: string; name: string; pipelineName: string }>;
  defaults: { accountName: string | null; opportunityName: string; amount: number; ownerUserId: string | null };
};

export type LeadConversionInput = {
  account?: { id?: string; name?: string; allowDuplicate?: boolean };
  contact?: { id?: string; allowDuplicate?: boolean };
  opportunity?: { create?: boolean; name?: string; amount?: number | string | null; productInterest?: string; ownerUserId?: string; stageId?: string; expectedCloseDate?: string | null };
};

export type LeadDashboard = {
  period: { from: string; to: string };
  totals: {
    open: number; new: number; unassigned: number; createdInPeriod: number; followUpsDueToday: number; overdueFollowUps: number;
    qualified: number; disqualified: number; converted: number;
  };
  byStatus: Array<{ key: LeadStatus; label: string; total: number }>;
  byStage: Array<{ key: LeadStage; label: string; total: number }>;
  bySource: Array<{ label: string; total: number }>;
  byOwner: Array<{ label: string; total: number }>;
};

export type LeadReportRow = { group: string; total: number; open: number; qualified: number; disqualified: number; converted: number; conversionRate: number; estimatedValue: number };
export type LeadsByStatusReport = { groupBy: string; groupLabel: string; rows: LeadReportRow[]; totals: Omit<LeadReportRow, "group" | "conversionRate"> };

export type LeadImportAnalysis = {
  fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string }>;
};
export type LeadImportResult = {
  total: number; created: number; failed: number; duplicates: number;
  errors: Array<{ row: number; message: string; duplicate?: boolean }>; errorCsv: string | null;
};

// access
export function leadCan(context: CrmContext, permission: string): boolean;
export function leadCapabilities(context: CrmContext): LeadCapabilities;
export function canViewAllLeadRecords(context: CrmContext): boolean;
export function canViewSensitiveLeadContent(context: CrmContext): boolean;
export function leadScopeSql(context: CrmContext, values: unknown[], alias?: string): string;
export function projectLeadForContext<T>(context: CrmContext, record: T): T;

// records
export function listLeads(client: QueryClient, context: CrmContext, filters?: LeadListFilters): Promise<{ leads: Lead[]; total: number; limit: number; offset: number; capabilities: LeadCapabilities }>;
export function getLead(client: QueryClient, context: CrmContext, leadId: string): Promise<Lead>;
export function createLead(client: QueryClient, context: CrmContext, input: LeadInput, options?: { allowDuplicate?: boolean; defaultOwner?: "creator" | "none"; origin?: "manual" | "import" | "integration" }): Promise<Lead>;
export function updateLead(client: QueryClient, context: CrmContext, leadId: string, input: LeadInput, options?: { allowDuplicate?: boolean; expectedUpdatedAt?: string | null }): Promise<Lead>;
export function changeLeadStage(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ changed: boolean }>;
export function bulkChangeLeadStage(client: QueryClient, context: CrmContext, input: { leadIds: string[]; stage: string }): Promise<LeadBulkResult>;
export function archiveLead(client: QueryClient, context: CrmContext, leadId: string): Promise<{ changed: boolean }>;
export function restoreLead(client: QueryClient, context: CrmContext, leadId: string): Promise<{ changed: boolean }>;

// assignment
export function assertEligibleLeadAssignee(client: QueryClient, context: CrmContext, userId: string): Promise<{ id: string; full_name: string }>;
export function listLeadAssignmentOptions(client: QueryClient, context: CrmContext): Promise<{ users: Array<{ id: string; name: string; email: string }>; teams: Array<{ id: string; name: string }> }>;
export function assignLead(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ changed: boolean }>;
export function bulkAssignLeads(client: QueryClient, context: CrmContext, input: { leadIds: string[]; ownerUserId?: string | null; teamId?: string | null }): Promise<LeadBulkResult>;
export function listLeadAssignmentRules(client: QueryClient, context: CrmContext): Promise<LeadAssignmentRule[]>;
export function saveLeadAssignmentRule(client: QueryClient, context: CrmContext, id: string | null, input: Record<string, unknown>): Promise<LeadAssignmentRule>;
export function deleteLeadAssignmentRule(client: QueryClient, context: CrmContext, id: string): Promise<void>;

// qualification
export function saveLeadQualification(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ changed: boolean }>;
export function qualifyLead(client: QueryClient, context: CrmContext, leadId: string, input?: Record<string, unknown>): Promise<{ status: "qualified" }>;
export function disqualifyLead(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ status: "disqualified" }>;
export function reopenLead(client: QueryClient, context: CrmContext, leadId: string, input?: Record<string, unknown>): Promise<{ status: "open" }>;
export function bulkDisqualifyLeads(client: QueryClient, context: CrmContext, input: { leadIds: string[]; reason: string; notes?: string }): Promise<LeadBulkResult>;

// duplicates and merge
export function findLeadDuplicates(client: QueryClient, context: CrmContext, input: LeadInput, options?: { excludeLeadId?: string | null; limit?: number }): Promise<{ matches: LeadDuplicateMatch[]; hasBlockingMatch: boolean }>;
export function mergeLeads(client: QueryClient, context: CrmContext, duplicateLeadId: string, keepLeadId: string): Promise<{ keptLeadId: string; mergedLeadId: string }>;

// conversion
export function previewLeadConversion(client: QueryClient, context: CrmContext, leadId: string): Promise<LeadConversionPreview>;
export function convertLead(client: QueryClient, context: CrmContext, leadId: string, input?: LeadConversionInput): Promise<{ leadId: string; partyId: string; contactId: string | null; opportunityId: string | null }>;

// activities and history
export type LeadActivity = {
  id: string; type: string; subject: string; notes: string | null; status: string; priority: string; outcome: string | null;
  dueAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string; channel: string | null;
  assignedTo: string | null; assignedName: string | null; createdByName: string | null;
};
export function listLeadActivities(client: QueryClient, context: CrmContext, leadId: string): Promise<LeadActivity[]>;
export function addLeadActivity(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ activityId: string; followUpId: string | null }>;
export function scheduleLeadFollowUp(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<Record<string, any>>;
export function listLeadHistory(client: QueryClient, context: CrmContext, leadId: string, options?: { limit?: number; eventTypes?: string[] | null }): Promise<LeadHistoryEntry[]>;

// sources
export function ensureDefaultLeadSources(client: QueryClient, context: CrmContext): Promise<void>;
export function listLeadSources(client: QueryClient, context: CrmContext, options?: { includeInactive?: boolean }): Promise<LeadSource[]>;
export function createLeadSource(client: QueryClient, context: CrmContext, input: { name: string; description?: string | null }): Promise<LeadSource>;
export function updateLeadSource(client: QueryClient, context: CrmContext, id: string, input: { name?: string; description?: string | null; isActive?: boolean }): Promise<LeadSource>;

// import / export
export const LEAD_IMPORT_FIELDS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;
export function buildLeadImportTemplate(): string;
export function analyzeLeadImport(client: QueryClient, context: CrmContext, file: { bytes: Uint8Array; fileName: string }): Promise<LeadImportAnalysis>;
export function importLeads(client: QueryClient, context: CrmContext, input: { bytes: Uint8Array; fileName: string; mapping: Record<string, string>; defaultSourceId?: string | null; defaultOwnerUserId?: string | null; skipDuplicates?: boolean }): Promise<LeadImportResult>;
export function exportLeads(client: QueryClient, context: CrmContext, filters?: LeadListFilters): Promise<{ fileName: string; rowCount: number; csv: string }>;

// dashboard and report
export function getLeadDashboard(client: QueryClient, context: CrmContext, input?: { from?: string; to?: string }): Promise<LeadDashboard>;
export function getLeadsByStatusReport(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<LeadsByStatusReport>;

// public web-to-lead capture
export function resolvePublicCaptureOrganization(queryable: QueryClient, formKey: string): Promise<string | null>;
export function captureCrmLead(client: QueryClient, formKey: string, input: Record<string, unknown>, requestContext?: { origin?: string; fingerprint?: string }): Promise<{ message: string; leadId: string | null; duplicateSuppressed?: boolean }>;

// picker options for the lead screens
export type LeadOptions = {
  views: ReadonlyArray<{ key: LeadViewKey; label: string }>;
  stages: ReadonlyArray<CodeLabel<LeadStage>>;
  statuses: ReadonlyArray<CodeLabel<LeadStatus>>;
  purchaseTimeframes: ReadonlyArray<CodeLabel<LeadPurchaseTimeframe>>;
  disqualificationReasons: ReadonlyArray<CodeLabel<LeadDisqualificationReason>>;
  activityTypes: ReadonlyArray<CodeLabel>;
  followUpTypes: ReadonlyArray<string>;
  sources: LeadSource[];
  users: Array<{ id: string; name: string; email: string }>;
  teams: Array<{ id: string; name: string }>;
  tags: LeadTag[];
  currencies: string[];
  baseCurrency: string;
  currentUserId: string;
  capabilities: LeadCapabilities;
};
export function getLeadOptions(client: QueryClient, context: CrmContext): Promise<LeadOptions>;
