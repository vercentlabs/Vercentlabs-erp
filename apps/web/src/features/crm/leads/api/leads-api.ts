"use client";

// Browser client for the lead routes under /api/crm/leads. One function per
// lead operation; a failed request throws LeadApiError carrying the server's
// message, code and (for duplicates) the matching records.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class LeadApiError extends CrmApiErrorWithBody {}

const { request, parseResponse } = crmApiClient(LeadApiError, "body");

// A stage code: one of the standard stages or one the organization added.
export type LeadStage = string;
export type LeadStageDefinition = { id: string; code: string; label: string; name: string; sequence: number; isActive: boolean; isSystem: boolean; leadCount?: number };
export type LeadStageHistoryEntry = {
  id: string; fromStage: string | null; fromStageName: string | null; toStage: string; toStageName: string; note: string | null; isAutomatic: boolean;
  enteredAt: string; leftAt: string | null; changedByName: string | null;
};
export type LeadStatus = "open" | "qualified" | "disqualified" | "converted";
export type LeadViewKey = "all" | "mine" | "unassigned" | "no_activity" | "new" | "follow_up" | "due_today" | "overdue" | "qualified" | "disqualified" | "converted" | "archived";
export type LeadQualificationStatus = "not_started" | "in_progress" | "qualified" | "disqualified";
export type LeadQualificationRequirements = Record<"need" | "budget" | "authority" | "timeline", boolean>;

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
  purchaseTimeframe: string | null;
  priority: "low" | "medium" | "high";
  rating: "cold" | "warm" | "hot";
  description: string | null;
  tags: LeadTag[];
  ownerUserId: string | null;
  ownerName: string | null;
  teamId: string | null;
  teamName: string | null;
  assignedAt: string | null;
  assignedByName: string | null;
  assignmentMethod: string | null;
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
  needStatus: "yes" | "no" | "unknown";
  businessNeed: string | null;
  budgetStatus: "confirmed" | "likely" | "unknown" | "no_budget";
  budgetMin: number | null;
  budgetMax: number | null;
  authorityStatus: "decision_maker" | "influencer" | "unknown" | "no_authority";
  authorityDetail: string | null;
  qualificationNotes: string | null;
  qualificationScore: number;
  suggestedRating: "cold" | "warm" | "hot";
  qualificationOverrideReason: string | null;
  qualifiedAt: string | null;
  qualifiedByName: string | null;
  disqualifiedByName: string | null;
  disqualificationReason: string | null;
  disqualificationNotes: string | null;
  disqualifiedAt: string | null;
  convertedAt: string | null;
  convertedPartyId: string | null;
  convertedContactId: string | null;
  convertedOpportunityId: string | null;
  convertedByName: string | null;
  convertedAccountName: string | null;
  convertedContactName: string | null;
  convertedOpportunityName: string | null;
  convertedOpportunityCode: string | null;
  convertedOpportunityAmount: number | null;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
  archivedAt: string | null;
  mergedIntoLeadId: string | null;
  mergedIntoLeadCode: string | null;
  mergedIntoLeadName: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
  sensitiveDataRestricted?: boolean;
};

export type LeadCapabilities = Record<
  "view" | "viewAll" | "viewSensitive" | "create" | "edit" | "delete" | "assign" | "reassign" | "import" | "export" | "qualify" | "disqualify" | "reopen" | "convert"
  | "merge" | "changeStage" | "manageStages" | "overrideQualification" | "assignSelf" | "bulkAssign" | "assignAcrossTeams" | "manageAssignmentRules",
  boolean
>;

type CodeLabel = { code: string; label: string };

export type LeadOptions = {
  views: Array<{ key: LeadViewKey; label: string }>;
  stages: LeadStageDefinition[];
  qualificationStage: string;
  staleDays: number;
  statuses: CodeLabel[];
  purchaseTimeframes: CodeLabel[];
  disqualificationReasons: CodeLabel[];
  qualificationStatuses: CodeLabel[];
  needStatuses: CodeLabel[];
  budgetStatuses: CodeLabel[];
  authorityStatuses: CodeLabel[];
  qualificationCriteria: Array<{ key: string; label: string }>;
  qualificationRequirements: LeadQualificationRequirements;
  activityTypes: CodeLabel[];
  followUpTypes: string[];
  assignmentMethods: CodeLabel[];
  ruleFields: Array<{ code: string; label: string; kind: "source" | "country" | "text" | "choice" }>;
  ruleOperators: CodeLabel[];
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

export type LeadTeamOption = { id: string; name: string; managerUserId: string | null; memberIds: string[] };

export type LeadSource = { id: string; code: string; name: string; description: string | null; isActive: boolean; isSystem: boolean; sortOrder: number; leadCount?: number };

export type LeadListFilters = {
  view?: LeadViewKey;
  search?: string;
  status?: string;
  stage?: string;
  priority?: string;
  rating?: string;
  ownerId?: string;
  teamId?: string;
  sourceId?: string;
  tagId?: string;
  createdFrom?: string;
  createdTo?: string;
  qualificationStatus?: string;
  disqualificationReason?: string;
  stale?: string;
  stageEnteredFrom?: string;
  stageEnteredTo?: string;
  countryCode?: string;
  state?: string;
  city?: string;
  productInterest?: string;
  olderThanDays?: string;
  assignedFrom?: string;
  assignedTo?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type LeadDuplicateMatch = {
  kind: "lead" | "contact" | "account";
  id: string;
  signals: string[];
  strength: "exact" | "possible";
  matchStrength?: "strong" | "possible";
  score?: number;
  reasons?: Array<{ signal: string; label: string; strong: boolean }>;
  isArchived?: boolean;
  isInactive?: boolean;
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

export type LeadBulkResult = { results: Array<{ leadId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };

export type LeadHistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };

export type LeadActivity = {
  id: string;
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
};

export type LeadQualificationView = {
  leadId: string;
  status: LeadQualificationStatus;
  requirements: LeadQualificationRequirements;
  checklist: Array<{ key: string; label: string; done: boolean; required: boolean; value: string | null }>;
  missing: Array<{ key: string; label: string }>;
  score: number;
  suggestedRating: "cold" | "warm" | "hot";
  canOverride: boolean;
  history: Array<{ id: string; eventType: string; summary: string; notes: string | null; changedAt: string; changedByName: string | null }>;
};

export type OpportunityMatch = { id: string; code: string; name: string; amount: number; currencyCode: string | null; partyId: string; stageName: string | null };

export type ConversionMatch = { id: string; name: string; strength: string; code?: string; partyId?: string | null; accountName?: string | null; email?: string | null; phone?: string | null };

export type LeadConversionPreview = {
  lead: Lead;
  canConvert: boolean;
  canCreateContact: boolean;
  blockedReason: string | null;
  accountMatches: ConversionMatch[];
  contactMatches: ConversionMatch[];
  opportunityMatches: OpportunityMatch[];
  stages: Array<{ id: string; name: string; pipelineName: string }>;
  defaults: {
    accountName: string | null; opportunityName: string; amount: number; ownerUserId: string | null;
    accountOwnerUserId: string | null; contactOwnerUserId: string | null; opportunityOwnerUserId: string | null;
  };
};

export type LeadConversionInput = {
  account?: { id?: string; name?: string; ownerUserId?: string; allowDuplicate?: boolean; duplicateReason?: string };
  contact?: { id?: string; ownerUserId?: string; allowDuplicate?: boolean; duplicateReason?: string };
  opportunity?: { create?: boolean; name?: string; amount?: number | string; productInterest?: string; ownerUserId?: string; stageId?: string; expectedCloseDate?: string | null };
};

export type LeadDashboard = {
  period: { from: string; to: string };
  totals: Record<"open" | "new" | "unassigned" | "assignedToday" | "noActivity" | "createdInPeriod" | "followUpsDueToday" | "overdueFollowUps" | "qualified" | "disqualified" | "converted" | "awaitingQualification" | "inQualification" | "qualifiedTotal" | "qualificationRate" | "conversionRate" | "stale" | "staleDays", number> & { averageDaysToQualify: number | null };
  qualifiedByOwner: Array<{ label: string; total: number }>;
  qualifiedBySource: Array<{ label: string; total: number }>;
  byStatus: Array<{ key: string; label: string; total: number }>;
  byStage: Array<{ key: string; label: string; total: number; mine: number; stuck: number; averageAgeDays: number | null }>;
  bySource: Array<{ label: string; total: number }>;
  byOwner: Array<{ label: string; total: number }>;
  byTeam: Array<{ label: string; total: number }>;
  workload: Array<{ userId: string | null; name: string; openLeads: number; overdueFollowUps: number; noActivity: number }>;
};

export type LeadReportRow = { group: string; total: number; open: number; qualified: number; disqualified: number; converted: number; conversionRate: number; estimatedValue: number };
export type LeadReport = { groupBy: string; groupLabel: string; rows: LeadReportRow[]; totals: Omit<LeadReportRow, "group" | "conversionRate"> };

export type LeadRuleCondition = { field: string; operator: string; value?: string };

export type LeadAssignmentRule = {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  conditions: LeadRuleCondition[];
  targetType: "user" | "team";
  targetUserId: string | null;
  targetUserName: string | null;
  targetTeamId: string | null;
  targetTeamName: string | null;
  strategy: "direct" | "round_robin";
  leadCount: number;
  createdByName: string | null;
  updatedAt: string;
};

export type LeadAssignmentSettings = {
  allowSelfAssignment: boolean;
  manualCreationMode: "creator" | "rules";
  fallbackMode: "unassigned" | "user" | "team";
  fallbackUserId: string | null;
  fallbackUserName: string | null;
  fallbackTeamId: string | null;
  fallbackTeamName: string | null;
};

export type LeadAssignmentHistoryEntry = {
  id: string;
  assignedAt: string;
  method: string;
  methodLabel: string;
  ruleName: string | null;
  previousOwnerName: string | null;
  newOwnerName: string | null;
  previousTeamName: string | null;
  newTeamName: string | null;
  ownerChanged: boolean;
  teamChanged: boolean;
  reason: string | null;
  assignedByName: string | null;
};

export type LeadWorkloadRow = { userId: string; name: string; openLeads: number; qualifiedLeads: number; assignedToday: number; noActivity: number; overdueFollowUps: number };

export type LeadAssignmentInput = {
  ownerUserId?: string | null;
  teamId?: string | null;
  reason?: string;
  expectedUpdatedAt?: string;
  moveOpenActivities?: boolean;
};

export type LeadImportAnalysis = {
  fileName: string;
  headers: string[];
  rowCount: number;
  sampleRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>;
  fields: Array<{ key: string; label: string }>;
};

export type LeadImportResult = {
  total: number;
  created: number;
  assigned: number;
  unassigned: number;
  ownerFallbacks: number;
  failed: number;
  duplicates: number;
  possibleDuplicates: number;
  invalid: number;
  errors: Array<{ row: number; message: string; duplicate?: boolean; matchingRecord?: string | null; matchField?: string | null }>;
  errorCsv: string | null;
};

const BASE = "/api/crm/leads";

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const post = <T>(url: string, json: unknown = {}) => request<T>(url, { method: "POST", json });

// ---- options, list, record
export const getLeadOptions = () => request<{ options: LeadOptions }>(`${BASE}/options`).then((result) => result.options);
export const listLeads = (filters: LeadListFilters = {}) =>
  request<{ rows: Lead[]; total: number; limit: number; offset: number; capabilities: LeadCapabilities }>(`${BASE}${query(filters)}`);
export const getLead = (id: string) => request<{ record: Lead }>(`${BASE}/${id}`).then((result) => result.record);
export const createLead = (input: Record<string, unknown>) => post<{ record: Lead }>(BASE, input).then((result) => result.record);
export const updateLead = (id: string, input: Record<string, unknown>) =>
  request<{ record: Lead }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.record);
export const archiveLead = (id: string) => request<{ changed: boolean }>(`${BASE}/${id}`, { method: "DELETE" });
export const restoreLead = (id: string) => post<{ changed: boolean }>(`${BASE}/${id}/restore`);
export const checkLeadDuplicates = (input: Record<string, unknown>) =>
  post<{ matches: LeadDuplicateMatch[]; hasBlockingMatch: boolean }>(`${BASE}/duplicates`, input);
export const mergeLead = (duplicateId: string, keepLeadId: string, choices: Record<string, "keep" | "duplicate"> = {}) =>
  post<{ keptLeadId: string }>(`${BASE}/${duplicateId}/merge`, { keepLeadId, choices });

// ---- lifecycle
export const changeLeadStage = (id: string, stage: string, note?: string) => post<{ changed: boolean }>(`${BASE}/${id}/stage`, { stage, note });
export const listLeadStageHistory = (id: string) => request<{ history: LeadStageHistoryEntry[] }>(`${BASE}/${id}/stage-history`).then((result) => result.history);
export const startLeadQualification = (id: string) => post<{ started: boolean; stageChanged: boolean }>(`${BASE}/${id}/qualification/start`);
export const listLeadStages = (includeInactive = false) =>
  request<{ stages: LeadStageDefinition[] }>(`${BASE}/stages${query({ includeInactive: includeInactive || undefined })}`).then((result) => result.stages);
export const createLeadStage = (name: string) => post<{ stage: LeadStageDefinition }>(`${BASE}/stages`, { name });
export const updateLeadStage = (id: string, input: { name?: string; isActive?: boolean }) =>
  request<{ stage: LeadStageDefinition }>(`${BASE}/stages/${id}`, { method: "PATCH", json: input });
export const reorderLeadStages = (ids: string[]) => post<{ stages: LeadStageDefinition[] }>(`${BASE}/stages/reorder`, { ids });
// ---- assignment
export const assignLead = (id: string, input: LeadAssignmentInput) => post<{ changed: boolean }>(`${BASE}/${id}/assign`, input);
export const assignLeadToMe = (id: string, expectedUpdatedAt?: string) => post<{ changed: boolean }>(`${BASE}/${id}/assign-to-me`, { expectedUpdatedAt });
export const unassignLead = (id: string, input: { reason?: string; expectedUpdatedAt?: string } = {}) => post<{ changed: boolean }>(`${BASE}/${id}/unassign`, input);
export const runLeadAssignmentRules = (id: string) =>
  post<{ changed: boolean; matched: boolean; ruleName?: string | null; message?: string }>(`${BASE}/${id}/run-assignment-rules`);
export const listLeadAssignmentHistory = (id: string) =>
  request<{ history: LeadAssignmentHistoryEntry[] }>(`${BASE}/${id}/assignment-history`).then((result) => result.history);
export const getLeadWorkload = () => request<{ workload: LeadWorkloadRow[] }>(`${BASE}/assignment/workload`).then((result) => result.workload);
export const getUserActiveLeadCount = (userId: string) =>
  request<{ leads: { total: number; open: number; qualified: number } }>(`${BASE}/assignment/transfer${query({ userId })}`).then((result) => result.leads);
export const transferUserLeads = (input: { fromUserId: string; toUserId?: string | null; teamId?: string | null; useRules?: boolean; reason?: string }) =>
  post<{ total: number; moved: number; unassigned: number }>(`${BASE}/assignment/transfer`, input);
export const getLeadAssignmentSettings = () => request<{ settings: LeadAssignmentSettings }>(`${BASE}/assignment-settings`).then((result) => result.settings);
export const saveLeadAssignmentSettings = (input: Partial<LeadAssignmentSettings>) =>
  request<{ settings: LeadAssignmentSettings }>(`${BASE}/assignment-settings`, { method: "PUT", json: input }).then((result) => result.settings);
export const setLeadAssignmentRuleActive = (id: string, isActive: boolean) => post<{ changed: boolean }>(`${BASE}/assignment-rules/${id}/active`, { isActive });
export const reorderLeadAssignmentRules = (ids: string[]) => post<{ rules: LeadAssignmentRule[] }>(`${BASE}/assignment-rules/reorder`, { ids }).then((result) => result.rules);
export const getLeadQualification = (id: string) => request<{ qualification: LeadQualificationView }>(`${BASE}/${id}/qualification`).then((result) => result.qualification);
export const getLeadQualificationSettings = () =>
  request<{ requirements: LeadQualificationRequirements }>(`${BASE}/qualification-settings`).then((result) => result.requirements);
export const saveLeadQualificationSettings = (input: LeadQualificationRequirements) =>
  request<{ requirements: LeadQualificationRequirements }>(`${BASE}/qualification-settings`, { method: "PUT", json: input }).then((result) => result.requirements);
export const saveLeadQualification = (id: string, input: Record<string, unknown>) =>
  request<{ changed: boolean }>(`${BASE}/${id}/qualification`, { method: "PUT", json: input });
export const qualifyLead = (id: string, input: Record<string, unknown> = {}) => post<{ status: string }>(`${BASE}/${id}/qualify`, input);
export const disqualifyLead = (id: string, input: { reason: string; notes?: string }) => post<{ status: string }>(`${BASE}/${id}/disqualify`, input);
export const reopenLead = (id: string, note?: string) => post<{ status: string }>(`${BASE}/${id}/reopen`, { note });
export const bulkLeadAction = (input: { action: "assign" | "stage" | "disqualify"; leadIds: string[] } & Record<string, unknown>) =>
  post<LeadBulkResult>(`${BASE}/bulk`, input);

// ---- conversion
export const getLeadConversionPreview = (id: string) => request<{ preview: LeadConversionPreview }>(`${BASE}/${id}/convert`).then((result) => result.preview);
export const convertLead = (id: string, input: LeadConversionInput) =>
  post<{ conversion: { leadId: string; partyId: string; contactId: string | null; opportunityId: string | null } }>(`${BASE}/${id}/convert`, input).then((result) => result.conversion);

// ---- work on the lead
export const listLeadActivities = (id: string) => request<{ activities: LeadActivity[] }>(`${BASE}/${id}/activities`).then((result) => result.activities);
export const logLeadActivity = (id: string, input: Record<string, unknown>) => post<{ activityId: string; followUpId: string | null }>(`${BASE}/${id}/activities`, input);
export const scheduleLeadFollowUp = (id: string, input: Record<string, unknown>) => post<{ followUp: { id: string } }>(`${BASE}/${id}/follow-ups`, input);
export const listLeadHistory = (id: string) => request<{ history: LeadHistoryEntry[] }>(`${BASE}/${id}/history`).then((result) => result.history);

// ---- dashboard and report
export const getLeadDashboard = (period: { from?: string; to?: string } = {}) =>
  request<{ dashboard: LeadDashboard }>(`${BASE}/dashboard${query(period)}`).then((result) => result.dashboard);
export const getLeadReport = (filters: Record<string, string>) => request<{ report: LeadReport }>(`${BASE}/report${query(filters)}`).then((result) => result.report);

// ---- sources and assignment rules
export const listLeadSources = (includeInactive = false) =>
  request<{ sources: LeadSource[] }>(`${BASE}/sources${query({ includeInactive: includeInactive || undefined })}`).then((result) => result.sources);
export const createLeadSource = (input: { name: string; description?: string }) => post<{ source: LeadSource }>(`${BASE}/sources`, input);
export const updateLeadSource = (id: string, input: Record<string, unknown>) => request<{ source: LeadSource }>(`${BASE}/sources/${id}`, { method: "PATCH", json: input });
export const listLeadAssignmentRules = () => request<{ rules: LeadAssignmentRule[] }>(`${BASE}/assignment-rules`).then((result) => result.rules);
export const saveLeadAssignmentRule = (id: string | null, input: Record<string, unknown>) =>
  id
    ? request<{ rule: LeadAssignmentRule }>(`${BASE}/assignment-rules/${id}`, { method: "PATCH", json: input })
    : post<{ rule: LeadAssignmentRule }>(`${BASE}/assignment-rules`, input);
export const deleteLeadAssignmentRule = (id: string) => request<Record<string, never>>(`${BASE}/assignment-rules/${id}`, { method: "DELETE" });

// ---- import and export
export const leadImportTemplateUrl = `${BASE}/import/template`;
export const leadExportUrl = (filters: LeadListFilters & { ids?: string }) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;

async function upload<T>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return parseResponse<T>(await fetch(url, { method: "POST", body: form }));
}

export const analyzeLeadImport = (file: File) => upload<{ analysis: LeadImportAnalysis }>(`${BASE}/import/analyze`, file).then((result) => result.analysis);
export const importLeads = (file: File, options: {
  mapping: Record<string, string>; defaultSourceId?: string; defaultOwnerUserId?: string; skipDuplicates: boolean;
  assignmentMode: "file" | "rules"; invalidOwnerAction: "error" | "fallback";
}) =>
  upload<{ result: LeadImportResult }>(`${BASE}/import`, file, {
    mapping: JSON.stringify(options.mapping),
    defaultSourceId: options.defaultSourceId ?? "",
    defaultOwnerUserId: options.defaultOwnerUserId ?? "",
    skipDuplicates: String(options.skipDuplicates),
    assignmentMode: options.assignmentMode,
    invalidOwnerAction: options.invalidOwnerAction,
  }).then((result) => result.result);

// The duplicate matches carried by a refused save, if that is why it failed.
export function duplicateMatchesOf(error: unknown): LeadDuplicateMatch[] | null {
  if (error instanceof LeadApiError && error.code === "CRM_LEAD_DUPLICATE") return (error.details.matches as LeadDuplicateMatch[]) ?? [];
  return null;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
