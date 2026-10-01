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
// Context accepted by the CRM foundation APIs (lead assignment policies,
// fallback and availability): a business-data context whose
// allowAllCompanies flag may be omitted.
export type CrmFoundationContext = {
  organizationId: string;
  userId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies?: boolean;
};
export type PublicMeetingLinkRow = { organization_id: string; meeting_link_id: string; owner_user_id: string; [key: string]: any };
export type PublicMeetingBookingRow = { organization_id: string; booking_id: string; host_user_id: string; token_type: string };
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
export type CrmAnalyticsFilters = {
  from?: string; to?: string; asOf?: string; scope?: string; pipelineId?: string; stageId?: string; teamId?: string;
  territoryId?: string; ownerId?: string; sourceId?: string; forecastCategory?: string;
};
export function analyticsFiltersFromSearchParams(searchParams: URLSearchParams): CrmAnalyticsFilters;
export function normalizeAnalyticsFilters(input?: CrmAnalyticsFilters): Required<CrmAnalyticsFilters>;
export const METRIC_VERSION: string;
export const PIPELINE_METRICS: Record<string, { label: string; unit: string; population: string; measure: string; timeBasis: string }>;
export const BREAKDOWN_DIMENSIONS: Record<string, { label: string }>;
export function listMetricDefinitions(): Array<Record<string, any>>;
export function getPipelineMetrics(client: QueryClient, context: CrmContext, filters?: CrmAnalyticsFilters): Promise<any>;
export function getPipelineDashboard(client: QueryClient, context: CrmContext, filters?: CrmAnalyticsFilters): Promise<any>;
export function getPipelineBreakdown(client: QueryClient, context: CrmContext, input: { metric: string; dimension: string; filters?: CrmAnalyticsFilters }): Promise<any>;
export function getMetricRollup(client: QueryClient, context: CrmContext, input: { dimension: string; metrics: string[]; filters?: CrmAnalyticsFilters }): Promise<any>;
export function getMetricDrilldown(client: QueryClient, context: CrmContext, input: { metric: string; filters?: CrmAnalyticsFilters; cursor?: string | null; limit?: number }): Promise<any>;
export function getQuotaSummary(client: QueryClient, context: CrmContext, filters?: CrmAnalyticsFilters, won?: number | null, closing?: number | null): Promise<any>;
export function getUserQuotas(client: QueryClient, context: CrmContext, filters?: CrmAnalyticsFilters): Promise<Map<string, number>>;
export function buildForecastRollup(teams: any[], owners: any[], ownerTeam: Map<string, string | null>): any;
export function getForecastWorkspace(client: QueryClient, context: CrmContext, input: { periodId: string; asOf?: string }): Promise<any>;
export function submitForecast(client: QueryClient, context: CrmContext, input: { periodId: string; commitAmount: number; bestCaseAmount?: number; notes?: string; expectedVersion?: number }): Promise<any>;
export function reviewForecast(client: QueryClient, context: CrmContext, input: { submissionId: string; decision: string; managerAdjustment?: number; reason?: string; expectedVersion?: number }): Promise<any>;
export function listForecastSubmissionEvents(client: QueryClient, context: CrmContext, submissionId: string): Promise<any[]>;
export function captureForecastPeriodSnapshot(client: QueryClient, context: CrmContext, input: { periodId: string; source?: string; captureKey?: string | null; asOf?: string | null }): Promise<any>;
export function captureScheduledForecastSnapshots(client: QueryClient, organizationId: string, input?: { date?: string }): Promise<{ periods: number; captured: number }>;
export function getForecastSnapshot(client: QueryClient, context: CrmContext, captureId: string): Promise<any>;
export function setForecastPeriodStatus(client: QueryClient, context: CrmContext, input: { periodId: string; status: string; expectedUpdatedAt?: string }): Promise<any>;
export function getForecastAccuracy(client: QueryClient, context: CrmContext, input?: { limit?: number; horizonDays?: number; ownerUserId?: string | null }): Promise<any>;
export const COVERAGE_REASSIGN_LIMIT: number;
export function getSalesCoverage(client: QueryClient, context: CrmContext, input?: { asOf?: string }): Promise<any>;
export function listUnassignedRecords(client: QueryClient, context: CrmContext, input: { type: string; cursor?: string | null; limit?: number }): Promise<any>;
export function reassignCoverage(client: QueryClient, context: CrmContext, input: { type: string; ids: string[]; ownerUserId: string | null; reason: string; expectedUpdatedAt?: Record<string, string> }): Promise<any>;
export function transferTerritoryCoverage(client: QueryClient, context: CrmContext, territoryId: string, input: { assigneeType: string; assigneeId: string; effectiveFrom?: string; reason: string }): Promise<any>;
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


export * from "./data-management/custom-field-runtime.js";
export * from "./data-management/tag-assignment.js";

export function listCrmTasks(client: QueryClient, context: CrmContext, filters?: Record<string, unknown>): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmTask(client: QueryClient, context: CrmContext, id: string, options?: { lock?: boolean }): Promise<any>;
export function createCrmTask(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<any>;
export function updateCrmTask(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function startCrmTask(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function completeCrmTask(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function cancelCrmTask(client: QueryClient, context: CrmContext, id: string, input?: Record<string, unknown>): Promise<any>;
export function listCrmTaskHistory(client: QueryClient, context: CrmContext, id: string): Promise<any[]>;

// Declarations for the commands and queries added to the boundary for package
// consumers (@vercentlabs/api/crm); most are re-exported from their owning
// file's declarations.
export {
  completeCrmLeadExportJob,
  enqueueCrmLeadExportJob,
  getCrmLeadExportJob,
  readCrmLeadExportArtifact,
  buildCrmLeadExportCsv,
} from "./data-management/import-export/lead-export.js";
export {
  LEAD_IMPORT_LIMITS,
  commitLeadImport,
  getLeadImportBatch,
  getLeadImportErrorsCsv,
  listCrmLeadImportBatches,
  previewLeadImport,
  processLeadImportChunk,
  rollbackLeadImport,
  finalizeLeadImport,
} from "./data-management/import-export/lead-import.js";
export {
  applyOfflineBatch,
} from "./data-management/offline-sync.js";
export {
  getLeadScoreExplanation,
  openLeadSlaCase,
  recalculateLeadScore,
  recordLeadResponse,
  scanLeadSlaBreaches,
  addBusinessMinutes,
} from "./lead-management/lead-intelligence.js";
export {
  LEAD_BULK_SYNC_LIMIT,
  bulkUpdateLeads,
  enqueueLeadBulkUpdateJob,
  getLeadBulkJob,
  resolveLeadBulkExecutionContext,
} from "./lead-management/lead-operations.js";
export {
  decideLeadQualification,
  getLeadQualification,
} from "./lead-management/lead-qualification.js";
export {
  archiveCrmAccount,
  createCrmAccount,
  getCrmAccountForCaller,
  listCrmAccounts,
  updateCrmAccount,
} from "./master-data/account-operations.js";
export {
  archiveCrmContact,
  createCrmContact,
  getCrmContactForCaller,
  listCrmContacts,
  reactivateCrmContact,
  updateCrmContact,
} from "./master-data/contact-operations.js";
export {
  addContactAccountRelationship,
  listAccountContactRelationships,
  listContactAccountRelationships,
  removeContactAccountRelationship,
  setPrimaryContactAccountRelationship,
  updateContactAccountRelationship,
} from "./master-data/contact-relationships.js";
export {
  findAccountDuplicates,
  findContactDuplicates,
  projectDuplicateMatchesForCaller,
  recordAccountDuplicateOverride,
} from "./master-data/duplicate-matching.js";
export {
  listDuplicateRules,
  setDuplicateRuleEnabled,
  upsertDuplicateRule,
} from "./master-data/duplicate-rules.js";
export {
  queueLeadEnrichment,
  reviewLeadEnrichment,
} from "./master-data/lead-acquisition.js";
export {
  createCrmLeadSource,
  listCrmLeadSources,
  setCrmLeadSourceActive,
  updateCrmLeadSource,
} from "./master-data/lead-source-operations.js";
export {
  addOpportunityContactRole,
  listContactOpportunityRoles,
  listOpportunityContactRoles,
  removeOpportunityContactRole,
  setPrimaryOpportunityContactRole,
  updateOpportunityContactRole,
} from "./pipeline/opportunity-contacts.js";
export {
  bulkUpdateOpportunities,
  enqueueOpportunityBulkUpdateJob,
  getOpportunityBulkJob,
  resolveOpportunityBulkExecutionContext,
} from "./pipeline/opportunity-operations.js";
export {
  capturePredictiveForecast,
  getForecastCalibration,
} from "./pipeline/opportunity-revenue-intelligence.js";
export {
  listOpportunityStageBottlenecks,
  listStageSlaPolicies,
  upsertStageSlaPolicy,
} from "./pipeline/stage-aging.js";

// Declarations previously written inline in services/api/src/index.d.ts.
export type CrmPipelineStageSnapshot = {
  id: string;
  organization_id: string;
  pipeline_id: string;
  company_id: string | null;
  stage_id: string;
  currency_code: string;
  snapshot_date: string;
  opportunity_count: number;
  amount: string;
  weighted_amount: string;
  source: "scheduled" | "manual";
  captured_by: string | null;
  captured_at: string;
};
export function createCrmAttachment(client: QueryClient, context: any, entityType: string, entityId: string, input: { prepared: import("../../core/platform/files/index.js").PreparedUpload; replacesLogicalId?: string | null }, options?: { storage?: import("@vercentlabs/document-engine").ObjectStorage }): Promise<any>;
export function crmAttachmentStorageEntityType(entityType: string): string;
export function deleteCrmAttachment(client: QueryClient, context: any, entityType: string, entityId: string, attachmentId: string): Promise<any>;
export function getCrmAttachmentContent(client: QueryClient, context: any, entityType: string, entityId: string, attachmentId: string, options?: { storage?: import("@vercentlabs/document-engine").ObjectStorage }): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; contentSha256: string | null; body: Buffer }>;
export function listCrmAttachmentVersions(client: QueryClient, context: any, entityType: string, entityId: string, logicalId: string): Promise<any[]>;
export function listCrmAttachments(client: QueryClient, context: any, entityType: string, entityId: string): Promise<any[]>;
export function capturePipelineSnapshots(client: QueryClient, context: any, options?: { pipelineId?: string; source?: "scheduled" | "manual"; capturedBy?: string | null; snapshotDate?: string }): Promise<{ snapshotDate: string; source: "scheduled" | "manual"; pipelinesProcessed: number; rowsWritten: number; rowsSkippedDuplicate: number }>;
export function listPipelineSnapshots(client: QueryClient, context: any, options?: { pipelineId?: string; limit?: number }): Promise<CrmPipelineStageSnapshot[]>;
export function listOpportunityPipelineStageTotals(client: QueryClient, context: any, pipelineId: string | null): Promise<Record<string, { opportunityCount: number; byCurrency: Record<string, { opportunityCount: number; amount: number; weightedAmount: number }> }>>;
export function listOpportunityStageAges(client: QueryClient, context: any, pipelineId?: string): Promise<Record<string, { enteredAt: string | null; ageDays: number | null; maximumDays: number | null; status: string }>>;
export function processOpportunityStageMigrationBatch(client: QueryClient, systemContext: any, jobId: string): Promise<any>;
export function processDuplicateFullScanBatch(client: QueryClient, systemContext: any, jobId: string): Promise<any>;
export function processLeadScoreRecalcBatch(client: QueryClient, systemContext: any, jobId: string): Promise<any>;
export function scanLeadStageDwellBreaches(client: QueryClient, context: any): Promise<{ scanned: number; notified: number }>;
export function dismissLeadDuplicateMatch(
  client: QueryClient,
  context: any,
  leadId: string,
  matchedLeadId: string,
  reason: string,
): Promise<any>;
export function getLeadAttributionTimeline(
  client: QueryClient,
  context: any,
  leadId: string,
  options?: { model?: string },
): Promise<any>;
export function isElevatedLifecycleActor(context: any): boolean;
// F012 safe stage deactivation + migration job (Prompt 5, mirrors the F007 lead-stage-migration shape).
export const OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE: string;
export function deactivateSalesStageWithMigration(client: QueryClient, context: any, id: string, options?: { migrateToStageId?: string; expectedUpdatedAt?: string }): Promise<{ deactivated: boolean; stage: any; migrationJob?: any }>;
export const DUPLICATE_FULL_SCAN_JOB_TYPE: string;
export function enqueueDuplicateFullScan(client: QueryClient, context: any, entityType: string): Promise<any>;
export function getDuplicateFullScanJob(client: QueryClient, context: any, jobId: string): Promise<any>;
export function getLatestDuplicateFullScan(client: QueryClient, context: any, entityType: string): Promise<any>;
export function listDuplicateScanMatches(client: QueryClient, context: any, jobId: string): Promise<any[]>;
// F005 Stage A2 §3 — the type declaration for this function was missing
// even though the runtime export already existed (lead-governance.js
// re-exports assignment/index.js, already reachable via this file's own
// "export * from lead-governance.js"); only the .d.ts surface needed
// this hand-written signature, matching the sibling declarations below.
export function explainLeadAssignmentCandidates(
  client: QueryClient,
  context: CrmFoundationContext,
  memberUserIds: string[],
  input?: { companyId?: string; branchId?: string },
): Promise<Array<{ userId: string; name: string | null; eligible: boolean; reasons: string[] }>>;
export function listLeadAssignmentPolicies(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Array<Record<string, unknown>>>;
export function saveLeadAssignmentPolicy(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function archiveLeadAssignmentPolicy(
  client: QueryClient,
  context: CrmFoundationContext,
  policyId: string,
  expectedUpdatedAt?: string,
): Promise<Record<string, unknown>>;
export function setLeadAssignmentPolicyStatus(
  client: QueryClient,
  context: CrmFoundationContext,
  policyId: string,
  status: "active" | "inactive",
  expectedUpdatedAt?: string,
): Promise<Record<string, unknown>>;
export function matchLeadTerritory(client: QueryClient, context: any, lead: Record<string, unknown>): Promise<{ territoryId: string; code: string; name: string; matchedOn: string[]; alternatives: Array<{ territoryId: string; name: string; matchedOn: string[] }> } | null>;
export function normalizeTerritoryCoverage(value: unknown): Record<string, string[]>;
export const TERRITORY_TYPES: string[];
export function getLeadAssignmentFallback(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function setLeadAssignmentFallback(
  client: QueryClient,
  context: CrmFoundationContext,
  userId: string | null,
): Promise<Record<string, unknown>>;
export function listLeadAssigneeAvailability(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Array<Record<string, unknown>>>;
export function setLeadAssigneeAvailability(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function clearLeadAssigneeAvailability(
  client: QueryClient,
  context: CrmFoundationContext,
  id: string,
): Promise<{ id: string }>;
export function resolvePublicMeetingLink(queryable: QueryClient, token: string): Promise<PublicMeetingLinkRow>;
export function resolvePublicMeetingBooking(queryable: QueryClient, token: string): Promise<PublicMeetingBookingRow>;
export function publicMeetingContext(input: { organizationId: string; hostUserId: string }): any;
export function assertPublicDate(date: string | null): string;
export function getPublicMeetingLinkView(client: QueryClient, link: PublicMeetingLinkRow): Promise<Record<string, unknown>>;
export function getPublicMeetingBookingView(client: QueryClient, booking: PublicMeetingBookingRow): Promise<Record<string, unknown>>;
export function getPublicRescheduleAvailability(client: QueryClient, booking: PublicMeetingBookingRow, date: string | null): Promise<any>;
export function listLeadScoringModels(client: QueryClient, context: any): Promise<any[]>;
export function createLeadScoringModel(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function updateLeadScoringModel(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function activateLeadScoringModel(client: QueryClient, context: any, id: string): Promise<any>;
export function createLeadScoringModelRule(client: QueryClient, context: any, modelId: string, input?: Record<string, unknown>): Promise<any>;
export function setLeadScoringModelRuleStatus(client: QueryClient, context: any, modelId: string, ruleId: string, status: string): Promise<any>;
export function trainLeadScoringModel(client: QueryClient, context: any, modelId: string): Promise<any>;
export const SCORE_RECALC_JOB_TYPE: string;
// Prompt 6 (CRM-CAP-004): F015 recurrence, dependencies, canonical overdue formula.
export function taskOverdueSql(alias?: string): string;
export function computeNextTaskOccurrence(
  config: { freq: "daily" | "weekly" | "monthly"; interval?: number; count?: number; until?: string; byWeekday?: number[] } | null,
  fromDueAt: string,
  occurrenceIndex: number,
): string | null;
export function generateNextTaskOccurrence(client: QueryClient, context: any, completedTask: any): Promise<any | null>;
export function addTaskDependency(client: QueryClient, context: any, taskId: string, dependsOnTaskId: string): Promise<any | null>;
export function removeTaskDependency(client: QueryClient, context: any, taskId: string, dependsOnTaskId: string): Promise<void>;
export function listTaskDependencies(client: QueryClient, context: any, taskId: string): Promise<any[]>;
// Prompt 6 (CRM-CAP-004): F015 team/queue Tasks — real assignment model.
export function claimCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function releaseCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function listMyTaskTeams(client: QueryClient, context: any): Promise<any[]>;
export function listTeamMembers(client: QueryClient, context: any, teamId: string): Promise<any[]>;
// Prompt 6 (CRM-CAP-004): F016 Follow-ups and reminders.
export function listCrmFollowUps(client: QueryClient, context: any, filters?: Record<string, unknown>): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmFollowUp(client: QueryClient, context: any, id: string, options?: { lock?: boolean }): Promise<any>;
export function createCrmFollowUp(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function updateCrmFollowUp(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function snoozeCrmFollowUp(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function completeCrmFollowUp(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function cancelCrmFollowUp(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function listCrmFollowUpHistory(client: QueryClient, context: any, id: string): Promise<any[]>;
export function createRemindersForActivity(client: QueryClient, context: any, activityId: string, dueAt: string, options?: { offsets?: number[]; channel?: "in_app" | "email" }): Promise<any[]>;
export function cancelPendingRemindersForActivity(client: QueryClient, context: any, activityId: string): Promise<void>;
export function listRemindersForActivity(client: QueryClient, context: any, activityId: string): Promise<any[]>;
export function acknowledgeReminder(client: QueryClient, context: any, activityId: string, reminderId: string): Promise<any>;
export function claimDueReminders(client: QueryClient, context: any, options?: { limit?: number }): Promise<any[]>;
export function markReminderOutcome(client: QueryClient, context: any, reminderId: string, options: { status: "sent" | "failed"; failureReason?: string | null }): Promise<void>;
export function resetStuckDispatchingReminders(client: QueryClient, context: any, options?: { olderThanMinutes?: number }): Promise<number>;
export function escalateOverdueFollowUps(client: QueryClient, context: any): Promise<number>;
export function getManagerForUser(client: QueryClient, organizationId: string, userId: string | null): Promise<string | null>;
export function getCrmRecordTimelinePage(
  client: QueryClient,
  context: any,
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign",
  entityId: string,
  options?: { cursor?: string | null; limit?: number; kinds?: Array<"activity" | "communication" | "note" | "attachment"> },
): Promise<{ rows: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string | null }>;
export function getCrmTimelinePageBySource(
  client: QueryClient,
  context: any,
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign",
  entityId: string,
  options: { source: "activity" | "communication" | "note" | "attachment"; offset?: number; limit?: number },
): Promise<{ rows: Array<Record<string, unknown>>; hasMore: boolean }>;
export function resolveCrmEntityAccess(
  client: QueryClient,
  context: any,
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign",
  entityId: string,
): Promise<boolean>;
// Prompt 6 (CRM-CAP-004): F017 canonical Notes domain.
export function listCrmNotes(client: QueryClient, context: any, entityType: string, entityId: string, options?: { includeArchived?: boolean; limit?: number }): Promise<any[]>;
export function getCrmNote(client: QueryClient, context: any, id: string): Promise<any>;
export function createCrmNote(client: QueryClient, context: any, entityType: string, entityId: string, input?: Record<string, unknown>): Promise<any>;
export function updateCrmNote(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function archiveCrmNote(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function listCrmNoteVersions(client: QueryClient, context: any, id: string): Promise<any[]>;

// Declarations kept with the F014/F018 and account-intelligence compatibility
// boundaries (activities/communications.d.ts, master-data/account-intelligence.d.ts).
export {
  bookMeeting,
  cancelMeetingBooking,
  fetchProviderCalendarDelta,
  getCrmEmailHistory,
  getCrmEmailThread,
  getMeetingAvailability,
  pushProviderCalendarEvent,
  recordMeetingCalendarPushResult,
  rescheduleMeetingBooking,
  prepareMeetingCalendarPush,
} from "./activities/communications.js";
export {
  executePrivacyRequest,
  getAccountHierarchy,
  getCustomer360ForCaller,
  getPrivacyRetentionDashboard,
  mergeAccountsGoverned,
  mergeContactsGoverned,
  previewAccountMergeForCaller,
  previewContactMergeForCaller,
  previewPrivacyRequest,
  runPrivacyRetention,
  setAccountParent,
  updatePrivacyRetentionPolicy,
} from "./master-data/account-intelligence.js";

// Record kernel: access scope, outbox and communication access.
export function canViewAllCrmRecords(context: CrmContext): boolean;
export function recordScope(
  definition: { table: string; ownerField?: string; [key: string]: unknown },
  context: CrmContext,
  parameters: unknown[],
  alias?: string,
): string;
export const resources: Readonly<Record<CrmResourceKey, { table: string; ownerField?: string; fields: Record<string, unknown>; [key: string]: unknown }>>;
export function queueOutboxEvent(
  client: QueryClient,
  context: CrmContext,
  eventType: string,
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>,
): Promise<unknown>;
export function leadOutboxChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  requestedFields?: string[],
): string[];
export function communicationVisibilitySql(context: CrmContext, values: unknown[], alias?: string): string;
export function resolveCallerParticipantCommunicationIds(client: QueryClient, context: CrmContext, communicationIds: string[]): Promise<Set<string>>;
export function projectCrmCommunication<T extends Record<string, unknown>>(
  row: T | null | undefined,
  context: CrmContext,
  options?: { isParticipant?: boolean },
): (T & { contentVisibility: "full" }) | (Partial<T> & { contentVisibility: "metadata"; redacted: true }) | null;
export function projectCrmCommunications<T extends Record<string, unknown>>(
  client: QueryClient,
  context: CrmContext,
  rows: T[],
): Promise<Array<(T & { contentVisibility: "full" }) | (Partial<T> & { contentVisibility: "metadata"; redacted: true })>>;
export function resolveCommunicationParticipants(
  client: QueryClient,
  context: CrmContext,
  communicationId: string,
  participants: Array<{ role: string; email: string }>,
): Promise<void>;

// F029 bulk jobs: snapshot the selection a queued job will process.
export function snapshotLeadBulkJobSelection(
  client: QueryClient,
  context: CrmContext,
  jobId: string,
  selection?: Record<string, unknown>,
  options?: { maximum?: number },
): Promise<{ requested: number; snapshotted: number | null }>;
export function snapshotOpportunityBulkJobSelection(
  client: QueryClient,
  context: CrmContext,
  jobId: string,
  selection?: Record<string, unknown>,
  options?: { maximum?: number },
): Promise<{ requested: number; snapshotted: number | null }>;

// Worker entry points (nurture notifications, scheduled calendar sync).
export function claimDueNurtureQueueItems(
  client: QueryClient,
  context: CrmContext,
  options?: { limit?: number },
): Promise<Array<Record<string, unknown> & { lead: Record<string, unknown> | null }>>;
export function claimCalendarSyncAccounts(
  client: QueryClient,
  context: CrmContext,
  options?: { limit?: number },
): Promise<Array<Record<string, unknown>>>;
export function completeCalendarSync(
  client: QueryClient,
  context: CrmContext,
  account: Record<string, unknown>,
  page: Record<string, unknown>,
): Promise<unknown>;
export function failCalendarSync(
  client: QueryClient,
  context: CrmContext,
  account: Record<string, unknown>,
  error: unknown,
): Promise<{ failed: true; code: string }>;
