"use client";

// Browser client for the opportunity routes under /api/crm/opportunities.
// One function per opportunity operation; a failed request throws
// OpportunityApiError carrying the server's message and code.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class OpportunityApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(OpportunityApiError, "body");

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
  stageCode: string | null;
  stageSequence: number | null;
  stageEnteredAt: string;
  stageAgeDays: number;
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
  nextActivity: { subject: string; dueAt: string | null; type: string } | null;
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
  winningQuotationId: string | null;
  primaryQuotationId: string | null;
  latestQuotationId: string | null;
  latestQuotationNumber: string | null;
  latestQuotationStatus: string | null;
  latestQuotationTotal: number | null;
  latestQuotationCurrency: string | null;
  quotationCount: number;
  openTaskCount: number;
  openFollowUpCount: number;
  archivedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
};

export type OpportunityCapabilities = Record<
  | "view" | "viewAll" | "create" | "edit" | "assign" | "reassign" | "changeStage" | "createQuotation" | "markWon" | "markLost" | "reopen" | "delete" | "export"
  | "changeProbability" | "bulkUpdate" | "manageStages",
  boolean
>;

type CodeLabel = { code: string; label: string };
export type OpportunityStageAction = "log_activity" | "schedule_follow_up" | "edit_details" | "add_products" | "create_quotation" | "view_quotations" | "mark_won" | "mark_lost";
export type OpportunityStage = {
  id: string; code: string; name: string; sequence: number; probability: number; isOpen: boolean; openCount?: number;
  // what the stage means, its goals (one per line), and the actions worth putting forward in it
  description: string | null; guidance: string | null; suggestedActions: OpportunityStageAction[];
};
export type OpportunityLostReason = { id: string; name: string; code: string; requiresNotes: boolean; asksCompetitor: boolean };

export type OpportunityOptions = {
  views: Array<{ key: OpportunityViewKey; label: string }>;
  statuses: CodeLabel[];
  priorities: CodeLabel[];
  stages: OpportunityStage[];
  lostReasons: OpportunityLostReason[];
  contactRoles: CodeLabel[];
  activityTypes: CodeLabel[];
  followUpTypes: string[];
  sources: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string; email: string }>;
  teams: Array<{ id: string; name: string; memberIds: string[] }>;
  currencies: string[];
  baseCurrency: string;
  staleDays: number;
  currentUserId: string;
  capabilities: OpportunityCapabilities;
};

export type OpportunityListFilters = Partial<{
  view: OpportunityViewKey; search: string; status: string; stageId: string; ownerId: string; teamId: string; accountId: string; contactId: string;
  product: string; sourceId: string; priority: string; expectedCloseFrom: string; expectedCloseTo: string; valueMin: string; valueMax: string;
  createdFrom: string; createdTo: string; stale: string; highValue: string; noNextActivity: string; ids: string; sortBy: string; sortDirection: "asc" | "desc"; limit: number; offset: number;
}>;

export type OpportunityList = {
  rows: Opportunity[]; total: number; totalValue: number; weightedValue: number; limit: number; offset: number; capabilities: OpportunityCapabilities;
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
};
export type OpportunityProductOption = { id: string; code: string; name: string; type: string; salesPrice: number };
export type OpportunityContact = {
  id: string; contactId: string; name: string; jobTitle: string | null; email: string | null; mobile: string | null; role: string | null; roleLabel: string | null;
  isPrimary: boolean; notes: string | null; isInactive: boolean;
};
export type OpportunityQuotation = {
  id: string; number: string; version: number; status: string; validUntil: string | null; total: number | null; currencyCode: string | null; ownerName: string | null;
  createdAt: string; salesOrderId: string | null; salesOrderNumber: string | null; isLatest: boolean; isPrimary: boolean; isWinning: boolean;
};
export type OpportunityQuotationDraft = {
  opportunityId: string; partyId: string; contactId: string | null; accountName: string | null; accountIsCustomer: boolean; ownerUserId: string | null;
  currencyCode: string | null; notes: string | null;
  lines: Array<{ itemId: string; name: string; quantity: number; unitPrice: number; discountPercent: number }>;
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
    open: number; openValue: number; weightedValue: number; closingThisMonth: number; wonThisMonth: number; wonValueThisMonth: number; lostThisMonth: number;
    overdue: number; stale: number; staleDays: number; averageDealSize: number; winRate: number; lossRate: number; averageSalesCycleDays: number | null;
  };
  byStage: Array<{ stageId: string; label: string; total: number; value: number; weightedValue: number }>;
};
export type OpportunityReportRow = { group: string; total: number; open: number; won: number; lost: number; value: number; weightedValue: number; winRate: number };
export type OpportunityReport = { groupBy: string; groupLabel: string; rows: OpportunityReportRow[]; totals: Omit<OpportunityReportRow, "group" | "winRate"> };

const BASE = "/api/crm/opportunities";

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
export const archiveOpportunity = (id: string) => post<{ changed: boolean }>(`${BASE}/${id}/archive`);
export const restoreOpportunity = (id: string) => post<{ changed: boolean }>(`${BASE}/${id}/restore`);
export const deleteOpportunity = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" });
export const findDuplicateOpportunities = (input: { accountId: string; name?: string; productInterest?: string; excludeId?: string }) =>
  post<{ matches: OpportunityDuplicate[] }>(`${BASE}/duplicates`, input).then((result) => result.matches);

// ---- lifecycle
// warn: true asks the server to refuse a move that deserves a second look; see stageWarningOf.
export const changeOpportunityStage = (id: string, input: { stageId: string; note?: string; expectedUpdatedAt?: string; warn?: boolean }) =>
  post<{ changed: boolean }>(`${BASE}/${id}/stage`, input);
export const setOpportunityProbability = (id: string, input: { probability: number; reason?: string }) => post<{ changed: boolean }>(`${BASE}/${id}/probability`, input);
export const markOpportunityWon = (id: string, input: { actualCloseDate: string; finalValue?: string | number; winningQuotationId?: string; notes?: string; expectedUpdatedAt?: string; openTasks?: "keep" | "cancel"; openFollowUps?: "keep" | "cancel" }) =>
  post<{ status: string }>(`${BASE}/${id}/won`, input);
export const markOpportunityLost = (id: string, input: { reasonId: string; actualCloseDate?: string; notes?: string; competitorName?: string; expectedUpdatedAt?: string; openTasks?: "keep" | "cancel"; openFollowUps?: "keep" | "cancel" }) =>
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
export const listOpportunityQuotations = (id: string) => request<{ quotations: OpportunityQuotation[] }>(`${BASE}/${id}/quotations`).then((result) => result.quotations);
export const startOpportunityQuotation = (id: string) => post<{ draft: OpportunityQuotationDraft }>(`${BASE}/${id}/quotations`).then((result) => result.draft);
export const setPrimaryOpportunityQuotation = (id: string, quotationId: string | null) =>
  request<{ primaryQuotationId: string | null }>(`${BASE}/${id}/quotations`, { method: "PATCH", json: { quotationId } });

// ---- work on the deal
export const listOpportunityActivities = (id: string) => request<{ activities: OpportunityActivity[] }>(`${BASE}/${id}/activities`).then((result) => result.activities);
export const logOpportunityActivity = (id: string, input: Record<string, unknown>) => post<{ activityId: string }>(`${BASE}/${id}/activities`, input);
export const scheduleOpportunityFollowUp = (id: string, input: Record<string, unknown>) => post<{ followUp: { id: string } }>(`${BASE}/${id}/follow-ups`, input);

// ---- dashboard, report, export
export const getOpportunityDashboard = () => request<{ dashboard: OpportunityDashboard }>(`${BASE}/dashboard`).then((result) => result.dashboard);
export const getOpportunityReport = (filters: Record<string, string>) => request<{ report: OpportunityReport }>(`${BASE}/report${query(filters)}`).then((result) => result.report);
export const opportunityExportUrl = (filters: OpportunityListFilters) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;

// Where the Sales quotation form reads the lines of a quotation started from an opportunity.
export const quotationDraftStorageKey = (opportunityId: string) => `crm.opportunity.quotation-draft.${opportunityId}`;

// A stage move the server wants confirmed first ("No quotation exists yet"). null for any other failure.
export function stageWarningOf(error: unknown): { warnings: string[]; stageName: string } | null {
  if (!(error instanceof OpportunityApiError) || error.code !== "CRM_OPPORTUNITY_STAGE_WARNING") return null;
  const details = (error.details.details ?? error.details) as { warnings?: string[]; stageName?: string };
  return { warnings: details.warnings ?? [error.message], stageName: details.stageName ?? "this stage" };
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
