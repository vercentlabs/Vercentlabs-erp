import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

// A stage code: one of the five system stages or an organization's own.
export type LeadStage = string;
export type LeadStageDefinition = { id: string; code: string; label: string; name: string; sequence: number; isActive: boolean; isSystem: boolean; leadCount?: number };
export type LeadStageHistoryEntry = {
  id: string; fromStage: string | null; fromStageName: string | null; toStage: string; toStageName: string; note: string | null; isAutomatic: boolean;
  enteredAt: string; leftAt: string | null; changedByName: string | null;
};
export type LeadStatus = "open" | "qualified" | "disqualified" | "converted";
export type LeadPriority = "low" | "medium" | "high";
export type LeadRating = "cold" | "warm" | "hot";
export type LeadNeedStatus = "yes" | "no" | "unknown";
export type LeadBudgetStatus = "confirmed" | "likely" | "unknown" | "no_budget";
export type LeadAuthorityStatus = "decision_maker" | "influencer" | "unknown" | "no_authority";
export type LeadQualificationStatus = "not_started" | "in_progress" | "qualified" | "disqualified";
export type LeadQualificationCriterion = "need" | "budget" | "authority" | "timeline";
export type LeadQualificationRequirements = Record<LeadQualificationCriterion, boolean>;
export type LeadPurchaseTimeframe = "immediate" | "within_1_month" | "within_3_months" | "within_6_months" | "within_12_months" | "later" | "unknown";
export type LeadDisqualificationReason =
  | "not_interested" | "no_requirement" | "no_budget" | "not_decision_maker" | "bad_fit" | "duplicate"
  | "invalid_contact" | "unable_to_contact" | "competitor_selected" | "timing_not_suitable" | "other";
export type LeadViewKey = "all" | "mine" | "unassigned" | "no_activity" | "new" | "follow_up" | "due_today" | "overdue" | "qualified" | "disqualified" | "converted" | "archived";

type CodeLabel<Code extends string = string> = { code: Code; label: string };

export const DEFAULT_LEAD_STAGES: ReadonlyArray<CodeLabel>;
export const LEAD_STALE_DAYS: number;
export const NEW_STAGE: "new";
export const QUALIFICATION_STAGE: "qualification";
export const LEAD_STATUSES: ReadonlyArray<CodeLabel<LeadStatus>>;
export const LEAD_PRIORITIES: ReadonlyArray<LeadPriority>;
export const LEAD_RATINGS: ReadonlyArray<LeadRating>;
export const LEAD_QUALIFICATION_STATUSES: ReadonlyArray<CodeLabel<LeadQualificationStatus>>;
export const LEAD_NEED_STATUSES: ReadonlyArray<CodeLabel<LeadNeedStatus>>;
export const LEAD_BUDGET_STATUSES: ReadonlyArray<CodeLabel<LeadBudgetStatus>>;
export const LEAD_AUTHORITY_STATUSES: ReadonlyArray<CodeLabel<LeadAuthorityStatus>>;
export const QUALIFICATION_CRITERIA: ReadonlyArray<{ key: LeadQualificationCriterion; label: string; checklist: string }>;
export const DEFAULT_QUALIFICATION_REQUIREMENTS: Readonly<LeadQualificationRequirements>;
export function leadQualificationStatusLabel(code: string): string;
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
  reopen: "crm.leads.reopen"; convert: "crm.leads.convert"; changeStage: "crm.leads.change_stage"; manageStages: "crm.leads.manage_stages";
  overrideQualification: "crm.leads.override_qualification";
  assignSelf: "crm.leads.assign_self"; bulkAssign: "crm.leads.bulk_assign"; assignAcrossTeams: "crm.leads.assign_across_teams";
  manageAssignmentRules: "crm.leads.manage_assignment_rules";
}>;
export type LeadAssignmentMethod = "manual" | "self" | "rule" | "round_robin" | "fallback" | "bulk" | "import" | "creator" | "transfer" | "integration";
export type LeadRuleOperator = "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty";
export const LEAD_ASSIGNMENT_METHODS: ReadonlyArray<CodeLabel<LeadAssignmentMethod>>;
export const LEAD_RULE_FIELDS: ReadonlyArray<{ code: string; label: string; column: string; kind: "source" | "country" | "text" | "choice" }>;
export const LEAD_RULE_OPERATORS: ReadonlyArray<CodeLabel<LeadRuleOperator>>;
export function leadAssignmentMethodLabel(code: string): string;
export const LEAD_VIEWS: ReadonlyArray<{ key: LeadViewKey; label: string }>;
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
  assignedBy: string | null;
  assignedByName: string | null;
  assignmentMethod: LeadAssignmentMethod | null;
  assignmentRuleId: string | null;
  assignmentRuleName: string | null;
  firstActivityAt: string | null;
  stage: LeadStage;
  stageName: string;
  stageChangedAt: string;
  stageAgeDays: number;
  daysSinceActivity: number;
  isStale: boolean;
  status: LeadStatus;
  qualificationStatus: LeadQualificationStatus;
  qualificationStartedAt: string | null;
  needStatus: LeadNeedStatus;
  businessNeed: string | null;
  budgetStatus: LeadBudgetStatus;
  budgetMin: number | null;
  budgetMax: number | null;
  authorityStatus: LeadAuthorityStatus;
  authorityDetail: string | null;
  qualificationNotes: string | null;
  qualificationScore: number;
  suggestedRating: LeadRating;
  qualificationOverrideReason: string | null;
  qualifiedAt: string | null;
  qualifiedBy: string | null;
  qualifiedByName: string | null;
  disqualifiedByName: string | null;
  disqualificationReason: LeadDisqualificationReason | null;
  disqualificationNotes: string | null;
  disqualifiedAt: string | null;
  convertedAt: string | null;
  convertedBy: string | null;
  convertedByName: string | null;
  convertedAccountName: string | null;
  convertedContactName: string | null;
  convertedOpportunityName: string | null;
  convertedOpportunityCode: string | null;
  convertedOpportunityAmount: number | null;
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
  ownerId: string; teamId: string; sourceId: string; tagId: string; createdFrom: string; createdTo: string; qualificationStatus: LeadQualificationStatus; disqualificationReason: string; stale: string; stageEnteredFrom: string; stageEnteredTo: string;
  countryCode: string; state: string; city: string; productInterest: string; olderThanDays: number | string; assignedFrom: string; assignedTo: string;
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

export type LeadRuleCondition = { field: string; operator: LeadRuleOperator; value?: string };
export type LeadAssignmentRule = {
  id: string; name: string; priority: number; isActive: boolean; conditions: LeadRuleCondition[];
  targetType: "user" | "team"; targetUserId: string | null; targetUserName: string | null; targetTeamId: string | null; targetTeamName: string | null;
  strategy: "direct" | "round_robin"; leadCount: number; createdByName: string | null; updatedAt: string;
};
export type LeadAssignmentSettings = {
  allowSelfAssignment: boolean; manualCreationMode: "creator" | "rules"; fallbackMode: "unassigned" | "user" | "team";
  fallbackUserId: string | null; fallbackUserName: string | null; fallbackTeamId: string | null; fallbackTeamName: string | null;
};
export type LeadAssignmentHistoryEntry = {
  id: string; assignedAt: string; method: LeadAssignmentMethod; methodLabel: string; ruleId: string | null; ruleName: string | null;
  previousOwnerName: string | null; newOwnerName: string | null; previousTeamName: string | null; newTeamName: string | null;
  ownerChanged: boolean; teamChanged: boolean; reason: string | null; assignedByName: string | null;
};
export type LeadWorkloadRow = { userId: string; name: string; openLeads: number; qualifiedLeads: number; assignedToday: number; noActivity: number; overdueFollowUps: number };
export type LeadAssignmentInput = {
  ownerUserId?: string | null; teamId?: string | null; reason?: string | null; expectedUpdatedAt?: string | null; moveOpenActivities?: boolean; requestKey?: string | null;
};

export type LeadConversionPreview = {
  lead: Lead;
  canConvert: boolean;
  canCreateContact: boolean;
  blockedReason: string | null;
  accountMatches: Array<{ id: string; name: string; code: string; strength: string }>;
  contactMatches: Array<{ id: string; partyId: string | null; name: string; accountName: string | null; email: string | null; phone: string | null; strength: string }>;
  opportunityMatches: Array<{ id: string; code: string; name: string; amount: number; currencyCode: string | null; partyId: string; stageName: string | null }>;
  stages: Array<{ id: string; name: string; pipelineName: string }>;
  defaults: {
    accountName: string | null; opportunityName: string; amount: number; ownerUserId: string | null;
    accountOwnerUserId: string | null; contactOwnerUserId: string | null; opportunityOwnerUserId: string | null;
  };
};

export type LeadConversionInput = {
  account?: { id?: string; name?: string; ownerUserId?: string; allowDuplicate?: boolean };
  contact?: { id?: string; ownerUserId?: string; allowDuplicate?: boolean };
  opportunity?: { create?: boolean; name?: string; amount?: number | string | null; productInterest?: string; ownerUserId?: string; stageId?: string; expectedCloseDate?: string | null };
};

export type LeadDashboard = {
  period: { from: string; to: string };
  totals: {
    open: number; new: number; unassigned: number; assignedToday: number; noActivity: number; createdInPeriod: number; followUpsDueToday: number; overdueFollowUps: number;
    qualified: number; disqualified: number; converted: number;
    conversionRate: number; stale: number; staleDays: number;
    awaitingQualification: number; inQualification: number; qualifiedTotal: number; qualificationRate: number; averageDaysToQualify: number | null;
  };
  qualifiedByOwner: Array<{ label: string; total: number }>;
  qualifiedBySource: Array<{ label: string; total: number }>;
  byStatus: Array<{ key: LeadStatus; label: string; total: number }>;
  byStage: Array<{ key: LeadStage; label: string; total: number; mine: number; stuck: number; averageAgeDays: number | null }>;
  bySource: Array<{ label: string; total: number }>;
  byOwner: Array<{ label: string; total: number }>;
  byTeam: Array<{ label: string; total: number }>;
  workload: Array<{ userId: string | null; name: string; openLeads: number; overdueFollowUps: number; noActivity: number }>;
};

export type LeadReportRow = { group: string; total: number; open: number; qualified: number; disqualified: number; converted: number; conversionRate: number; estimatedValue: number };
export type LeadsByStatusReport = { groupBy: string; groupLabel: string; rows: LeadReportRow[]; totals: Omit<LeadReportRow, "group" | "conversionRate"> };

export type LeadImportAnalysis = {
  fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string }>;
};
export type LeadImportResult = {
  total: number; created: number; assigned: number; unassigned: number; ownerFallbacks: number; failed: number; duplicates: number;
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
export function createLead(client: QueryClient, context: CrmContext, input: LeadInput, options?: { allowDuplicate?: boolean; origin?: "manual" | "import" | "integration"; routing?: "auto" | "rules" | "fallback" | "none"; assignmentReason?: string | null }): Promise<Lead>;
export function updateLead(client: QueryClient, context: CrmContext, leadId: string, input: LeadInput, options?: { allowDuplicate?: boolean; expectedUpdatedAt?: string | null }): Promise<Lead>;
export function changeLeadStage(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ changed: boolean }>;
export function ensureDefaultLeadStages(client: QueryClient, context: CrmContext): Promise<void>;
export function listLeadStages(client: QueryClient, context: CrmContext, options?: { includeInactive?: boolean }): Promise<LeadStageDefinition[]>;
export function createLeadStage(client: QueryClient, context: CrmContext, input: { name: string }): Promise<LeadStageDefinition>;
export function updateLeadStage(client: QueryClient, context: CrmContext, id: string, input: { name?: string; isActive?: boolean }): Promise<LeadStageDefinition>;
export function reorderLeadStages(client: QueryClient, context: CrmContext, orderedIds: string[]): Promise<LeadStageDefinition[]>;
export function listLeadStageHistory(client: QueryClient, context: CrmContext, leadId: string): Promise<LeadStageHistoryEntry[]>;
export function bulkChangeLeadStage(client: QueryClient, context: CrmContext, input: { leadIds: string[]; stage: string }): Promise<LeadBulkResult>;
export function archiveLead(client: QueryClient, context: CrmContext, leadId: string): Promise<{ changed: boolean }>;
export function restoreLead(client: QueryClient, context: CrmContext, leadId: string): Promise<{ changed: boolean }>;

// assignment
export type LeadTeamOption = { id: string; name: string; managerUserId: string | null; memberIds: string[] };
export function assertEligibleLeadAssignee(client: QueryClient, context: CrmContext, userId: string, options?: { teamId?: string | null }): Promise<{ id: string; full_name: string }>;
export function listLeadAssignmentOptions(client: QueryClient, context: CrmContext): Promise<{ users: Array<{ id: string; name: string; email: string }>; teams: LeadTeamOption[] }>;
export function assignLead(client: QueryClient, context: CrmContext, leadId: string, input: LeadAssignmentInput): Promise<{ changed: boolean }>;
export function reassignLead(client: QueryClient, context: CrmContext, leadId: string, input: LeadAssignmentInput): Promise<{ changed: boolean }>;
export function assignLeadToTeam(client: QueryClient, context: CrmContext, leadId: string, input: LeadAssignmentInput): Promise<{ changed: boolean }>;
export function assignLeadToSelf(client: QueryClient, context: CrmContext, leadId: string, input?: LeadAssignmentInput): Promise<{ changed: boolean }>;
export function unassignLead(client: QueryClient, context: CrmContext, leadId: string, input?: LeadAssignmentInput): Promise<{ changed: boolean }>;
export function bulkAssignLeads(client: QueryClient, context: CrmContext, input: LeadAssignmentInput & { leadIds: string[] }): Promise<LeadBulkResult>;
export function countUserActiveLeads(client: QueryClient, context: CrmContext, userId: string): Promise<{ total: number; open: number; qualified: number }>;
export function transferUserLeads(client: QueryClient, context: CrmContext, input: { fromUserId: string; toUserId?: string | null; teamId?: string | null; useRules?: boolean; reason?: string | null }): Promise<{ total: number; moved: number; unassigned: number }>;
export function listLeadAssignmentHistory(client: QueryClient, context: CrmContext, leadId: string): Promise<LeadAssignmentHistoryEntry[]>;
export function getLeadAssignmentWorkload(client: QueryClient, context: CrmContext): Promise<LeadWorkloadRow[]>;

// assignment rules and settings
export function getLeadAssignmentSettings(client: QueryClient, context: CrmContext): Promise<LeadAssignmentSettings>;
export function saveLeadAssignmentSettings(client: QueryClient, context: CrmContext, input: Partial<LeadAssignmentSettings>): Promise<LeadAssignmentSettings>;
export function listLeadAssignmentRules(client: QueryClient, context: CrmContext): Promise<LeadAssignmentRule[]>;
export function saveLeadAssignmentRule(client: QueryClient, context: CrmContext, id: string | null, input: Record<string, unknown>): Promise<LeadAssignmentRule>;
export function setLeadAssignmentRuleActive(client: QueryClient, context: CrmContext, id: string, isActive: boolean): Promise<{ changed: boolean }>;
export function reorderLeadAssignmentRules(client: QueryClient, context: CrmContext, orderedIds: string[]): Promise<LeadAssignmentRule[]>;
export function deleteLeadAssignmentRule(client: QueryClient, context: CrmContext, id: string): Promise<void>;
export function evaluateLeadAssignment(client: QueryClient, context: CrmContext, lead: Partial<Lead>, options?: { excludeUserId?: string | null }): Promise<{ ownerUserId: string | null; teamId: string | null; method: LeadAssignmentMethod | null; rule: { id: string; name: string } | null }>;
export function runLeadAssignmentRules(client: QueryClient, context: CrmContext, leadId: string, input?: { reason?: string }): Promise<{ changed: boolean; matched: boolean; ruleName?: string | null; method?: LeadAssignmentMethod; message?: string }>;

// qualification
export type LeadQualificationEvent = {
  id: string; eventType: string; summary: string; field: string | null; oldValue: string | null; newValue: string | null; notes: string | null;
  changedAt: string; changedByName: string | null;
};
export type LeadQualificationChecklistItem = { key: string; label: string; done: boolean; required: boolean; value: string | null };
export type LeadQualificationView = {
  leadId: string; status: LeadQualificationStatus; requirements: LeadQualificationRequirements; checklist: LeadQualificationChecklistItem[];
  missing: Array<{ key: LeadQualificationCriterion; label: string }>; score: number; suggestedRating: LeadRating; canOverride: boolean; history: LeadQualificationEvent[];
};
export function evaluateLeadQualification(row: Record<string, unknown>, requirements?: LeadQualificationRequirements): Pick<LeadQualificationView, "checklist" | "missing" | "score" | "suggestedRating">;
export function getLeadQualificationSettings(client: QueryClient, context: CrmContext): Promise<LeadQualificationRequirements>;
export function saveLeadQualificationSettings(client: QueryClient, context: CrmContext, input: Partial<LeadQualificationRequirements>): Promise<LeadQualificationRequirements>;
export function getLeadQualification(client: QueryClient, context: CrmContext, leadId: string): Promise<LeadQualificationView>;
export function listLeadQualificationHistory(client: QueryClient, context: CrmContext, leadId: string): Promise<LeadQualificationEvent[]>;
export function startQualification(client: QueryClient, context: CrmContext, leadId: string): Promise<{ started: boolean; stageChanged: boolean }>;
export function updateQualification(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ changed: boolean; fields: string[] }>;
export function saveLeadQualification(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ changed: boolean; fields: string[] }>;
export function rateLead(client: QueryClient, context: CrmContext, leadId: string, input: { rating: string }): Promise<{ changed: boolean; fields: string[] }>;
export function qualifyLead(client: QueryClient, context: CrmContext, leadId: string, input?: Record<string, unknown>): Promise<{ status: "qualified"; overridden: boolean }>;
export function overrideQualification(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ status: "qualified"; overridden: boolean }>;
export function disqualifyLead(client: QueryClient, context: CrmContext, leadId: string, input: Record<string, unknown>): Promise<{ status: "disqualified" }>;
export function reopenLead(client: QueryClient, context: CrmContext, leadId: string, input?: Record<string, unknown>): Promise<{ status: "open" }>;
export function bulkDisqualifyLeads(client: QueryClient, context: CrmContext, input: { leadIds: string[]; reason: string; notes?: string }): Promise<LeadBulkResult>;

// duplicates and merge
export function findLeadDuplicates(client: QueryClient, context: CrmContext, input: LeadInput, options?: { excludeLeadId?: string | null; limit?: number }): Promise<{ matches: LeadDuplicateMatch[]; hasBlockingMatch: boolean }>;
export function mergeLeads(client: QueryClient, context: CrmContext, duplicateLeadId: string, keepLeadId: string): Promise<{ keptLeadId: string; mergedLeadId: string }>;

// conversion
export function previewLeadConversion(client: QueryClient, context: CrmContext, leadId: string): Promise<LeadConversionPreview>;
export function convertQualifiedLead(client: QueryClient, context: CrmContext, leadId: string, input?: LeadConversionInput): Promise<{ leadId: string; partyId: string; contactId: string | null; opportunityId: string | null }>;
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
export function importLeads(client: QueryClient, context: CrmContext, input: { bytes: Uint8Array; fileName: string; mapping: Record<string, string>; defaultSourceId?: string | null; defaultOwnerUserId?: string | null; skipDuplicates?: boolean; assignmentMode?: "file" | "rules"; invalidOwnerAction?: "error" | "fallback" }): Promise<LeadImportResult>;
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
  stages: LeadStageDefinition[];
  qualificationStage: string;
  staleDays: number;
  statuses: ReadonlyArray<CodeLabel<LeadStatus>>;
  purchaseTimeframes: ReadonlyArray<CodeLabel<LeadPurchaseTimeframe>>;
  disqualificationReasons: ReadonlyArray<CodeLabel<LeadDisqualificationReason>>;
  qualificationStatuses: ReadonlyArray<CodeLabel<LeadQualificationStatus>>;
  needStatuses: ReadonlyArray<CodeLabel<LeadNeedStatus>>;
  budgetStatuses: ReadonlyArray<CodeLabel<LeadBudgetStatus>>;
  authorityStatuses: ReadonlyArray<CodeLabel<LeadAuthorityStatus>>;
  qualificationCriteria: Array<{ key: LeadQualificationCriterion; label: string }>;
  qualificationRequirements: LeadQualificationRequirements;
  activityTypes: ReadonlyArray<CodeLabel>;
  followUpTypes: ReadonlyArray<string>;
  assignmentMethods: ReadonlyArray<CodeLabel<LeadAssignmentMethod>>;
  ruleFields: Array<{ code: string; label: string; kind: "source" | "country" | "text" | "choice" }>;
  ruleOperators: ReadonlyArray<CodeLabel<LeadRuleOperator>>;
  assignment: { allowSelfAssignment: boolean; manualCreationMode: "creator" | "rules" };
  sources: LeadSource[];
  users: Array<{ id: string; name: string; email: string }>;
  teams: LeadTeamOption[];
  tags: LeadTag[];
  currencies: string[];
  baseCurrency: string;
  currentUserId: string;
  capabilities: LeadCapabilities;
};
export function getLeadOptions(client: QueryClient, context: CrmContext): Promise<LeadOptions>;
