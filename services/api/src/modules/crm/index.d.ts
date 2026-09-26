import type {
  CrmContext,
  CrmListRequest,
  CrmResourceKey,
} from "@vercentlabs/shared-types";
type QueryClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
};
export class CrmError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(
    status: number,
    message: string,
    code?: string,
    details?: Record<string, unknown>,
  );
}
export function isCrmResource(value: string): value is CrmResourceKey;
export function listCrmRecords(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  filters?: CrmListRequest,
): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  id: string,
): Promise<any>;
export function createCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  input: Record<string, unknown>,
): Promise<any>;
export function updateCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  id: string,
  input: Record<string, unknown>,
  expectations?: { expectedUpdatedAt?: string; requireVersion?: boolean },
): Promise<any>;
export function assignLeadOwner(
  client: QueryClient,
  context: CrmContext,
  leadId: string,
  ownerUserId: string | null,
  options?: {
    reason?: string;
    expectedUpdatedAt?: string;
    requireVersion?: boolean;
    override?: boolean;
    overrideReason?: string;
  },
): Promise<any>;
export function listLeadStages(client: QueryClient, context: CrmContext, options?: { status?: string }): Promise<any>;
export function classifyLeadStageCustomization(client: QueryClient, context: CrmContext, stages: any[]): Promise<"CUSTOMIZED" | "UNTOUCHED_STANDARD_3_STAGE">;
export function previewLeadStageTemplateUpgrade(client: QueryClient, context: CrmContext): Promise<{
  stagesToCreate: Array<{ code: string; name: string; description: string }>;
  labelsToChange: unknown[];
  edgesToAdd: Array<{ fromCode: string; toCode: string }>;
  edgesToRemove: unknown[];
  affectedLeadCount: number;
  requiresLeadMigration: boolean;
  conflicts: Array<{ code: string; issue: string }>;
}>;
export function applyLeadStageTemplateUpgrade(client: QueryClient, context: CrmContext, input?: { confirm?: boolean }): Promise<{
  applied: boolean;
  stagesCreated: Array<{ code: string; name: string; description: string }>;
  edgesAdded: Array<{ fromCode: string; toCode: string }>;
}>;
export const FIVE_STAGE_LEAD_TEMPLATE: ReadonlyArray<{ code: string; name: string; description: string; sortOrder: number; isInitial: boolean }>;
export const FIVE_STAGE_LEAD_GRAPH: ReadonlyArray<readonly [string, string]>;
export function getLeadStage(client: QueryClient, context: CrmContext, idOrCode: string): Promise<any>;
export function createLeadStage(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<any>;
export function updateLeadStage(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function reactivateLeadStage(client: QueryClient, context: CrmContext, id: string): Promise<any>;
export function deactivateLeadStageWithMigration(client: QueryClient, context: CrmContext, id: string, options?: { migrateToStageId?: string }): Promise<any>;
export function enqueueLeadStageMigrationJob(client: QueryClient, context: CrmContext, fromStageId: string, toStageId: string): Promise<any>;
export function getLeadStageMigrationJob(client: QueryClient, context: CrmContext, jobId: string): Promise<any>;
export function processLeadStageMigrationBatch(client: QueryClient, systemContext: CrmContext, jobId: string): Promise<any>;
export const STAGE_MIGRATION_JOB_TYPE: string;
export const STAGE_MIGRATION_BATCH_SIZE: number;
export function transitionLeadStage(client: QueryClient, context: CrmContext, leadId: string, input?: Record<string, unknown>, options?: { skipTransitionGraphCheck?: boolean; source?: string }): Promise<any>;
export function listLeadStageHistory(client: QueryClient, context: CrmContext, leadId: string): Promise<any[]>;
export function getLeadStageDwell(client: QueryClient, context: CrmContext, leadId: string): Promise<any>;
export function listLeadStageTransitions(client: QueryClient, context: CrmContext): Promise<any[]>;
export function addLeadStageTransition(client: QueryClient, context: CrmContext, fromStageId: string, toStageId: string, input?: { reasonRequired?: boolean }): Promise<any>;
export function removeLeadStageTransition(client: QueryClient, context: CrmContext, fromStageId: string, toStageId: string): Promise<any>;
export function listLeadStageTransitionReasons(client: QueryClient, context: CrmContext): Promise<any[]>;
export function createLeadStageTransitionReason(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<any>;
export function setLeadStageTransitionReasonActive(client: QueryClient, context: CrmContext, id: string, active: boolean): Promise<any>;
export function findApplicableTransitionReasons(client: QueryClient, context: CrmContext, fromStageId: string, toStageId: string): Promise<any[]>;
export function archiveCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  id: string,
  expectations?: { expectedUpdatedAt?: string; requireVersion?: boolean },
): Promise<any>;
export function convertCrmLead(
  client: QueryClient,
  context: CrmContext,
  leadId: string,
  input?: Record<string, unknown>,
): Promise<any>;
export function mergeCrmLead(
  client: QueryClient,
  context: CrmContext,
  sourceId: string,
  targetId: string,
): Promise<any>;
export function updateOpportunityProbability(
  client: QueryClient,
  context: CrmContext,
  opportunityId: string,
  probability: number,
  note?: string | null,
  expectations?: { expectedUpdatedAt?: string; expectedProbability?: number | null },
): Promise<any>;
export function moveOpportunityStage(
  client: QueryClient,
  context: CrmContext,
  opportunityId: string,
  stageId: string,
  note?: string | null,
  expectations?: {
    expectedUpdatedAt?: string;
    expectedStageId?: string | null;
    outcomeReasonId?: string | null;
    outcomeNotes?: string | null;
  },
): Promise<any>;
export function restoreOpportunity(
  client: QueryClient,
  context: CrmContext,
  opportunityId: string,
  reason: string,
  expectations?: { expectedUpdatedAt?: string },
): Promise<any>;
export type CrmOpportunityProbabilityHistoryEntry = Record<string, unknown> & {
  id: string;
  opportunityId: string;
  fromProbability: number;
  toProbability: number;
  expectedRevenue: number;
  note: string | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
  source: "manual_override" | "stage_default" | "terminal_won" | "terminal_lost" | "reopen" | "restored" | null;
};
export function listOpportunityProbabilityHistory(
  client: QueryClient,
  context: CrmContext,
  opportunityId: string,
  limit?: number,
): Promise<CrmOpportunityProbabilityHistoryEntry[]>;
export type CrmOpportunityPredictiveProbability = {
  predictedProbability: number;
  predictedAmount: number;
  factors: Record<string, unknown> | null;
  modelVersion: string;
  capturedAt: string;
};
export function getOpportunityPredictiveProbability(
  client: QueryClient,
  context: CrmContext,
  opportunityId: string,
): Promise<CrmOpportunityPredictiveProbability | null>;
export function completeCrmActivity(
  client: QueryClient,
  context: CrmContext,
  activityId: string,
  outcome?: string | null,
  expectations?: { expectedUpdatedAt?: string; expectedStatus?: string },
): Promise<any>;
export function getCrmOptions(
  client: QueryClient,
  context: CrmContext,
): Promise<Record<string, any[]>>;
export function getCrmDashboard(
  client: QueryClient,
  context: CrmContext,
  options?: { scope?: string; from?: string; to?: string },
): Promise<any>;
export function getCrmReport(
  client: QueryClient,
  context: CrmContext,
  report: string,
  filters?: Record<string, unknown>,
): Promise<any>;
export class LeadDuplicateError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}
export function evaluateLeadDuplicateRisk(
  client: QueryClient,
  context: CrmContext,
  input: Record<string, unknown>,
  options?: { excludeLeadId?: string | null; lock?: boolean },
): Promise<any>;
export function findCrmDuplicates(
  client: QueryClient,
  context: CrmContext,
  input: Record<string, unknown>,
  excludeId?: string | null,
): Promise<any[]>;
export function resolvePublicCaptureOrganization(queryable: QueryClient, formKey: string): Promise<string | null>;
export function captureCrmLead(
  client: QueryClient,
  formKey: string,
  input: Record<string, unknown>,
  requestContext?: Record<string, unknown>,
): Promise<any>;
export function calculateLeadScore(
  client: QueryClient,
  organizationId: string,
  lead: Record<string, unknown>,
): Promise<number>;
export function runCrmAutomation(
  client: QueryClient,
  context: CrmContext,
  eventType: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<any[]>;
export function listSalesStagePipelines(client: QueryClient, context: CrmContext, options?: { status?: string }): Promise<any[]>;
export function listSalesStages(client: QueryClient, context: CrmContext, options: { pipelineId: string; status?: string }): Promise<{ rows: any[]; total: number }>;
export function getSalesStage(client: QueryClient, context: CrmContext, id: string): Promise<any>;
export function createSalesStage(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<any>;
export function updateSalesStage(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function setSalesStageActive(client: QueryClient, context: CrmContext, id: string, active: boolean, expectedUpdatedAt: string): Promise<any>;
export function reorderSalesStages(client: QueryClient, context: CrmContext, pipelineId: string, entries: Array<{ id: string; expectedUpdatedAt: string }>): Promise<{ changed: boolean; rows: any[] }>;
export function listSalesStageHistory(client: QueryClient, context: CrmContext, pipelineId: string, limit?: number): Promise<any[]>;

export function listCrmCalls(client: QueryClient, context: CrmContext, filters?: Record<string, unknown>): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmCall(client: QueryClient, context: CrmContext, id: string, options?: { lock?: boolean }): Promise<any>;
export function listCrmCallEvents(client: QueryClient, context: CrmContext, activityId: string, limit?: number): Promise<any[]>;
export function createCrmCall(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<any>;
export function updateCrmCall(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function startCrmCall(client: QueryClient, context: CrmContext, id: string, expectations?: Record<string, unknown>): Promise<any>;
export function completeCrmCall(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function cancelCrmCall(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function listCrmMeetings(client: QueryClient, context: CrmContext, filters?: Record<string, unknown>): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmMeeting(client: QueryClient, context: CrmContext, id: string, options?: { lock?: boolean; includeAttendees?: boolean }): Promise<any>;
export function listCrmMeetingEvents(client: QueryClient, context: CrmContext, activityId: string, limit?: number): Promise<any[]>;
export function createCrmMeeting(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<any>;
export function updateCrmMeeting(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function startCrmMeeting(client: QueryClient, context: CrmContext, id: string, expectations?: Record<string, unknown>): Promise<any>;
export function completeCrmMeeting(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function cancelCrmMeeting(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;


export * from "./crm-data-operations-and-customization/custom-field-runtime.js";
export * from "./crm-data-operations-and-customization/tag-assignment.js";

export function listCrmTasks(client: QueryClient, context: CrmContext, filters?: Record<string, unknown>): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmTask(client: QueryClient, context: CrmContext, id: string, options?: { lock?: boolean }): Promise<any>;
export function createCrmTask(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<any>;
export function updateCrmTask(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function startCrmTask(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function completeCrmTask(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function cancelCrmTask(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function listCrmTaskHistory(client: QueryClient, context: CrmContext, id: string): Promise<any[]>;
