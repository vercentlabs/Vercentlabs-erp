"use client";

// Browser client for the opportunity routes under /api/crm/opportunities.
// One function per opportunity operation; a failed request throws
// OpportunityApiError carrying the server's message and code.
import type { CustomField, CustomValues } from "@/features/crm/shared/fields-api";
import type { CurrencyDisclosure } from "../../shared/ui/UnconvertedNotice";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import type { CampaignOption, CrmTag, MediumOption } from "@/features/crm/shared/marketing-api";

export class OpportunityApiError extends CrmApiErrorWithBody {}

const { request, parseResponse } = crmApiClient(OpportunityApiError, "body");

export type OpportunityStatus = "open" | "won" | "lost";
export type OpportunityPriority = "low" | "medium" | "high";
export type OpportunityViewKey =
  | "all" | "mine" | "team" | "open" | "closing_this_month" | "overdue" | "won" | "lost" | "recent" | "stale" | "archived";

export type Opportunity = {
  id: string;
  code: string;
  name: string;
  accountId: string | null;
  accountName: string | null;
  accountCode: string | null;
  accountIsCustomer: boolean;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  teamId: string | null;
  teamName: string | null;
  stageId: string;
  stageName: string | null;
  pipelineId: string | null;
  pipelineName: string | null;
  // custom fields and recurring revenue (CRM plan 5.3)
  customFields?: CustomValues;
  recurringPlanId?: string | null;
  recurringPlanName?: string | null;
  recurringRevenue?: number | null;
  monthlyRecurringRevenue?: number | null;
  stageCode: string | null;
  stageSequence: number | null;
  stageEnteredAt: string;
  stageAgeDays: number;
  // the stage's time limit in days, and whether the deal has been in the stage longer (CRM plan 5.1)
  stageTimeLimitDays: number | null;
  stageOverdue: boolean;
  stageBeforeCloseName: string | null;
  status: OpportunityStatus;
  priority: OpportunityPriority;
  productInterest: string | null;
  amount: number;
  currencyCode: string | null;
  probability: number;
  probabilityOverridden: boolean;
  probabilitySource: "stage_default" | "manual_override";
  weightedValue: number;
  productsTotal: number;
  productCount: number;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  sourceId: string | null;
  // Where it came from (CRM plan 3.4).
  campaignId?: string | null; campaignName?: string | null; medium?: string | null; mediumLabel?: string | null;
  tags?: CrmTag[];
  sourceName: string | null;
  leadId: string | null;
  leadCode: string | null;
  description: string | null;
  businessProblem: string | null;
  requirements: string | null;
  proposedSolution: string | null;
  commercialNotes: string | null;
  nextStep: string | null;
  nextStepDueAt: string | null;
  nextFollowUpAt: string | null;
  // the open task, follow-up, call or meeting due first
  nextActivity: { subject: string; dueAt: string | null; type: string; dueTimeSet?: boolean } | null;
  hasNoNextActivity: boolean;
  isClosingSoon: boolean;
  hasAcceptedQuotation: boolean;
  lastActivityAt: string | null;
  daysSinceActivity: number;
  isStale: boolean;
  isOverdue: boolean;
  wonAmount: number | null;
  wonAt: string | null;
  wonByName: string | null;
  lostAt: string | null;
  lostByName: string | null;
  lostReasonId: string | null;
  lostReasonName: string | null;
  lossNotes: string | null;
  outcomeNotes: string | null;
  competitorName: string | null;
  closeReasonId: string | null;
  closeReasonName: string | null;
  closeNotes: string | null;
  closedAt: string | null;
  closedByName: string | null;
  duplicateOfOpportunityId: string | null;
  duplicateOfCode: string | null;
  duplicateOfName: string | null;
  winningQuotationId: string | null;
  primaryQuotationId: string | null;
  latestQuotationId: string | null;
  latestQuotationNumber: string | null;
  latestQuotationStatus: string | null;
  latestQuotationTotal: number | null;
  latestQuotationCurrency: string | null;
  latestOrder: { id: string; number: string; status: string; customerPoNumber: string | null; customerPoDate: string | null } | null;
  quotationCount: number;
  // CRM quotes made without the Sales app (crm/quotes).
  crmQuoteCount?: number;
  openTaskCount: number;
  openFollowUpCount: number;
  archivedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
};

export type OpportunityCapabilities = Record<
  | "view" | "viewAll" | "create" | "edit" | "assign" | "reassign" | "changeStage" | "createQuotation" | "quoteInSales" | "quoteInCrm" | "salesInstalled" | "seesSales" | "markWon" | "markLost" | "reopen" | "delete" | "export" | "import"
  | "changeProbability" | "bulkUpdate" | "manageStages",
  boolean
>;

type CodeLabel = { code: string; label: string };
export type OpportunityStageAction = "log_activity" | "schedule_follow_up" | "edit_details" | "add_products" | "create_quotation" | "view_quotations" | "mark_won" | "mark_lost";
export type OpportunityStage = {
  id: string; code: string; name: string; sequence: number; probability: number; isOpen: boolean; openCount?: number;
  // what the stage means, its goals (one per line), and the actions worth putting forward in it
  description: string | null; guidance: string | null; suggestedActions: OpportunityStageAction[];
  // what a deal needs before it may enter the stage (contact, value, close date)
  requirements?: Array<{ key: "contact" | "value" | "closeDate"; label: string }>;
};
// A won or a lost reason, with its own rules (see Won / Lost Reasons).
export type OpportunityCloseReason = {
  id: string; name: string; code: string; outcome: "won" | "lost"; category: string; active: boolean;
  requiresNotes: boolean; capturesCompetitor: boolean; requiresCompetitor: boolean; offersFollowUp: boolean; linksDuplicate: boolean;
};

export type OpportunityPipelineOption = { id: string; name: string; isDefault: boolean; teamId: string | null; stages: OpportunityStage[] };

// The options as they apply to one deal: its own pipeline's stages (the default pipeline's when it has none named).
export function optionsForDeal<T extends OpportunityOptions>(options: T, deal: { pipelineId?: string | null } | null | undefined): T {
  const pipeline = deal?.pipelineId ? options.pipelines?.find((entry) => entry.id === deal.pipelineId) : undefined;
  return pipeline ? { ...options, stages: pipeline.stages } : options;
}

export type OpportunityOptions = {
  views: Array<{ key: OpportunityViewKey; label: string }>;
  statuses: CodeLabel[];
  priorities: CodeLabel[];
  stages: OpportunityStage[];
  // every active pipeline with its open stages (CRM plan 5.1), the default first
  pipelines?: OpportunityPipelineOption[];
  customFields?: CustomField[];
  recurringPlans?: Array<{ id: string; name: string; months: number; isActive: boolean }>;
  wonReasons: OpportunityCloseReason[];
  lostReasons: OpportunityCloseReason[];
  contactRoles: CodeLabel[];
  activityTypes: CodeLabel[];
  followUpTypes: string[];
  // the organization's activity types (CRM plan 5.2), the one list every screen offers
  followUpTypeOptions?: Array<{ id: string; code: string; label: string; kind: string }>;
  sources: Array<{ id: string; name: string }>;
  campaigns?: CampaignOption[];
  mediums?: MediumOption[];
  tags?: CrmTag[];
  users: Array<{ id: string; name: string; email: string }>;
  teams: Array<{ id: string; name: string; memberIds: string[] }>;
  currencies: string[];
  baseCurrency: string;
  staleDays: number;
  currentUserId: string;
  capabilities: OpportunityCapabilities;
};

export type OpportunityListFilters = Partial<Record<`cf.${string}`, string>> & Partial<{
  campaignId: string; medium: string; tagId: string; pipelineId: string; recurringPlanId: string; recurring: string;
  view: OpportunityViewKey; search: string; status: string; stageId: string; ownerId: string; teamId: string; accountId: string; contactId: string;
  product: string; sourceId: string; priority: string; expectedCloseFrom: string; expectedCloseTo: string; valueMin: string; valueMax: string;
  createdFrom: string; createdTo: string; closedFrom: string; closedTo: string; stale: string; highValue: string; noNextActivity: string; ids: string; sortBy: string; sortDirection: "asc" | "desc"; limit: number; offset: number;
}>;

export type OpportunityList = {
  rows: Opportunity[]; total: number; totalValue: number; weightedValue: number; currency: CurrencyDisclosure; limit: number; offset: number; capabilities: OpportunityCapabilities;
};

export type OpportunityBulkResult = { results: Array<{ opportunityId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };
export type OpportunityHistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };
export type OpportunityStageHistoryEntry = {
  id: string; fromStageName: string | null; toStageName: string; status: string; probability: number; probabilityBefore: number | null; note: string | null; outcomeReason: string | null;
  enteredAt: string; leftAt: string | null; changedByName: string | null;
};
export type OpportunityAssignmentEntry = {
  id: string; assignedAt: string; previousOwnerName: string | null; newOwnerName: string | null; previousTeamName: string | null; newTeamName: string | null;
  ownerChanged: boolean; teamChanged: boolean; reason: string | null; assignedByName: string | null;
};
export type OpportunityProductLine = {
  id: string; productId: string; productCode: string | null; productName: string | null; description: string | null; quantity: number; unitPrice: number;
  discountPercent: number; lineTotal: number;
  // A line typed without a catalogue product (Create-Where-You-Are): productName is the name typed.
  unlisted?: boolean;
};
export type OpportunityProductOption = { id: string; code: string; name: string; type: string };
export type OpportunityContact = {
  id: string; contactId: string; name: string; jobTitle: string | null; email: string | null; mobile: string | null; role: string | null; roleLabel: string | null;
  isPrimary: boolean; notes: string | null; isInactive: boolean;
};
export type OpportunityActivity = {
  id: string; type: string; subject: string; notes: string | null; status: string; outcome: string | null; dueAt: string | null; completedAt: string | null;
  createdAt: string; channel: string | null; assignedTo: string | null; assignedName: string | null; createdByName: string | null;
};
export type OpportunityDuplicate = {
  id: string; canOpen: boolean; reasons: string[]; code?: string; name?: string; amount?: number; currencyCode?: string | null; stageName?: string | null;
  ownerName?: string | null;
};
export type OpportunityDashboard = {
  totals: {
    open: number; openValue: number; weightedValue: number; closingThisMonth: number; won: number; wonValue: number; lost: number; lostValue: number; topLostReason: string | null;
    overdue: number; stale: number; staleDays: number; recurringWonMonthly?: number; recurringWonDeals?: number; recurringOpenMonthly?: number; averageDealSize: number; winRate: number | null; lossRate: number | null; averageSalesCycleDays: number | null;
  };
  byStage: Array<{ stageId: string; label: string; total: number; value: number; weightedValue: number }>;
  currency: CurrencyDisclosure;
  // Open deals expected to close from `from` to `to`, by forecast category (cumulative), in the base currency.
  forecast: { from: string; to: string; deals: number; commit: number; bestCase: number; pipeline: number; weighted: number; unconvertedCount: number };
};
export type OpportunityReportRow = { group: string; total: number; open: number; won: number; lost: number; value: number; weightedValue: number; winRate: number | null };
export type OpportunityReport = { groupBy: string; groupLabel: string; reportingCurrency: string; unconverted: number; rows: OpportunityReportRow[]; totals: Omit<OpportunityReportRow, "group" | "winRate"> };

const BASE = "/api/crm/opportunities";

// ---- import (CRM plan 2.5)
export type OpportunityImportAnalysis = {
  fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>;
  suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string }>;
};
export type OpportunityImportResult = {
  total: number; created: number; won: number; lost: number; failed: number; errors: Array<{ row: number; message: string }>; errorCsv: string | null;
};
export const opportunityImportTemplateUrl = `${BASE}/import/template`;
async function upload<T>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return parseResponse<T>(await fetch(url, { method: "POST", body: form }));
}
export const analyzeOpportunityImport = (file: File) =>
  upload<{ analysis: OpportunityImportAnalysis }>(`${BASE}/import/analyze`, file).then((result) => result.analysis);
export const importOpportunities = (file: File, options: { mapping: Record<string, string>; createMissingCompanies: boolean; defaultOwnerUserId?: string }) =>
  upload<{ result: OpportunityImportResult }>(`${BASE}/import`, file, {
    mapping: JSON.stringify(options.mapping),
    createMissingCompanies: String(options.createMissingCompanies),
    defaultOwnerUserId: options.defaultOwnerUserId ?? "",
  }).then((result) => result.result);

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
export const getOpportunityOptions = () => request<{ options: OpportunityOptions }>(`${BASE}/options`).then((result) => result.options);
export const listOpportunities = (filters: OpportunityListFilters = {}) => request<OpportunityList>(`${BASE}${query(filters)}`);
export const getOpportunity = (id: string) => request<{ record: Opportunity }>(`${BASE}/${id}`).then((result) => result.record);
export const createOpportunity = (input: Record<string, unknown>) => post<{ record: Opportunity }>(BASE, input).then((result) => result.record);
export const updateOpportunity = (id: string, input: Record<string, unknown>) =>
  request<{ record: Opportunity }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.record);
export const archiveOpportunity = (id: string, openWork: "keep" | "cancel" = "cancel") => post<{ changed: boolean }>(`${BASE}/${id}/archive?openWork=${openWork}`);
export const restoreOpportunity = (id: string) => post<{ changed: boolean }>(`${BASE}/${id}/restore`);
export const deleteOpportunity = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" });
export const findDuplicateOpportunities = (input: { accountId: string; name?: string; productInterest?: string; excludeId?: string }) =>
  post<{ matches: OpportunityDuplicate[] }>(`${BASE}/duplicates`, input).then((result) => result.matches);

// ---- lifecycle
// warn: true asks the server to refuse a move that deserves a second look; see stageWarningOf.
// Moves an open deal into another pipeline (CRM plan 5.1): into the stage given, else its first.
export const moveOpportunityToPipeline = (id: string, input: { pipelineId: string; stageId?: string; note?: string; expectedUpdatedAt?: string }) =>
  post<{ changed: boolean }>(`${BASE}/${id}/pipeline`, input);
export const changeOpportunityStage = (id: string, input: { stageId: string; note?: string; expectedUpdatedAt?: string; warn?: boolean }) =>
  post<{ changed: boolean }>(`${BASE}/${id}/stage`, input);
export const setOpportunityProbability = (id: string, input: { probability: number; reason?: string }) => post<{ changed: boolean }>(`${BASE}/${id}/probability`, input);
export const markOpportunityWon = (id: string, input: { reasonId: string; actualCloseDate?: string; finalValue?: string | number; winningQuotationId?: string; notes?: string; competitorName?: string; expectedUpdatedAt?: string; openTasks?: "keep" | "cancel"; openFollowUps?: "keep" | "cancel" }) =>
  post<{ status: string }>(`${BASE}/${id}/won`, input);
export const markOpportunityLost = (id: string, input: { reasonId: string; actualCloseDate?: string; notes?: string; competitorName?: string; duplicateOfOpportunityId?: string; followUp?: { date: string; subject?: string }; expectedUpdatedAt?: string; openTasks?: "keep" | "cancel"; openFollowUps?: "keep" | "cancel" }) =>
  post<{ status: string }>(`${BASE}/${id}/lost`, input);
export const reopenOpportunity = (id: string, input: { reason: string; stageId?: string }) => post<{ status: string }>(`${BASE}/${id}/reopen`, input);
export const assignOpportunity = (id: string, input: { ownerUserId?: string | null; teamId?: string | null; reason?: string; expectedUpdatedAt?: string; moveOpenActivities?: boolean }) =>
  post<{ changed: boolean }>(`${BASE}/${id}/assign`, input);
export const bulkOpportunityAction = (input: { action: "assign" | "stage"; opportunityIds: string[] } & Record<string, unknown>) =>
  post<OpportunityBulkResult>(`${BASE}/bulk`, input);

// ---- history
export const listOpportunityHistory = (id: string) => request<{ history: OpportunityHistoryEntry[] }>(`${BASE}/${id}/history`).then((result) => result.history);
export const listOpportunityStageHistory = (id: string) =>
  request<{ history: OpportunityStageHistoryEntry[] }>(`${BASE}/${id}/stage-history`).then((result) => result.history);
export const listOpportunityAssignmentHistory = (id: string) =>
  request<{ history: OpportunityAssignmentEntry[] }>(`${BASE}/${id}/assignment-history`).then((result) => result.history);

// ---- products
export const listOpportunityProducts = (id: string) =>
  request<{ products: { lines: OpportunityProductLine[]; total: number; currencyCode: string | null } }>(`${BASE}/${id}/products`).then((result) => result.products);
export const searchOpportunityProducts = (search: string) =>
  request<{ products: OpportunityProductOption[] }>(`${BASE}/products${query({ search })}`).then((result) => result.products);
export const addOpportunityProduct = (id: string, input: Record<string, unknown>) => post<{ line: OpportunityProductLine }>(`${BASE}/${id}/products`, input);
export const updateOpportunityProduct = (id: string, lineId: string, input: Record<string, unknown>) =>
  request<{ line: OpportunityProductLine }>(`${BASE}/${id}/products/${lineId}`, { method: "PATCH", json: input });
export const removeOpportunityProduct = (id: string, lineId: string) => request<{ removed: boolean }>(`${BASE}/${id}/products/${lineId}`, { method: "DELETE" });

// ---- contacts
export const listOpportunityContacts = (id: string) => request<{ contacts: OpportunityContact[] }>(`${BASE}/${id}/contacts`).then((result) => result.contacts);
export const addOpportunityContact = (id: string, input: Record<string, unknown>) => post<{ contacts: OpportunityContact[] }>(`${BASE}/${id}/contacts`, input);
export const updateOpportunityContact = (id: string, linkId: string, input: Record<string, unknown>) =>
  request<{ contacts: OpportunityContact[] }>(`${BASE}/${id}/contacts/${linkId}`, { method: "PATCH", json: input });
export const removeOpportunityContact = (id: string, linkId: string) => request<{ contacts: OpportunityContact[] }>(`${BASE}/${id}/contacts/${linkId}`, { method: "DELETE" });

// ---- quotations

// ---- work on the deal
export const listOpportunityActivities = (id: string) => request<{ activities: OpportunityActivity[] }>(`${BASE}/${id}/activities`).then((result) => result.activities);
export const logOpportunityActivity = (id: string, input: Record<string, unknown>) => post<{ activityId: string }>(`${BASE}/${id}/activities`, input);
export const scheduleOpportunityFollowUp = (id: string, input: Record<string, unknown>) => post<{ followUp: { id: string } }>(`${BASE}/${id}/follow-ups`, input);

// ---- dashboard, report, export
export const getOpportunityDashboard = (period: { from?: string; to?: string } = {}) =>
  request<{ dashboard: OpportunityDashboard }>(`${BASE}/dashboard${query(period)}`).then((result) => result.dashboard);
export const getOpportunityReport = (filters: Record<string, string>) => request<{ report: OpportunityReport }>(`${BASE}/report${query(filters)}`).then((result) => result.report);
export const opportunityExportUrl = (filters: OpportunityListFilters) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;

// Where the Sales quotation form reads the lines of a quotation started from an opportunity.

// A stage move the server wants confirmed first ("No quotation exists yet"). null for any other failure.
export function stageWarningOf(error: unknown): { warnings: string[]; stageName: string } | null {
  if (!(error instanceof OpportunityApiError) || error.code !== "CRM_OPPORTUNITY_STAGE_WARNING") return null;
  const details = (error.details.details ?? error.details) as { warnings?: string[]; stageName?: string };
  return { warnings: details.warnings ?? [error.message], stageName: details.stageName ?? "this stage" };
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
