import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Input = Record<string, unknown>;
type CodeLabel<Code extends string = string> = { code: Code; label: string };

export type OpportunityStatus = "open" | "won" | "lost";
export type OpportunityPriority = "low" | "medium" | "high";
export type OpportunityViewKey =
  | "all" | "mine" | "team" | "open" | "closing_this_month" | "overdue" | "won" | "lost" | "recent" | "stale" | "archived";
export type OpportunityCapabilities = Record<
  | "view" | "viewAll" | "create" | "edit" | "assign" | "reassign" | "changeStage" | "createQuotation" | "markWon" | "markLost" | "reopen" | "delete" | "export"
  | "changeProbability" | "bulkUpdate" | "manageStages",
  boolean
>;
// An opportunity as the operations return it (see toOpportunity in records.js).
export type Opportunity = Record<string, any> & {
  id: string; code: string; name: string; accountId: string | null; ownerUserId: string | null; teamId: string | null; stageId: string;
  status: OpportunityStatus; priority: OpportunityPriority; amount: number; probability: number; weightedValue: number; updatedAt: string;
};
export type OpportunityBulkResult = { results: Array<{ opportunityId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };

export const OPPORTUNITY_STATUSES: ReadonlyArray<CodeLabel<OpportunityStatus>>;
export const OPPORTUNITY_PRIORITIES: ReadonlyArray<CodeLabel<OpportunityPriority>>;
export const OPPORTUNITY_CONTACT_ROLES: ReadonlyArray<CodeLabel>;
export const DEFAULT_LOST_REASONS: ReadonlyArray<{ code: string; name: string; requiresNotes?: boolean; asksCompetitor?: boolean }>;
export const OPPORTUNITY_ACTIVITY_TYPES: ReadonlyArray<CodeLabel & { activityType: string }>;
export const OPPORTUNITY_FOLLOW_UP_TYPES: ReadonlyArray<string>;
export const OPPORTUNITY_PERMISSIONS: Readonly<Record<
  | "view" | "viewAll" | "create" | "edit" | "assign" | "reassign" | "changeStage" | "createQuotation" | "markWon" | "markLost" | "reopen" | "delete" | "export"
  | "changeProbability" | "bulkUpdate" | "manageStages",
  string
>>;
export const OPPORTUNITY_NUMBER_DOCUMENT_TYPE: string;
export const OPPORTUNITY_STALE_DAYS: number;
export const OPPORTUNITY_VIEWS: ReadonlyArray<{ key: OpportunityViewKey; label: string }>;
export function opportunityStatusLabel(code: string): string;
export function opportunityPriorityLabel(code: string): string;

// ---- access
export function opportunityCan(context: CrmContext, permission: string): boolean;
export function canViewAllOpportunities(context: CrmContext): boolean;
export function opportunityScopeSql(context: CrmContext, values: unknown[], alias?: string): string;
export function opportunityCapabilities(context: CrmContext): OpportunityCapabilities;

// ---- records
export function listOpportunities(client: QueryClient, context: CrmContext, filters?: Input): Promise<{
  opportunities: Opportunity[]; total: number; totalValue: number; weightedValue: number; limit: number; offset: number; capabilities: OpportunityCapabilities;
}>;
export function getOpportunity(client: QueryClient, context: CrmContext, opportunityId: string): Promise<Opportunity>;
export function createOpportunity(
  client: QueryClient, context: CrmContext, input?: Input, options?: { origin?: "manual" | "account" | "lead_conversion"; historySummary?: string | null },
): Promise<Opportunity>;
export function updateOpportunity(
  client: QueryClient, context: CrmContext, opportunityId: string, input?: Input, options?: { expectedUpdatedAt?: string | null },
): Promise<Opportunity>;
export function archiveOpportunity(client: QueryClient, context: CrmContext, opportunityId: string): Promise<{ changed: boolean }>;
export function restoreOpportunity(client: QueryClient, context: CrmContext, opportunityId: string): Promise<{ changed: boolean }>;
export function deleteOpportunity(client: QueryClient, context: CrmContext, opportunityId: string): Promise<{ deleted: boolean }>;
export function findDuplicateOpportunities(
  client: QueryClient, context: CrmContext, input?: Input, options?: { excludeId?: string | null; limit?: number },
): Promise<{ matches: Array<Record<string, any> & { id: string; canOpen: boolean; reasons: string[] }> }>;

// ---- stage, probability and outcome
export function listOpportunityStages(client: QueryClient, context: CrmContext, options?: { pipelineId?: string | null }): Promise<any[]>;
export function changeOpportunityStage(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<{ changed: boolean }>;
export function bulkChangeOpportunityStage(client: QueryClient, context: CrmContext, input?: Input): Promise<OpportunityBulkResult>;
export function setOpportunityProbability(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<{ changed: boolean }>;
export function listOpportunityStageHistory(client: QueryClient, context: CrmContext, opportunityId: string): Promise<any[]>;
export function ensureDefaultLostReasons(client: QueryClient, context: CrmContext): Promise<void>;
export function listOpportunityLostReasons(client: QueryClient, context: CrmContext): Promise<any[]>;
// input.openTasks: "keep" (default) or "cancel" — what happens to the deal's open tasks.
export function markOpportunityWon(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<any>;
export function markOpportunityLost(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<any>;
export function reopenOpportunity(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<any>;
// For callers that hold only a target stage (offline sync, stage migration,
// the Sales order sync): routes to change stage, mark won or mark lost.
export function moveOpportunityStage(
  client: QueryClient, context: CrmContext, opportunityId: string, stageId: string, note?: string | null,
  expectations?: { expectedUpdatedAt?: string; expectedStageId?: string | null; outcomeReasonId?: string | null; outcomeNotes?: string | null },
): Promise<any>;

// ---- ownership
export function assignOpportunity(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input, options?: { notify?: boolean }): Promise<{ changed: boolean }>;
export function reassignOpportunity(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input, options?: { notify?: boolean }): Promise<{ changed: boolean }>;
export function bulkAssignOpportunities(client: QueryClient, context: CrmContext, input?: Input): Promise<OpportunityBulkResult>;
export function listOpportunityAssignmentHistory(client: QueryClient, context: CrmContext, opportunityId: string): Promise<any[]>;

// ---- products, contacts, quotations
export function listOpportunityProducts(client: QueryClient, context: CrmContext, opportunityId: string): Promise<{ lines: any[]; total: number; currencyCode: string | null }>;
export function searchOpportunityProducts(client: QueryClient, context: CrmContext, search?: string): Promise<any[]>;
export function addOpportunityProduct(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<any>;
export function updateOpportunityProduct(client: QueryClient, context: CrmContext, opportunityId: string, lineId: string, input?: Input): Promise<any>;
export function removeOpportunityProduct(client: QueryClient, context: CrmContext, opportunityId: string, lineId: string): Promise<any>;
export function listOpportunityContacts(client: QueryClient, context: CrmContext, opportunityId: string): Promise<any[]>;
export function addOpportunityContact(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<any[]>;
export function updateOpportunityContact(client: QueryClient, context: CrmContext, opportunityId: string, linkId: string, input?: Input): Promise<any[]>;
export function removeOpportunityContact(client: QueryClient, context: CrmContext, opportunityId: string, linkId: string): Promise<any[]>;
export function listOpportunityQuotations(client: QueryClient, context: CrmContext, opportunityId: string): Promise<any[]>;
export function createQuotationFromOpportunity(client: QueryClient, context: CrmContext, opportunityId: string): Promise<Record<string, any> & {
  opportunityId: string; idempotencyKey: string; partyId: string; contactId: string | null; currencyCode: string | null;
  lines: Array<{ itemId: string; name: string; quantity: number; unitPrice: number; discountPercent: number }>;
}>;
export function setPrimaryOpportunityQuotation(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<{ primaryQuotationId: string | null }>;

// ---- work on the deal
export function listOpportunityActivities(client: QueryClient, context: CrmContext, opportunityId: string): Promise<any[]>;
export function addOpportunityActivity(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<{ activityId: string; followUpId: string | null }>;
export function scheduleOpportunityFollowUp(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<any>;
export function listOpportunityHistory(
  client: QueryClient, context: CrmContext, opportunityId: string, options?: { limit?: number; eventTypes?: string[] | null },
): Promise<any[]>;

// ---- options, dashboard, report, export
export function getOpportunityOptions(client: QueryClient, context: CrmContext): Promise<Record<string, any>>;
export function getOpportunityDashboard(client: QueryClient, context: CrmContext): Promise<Record<string, any>>;
export function getOpportunitiesByStageReport(client: QueryClient, context: CrmContext, input?: Input): Promise<Record<string, any>>;
export function exportOpportunities(client: QueryClient, context: CrmContext, filters?: Input): Promise<any>;
