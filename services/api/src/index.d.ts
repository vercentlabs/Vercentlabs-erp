import type { BusinessDataResourceKey } from "@vercentlabs/shared-types";

export type QueryClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount?: number | null;
  }>;
};

export class LeadDuplicateError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}
export function canOverrideLeadDuplicate(context: any): boolean;
export function evaluateLeadDuplicateRisk(
  client: QueryClient,
  context: any,
  input: Record<string, unknown>,
  options?: { excludeLeadId?: string | null; lock?: boolean },
): Promise<{
  classification: "none" | "probable" | "exact";
  matches: Array<Record<string, unknown>>;
  internalMatches: Array<any>;
  canOverride: boolean;
}>;
export function assertLeadDuplicatePolicy(
  client: QueryClient,
  context: any,
  input: Record<string, unknown>,
  options?: {
    excludeLeadId?: string | null;
    lock?: boolean;
    overrideReason?: string | null;
  },
): Promise<any>;
export function recordLeadDuplicateOverride(
  client: QueryClient,
  context: any,
  leadId: string,
  evaluation: any,
  operation: "create" | "update",
): Promise<any>;
export function hasLeadDuplicateIdentityChange(
  input: Record<string, unknown>,
): boolean;
export function dismissLeadDuplicateMatch(
  client: QueryClient,
  context: any,
  leadId: string,
  matchedLeadId: string,
  reason: string,
): Promise<any>;

export function listLeadStages(client: QueryClient, context: any, options?: { status?: string }): Promise<any>;
export function getLeadStage(client: QueryClient, context: any, idOrCode: string): Promise<any>;
export function createLeadStage(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function updateLeadStage(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function reactivateLeadStage(client: QueryClient, context: any, id: string): Promise<any>;
export function deactivateLeadStageWithMigration(client: QueryClient, context: any, id: string, options?: { migrateToStageId?: string }): Promise<any>;
export function enqueueLeadStageMigrationJob(client: QueryClient, context: any, fromStageId: string, toStageId: string): Promise<any>;
export function getLeadStageMigrationJob(client: QueryClient, context: any, jobId: string): Promise<any>;
export function processLeadStageMigrationBatch(client: QueryClient, systemContext: any, jobId: string): Promise<any>;
export const STAGE_MIGRATION_JOB_TYPE: string;
export const STAGE_MIGRATION_BATCH_SIZE: number;
export function transitionLeadStage(client: QueryClient, context: any, leadId: string, input?: Record<string, unknown>, options?: { skipTransitionGraphCheck?: boolean; source?: string }): Promise<any>;
export function listLeadStageHistory(client: QueryClient, context: any, leadId: string): Promise<any[]>;
export function getLeadStageDwell(client: QueryClient, context: any, leadId: string): Promise<any>;
export function listLeadStageTransitions(client: QueryClient, context: any): Promise<any[]>;
export function addLeadStageTransition(client: QueryClient, context: any, fromStageId: string, toStageId: string, input?: { reasonRequired?: boolean }): Promise<any>;
export function removeLeadStageTransition(client: QueryClient, context: any, fromStageId: string, toStageId: string): Promise<any>;
export function listLeadStageTransitionReasons(client: QueryClient, context: any): Promise<any[]>;
export function createLeadStageTransitionReason(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function setLeadStageTransitionReasonActive(client: QueryClient, context: any, id: string, active: boolean): Promise<any>;
export function findApplicableTransitionReasons(client: QueryClient, context: any, fromStageId: string, toStageId: string): Promise<any[]>;
export function listSalesStagePipelines(client: QueryClient, context: any, options?: { status?: string }): Promise<any[]>;
export function listSalesStages(client: QueryClient, context: any, options: { pipelineId: string; status?: string }): Promise<{ rows: any[]; total: number }>;
export function getSalesStage(client: QueryClient, context: any, id: string): Promise<any>;
export function createSalesStage(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function updateSalesStage(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function setSalesStageActive(client: QueryClient, context: any, id: string, active: boolean, expectedUpdatedAt: string): Promise<any>;
export function reorderSalesStages(client: QueryClient, context: any, pipelineId: string, entries: Array<{ id: string; expectedUpdatedAt: string }>): Promise<{ changed: boolean; rows: any[] }>;
export function listSalesStageHistory(client: QueryClient, context: any, pipelineId: string, limit?: number): Promise<any[]>;

// F009 opportunity commercial-record child entities (Prompt 5).
export function listOpportunityItems(client: QueryClient, context: any, opportunityId: string): Promise<any[]>;
export function addOpportunityItem(client: QueryClient, context: any, opportunityId: string, input?: Record<string, unknown>): Promise<any>;
export function updateOpportunityItem(client: QueryClient, context: any, opportunityId: string, itemRowId: string, input?: Record<string, unknown>): Promise<any>;
export function removeOpportunityItem(client: QueryClient, context: any, opportunityId: string, itemRowId: string): Promise<{ removed: boolean }>;
export function listOpportunityTeamMembers(client: QueryClient, context: any, opportunityId: string): Promise<any[]>;
export function addOpportunityTeamMember(client: QueryClient, context: any, opportunityId: string, input?: Record<string, unknown>): Promise<any>;
export function removeOpportunityTeamMember(client: QueryClient, context: any, opportunityId: string, teamMemberId: string): Promise<{ removed: boolean }>;
export function listOpportunityCompetitors(client: QueryClient, context: any, opportunityId: string): Promise<any[]>;
export function addOpportunityCompetitor(client: QueryClient, context: any, opportunityId: string, input?: Record<string, unknown>): Promise<any>;
export function removeOpportunityCompetitor(client: QueryClient, context: any, opportunityId: string, competitorId: string): Promise<{ removed: boolean }>;

// F012 safe stage deactivation + migration job (Prompt 5, mirrors the F007 lead-stage-migration shape).
export const OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE: string;
export const OPPORTUNITY_STAGE_MIGRATION_BATCH_SIZE: number;
export function enqueueOpportunityStageMigrationJob(client: QueryClient, context: any, fromStageId: string, toStageId: string): Promise<any>;
export function getOpportunityStageMigrationJob(client: QueryClient, context: any, jobId: string): Promise<any>;
export function processOpportunityStageMigrationBatch(client: QueryClient, systemContext: any, jobId: string): Promise<any>;

// F010/F012 stage-age computation (Prompt 5).
export function computeStageAge(row: Record<string, unknown>, now?: Date): { enteredAt: string | null; ageDays: number | null; maximumDays: number | null; status: "unknown" | "ok" | "warning" | "breached" };
export function listOpportunityStageAges(client: QueryClient, context: any, pipelineId?: string): Promise<Record<string, { enteredAt: string | null; ageDays: number | null; maximumDays: number | null; status: string }>>;
export function listOpportunityPipelineStageTotals(client: QueryClient, context: any, pipelineId: string | null): Promise<Record<string, { opportunityCount: number; byCurrency: Record<string, { opportunityCount: number; amount: number; weightedAmount: number }> }>>;

// F010 integrity closeout — historical pipeline snapshots (Prompts 1-5).
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
export function capturePipelineSnapshots(client: QueryClient, context: any, options?: { pipelineId?: string; source?: "scheduled" | "manual"; capturedBy?: string | null; snapshotDate?: string }): Promise<{ snapshotDate: string; source: "scheduled" | "manual"; pipelinesProcessed: number; rowsWritten: number; rowsSkippedDuplicate: number }>;
export function listPipelineSnapshots(client: QueryClient, context: any, options?: { pipelineId?: string; limit?: number }): Promise<CrmPipelineStageSnapshot[]>;

export type BusinessDataContext = {
  organizationId: string;
  userId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies: boolean;
};

export class BusinessDataError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code?: string);
}

export function isBusinessDataResource(
  value: string,
): value is BusinessDataResourceKey;

export function listBusinessDataRecords(
  client: QueryClient,
  context: BusinessDataContext,
  resource: BusinessDataResourceKey,
  options?: {
    search?: string;
    status?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}>;

export function createBusinessDataRecord(
  client: QueryClient,
  context: BusinessDataContext,
  resource: BusinessDataResourceKey,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;

export function updateBusinessDataRecord(
  client: QueryClient,
  context: BusinessDataContext,
  resource: BusinessDataResourceKey,
  id: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;

export function archiveBusinessDataRecord(
  client: QueryClient,
  context: BusinessDataContext,
  resource: BusinessDataResourceKey,
  id: string,
): Promise<Record<string, unknown>>;

export function getBusinessDataOptions(
  client: QueryClient,
  context: BusinessDataContext,
): Promise<Record<string, Array<{ id: string; name: string }>>>;

export function getBusinessDataOverview(
  client: QueryClient,
  context: BusinessDataContext,
): Promise<Record<string, number>>;

export function beginImportJob(
  client: QueryClient,
  context: BusinessDataContext,
  resource: BusinessDataResourceKey,
  input: { fileName?: string; totalRows: number; idempotencyKey: string; requestFingerprint: string },
): Promise<{
  id: string; status: string; totalRows: number; processedRows: number; succeededRows: number; failedRows: number;
  errorReport: unknown; resultPayload: unknown; requestFingerprint: string; replayed: boolean;
}>;

export function createImportJob(
  client: QueryClient,
  context: BusinessDataContext,
  resource: BusinessDataResourceKey,
  input: { fileName?: string; totalRows: number },
): Promise<string>;

export function completeImportJob(
  client: QueryClient,
  context: BusinessDataContext,
  jobId: string,
  input: {
    status: "completed" | "completed_with_errors" | "failed";
    processedRows: number;
    succeededRows: number;
    failedRows: number;
    errors?: unknown[];
    resultPayload?: unknown;
  },
): Promise<void>;

export function seedBusinessDataFoundation(
  client: QueryClient,
  context: Pick<BusinessDataContext, "organizationId" | "userId">,
): Promise<void>;
export * from "./modules/crm/index.js";
export * from "./modules/crm/prospect-and-relationship-master-data/account-operations.js";
export * from "./modules/crm/prospect-and-relationship-master-data/contact-operations.js";
export * from "./modules/crm/prospect-and-relationship-master-data/lead-source-operations.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-qualification.js";
export * from "./core/billing.js";
export * from "./modules/sales/index.js";

export * from "./modules/accounting/index.js";

export * from "./modules/procurement/index.js";
export class CrmFoundationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code?: string);
}
export type CrmFoundationContext = Omit<
  BusinessDataContext,
  "allowAllCompanies"
> & {
  allowAllCompanies?: boolean;
};
export function findAccountDuplicates(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function findContactDuplicates(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function mergeAccounts(
  client: QueryClient,
  context: CrmFoundationContext,
  sourceId: string,
  survivorId: string,
  reason?: string | null,
): Promise<Record<string, unknown>>;
export function mergeContacts(
  client: QueryClient,
  context: CrmFoundationContext,
  sourceId: string,
  survivorId: string,
  reason?: string | null,
): Promise<Record<string, unknown>>;
export function getRelationshipGraph(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
): Promise<Array<Record<string, unknown>>>;
export class LeadGovernanceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}
export function getLeadConfiguration(
  client: QueryClient,
  context: CrmFoundationContext,
  recordTypeKey?: string,
): Promise<Record<string, unknown>>;
export function validateLeadInput(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
  recordTypeKey?: string,
): Promise<Record<string, unknown>>;
export function findLeadDuplicates(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
  excludeId?: string | null,
): Promise<Array<Record<string, unknown>>>;
export function resolveLeadOwner(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<string | null>;
export function resolveLeadAssignment(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<{
  ownerUserId: string | null;
  policyId: string | null;
  reason: string;
}>;
export function listEligibleLeadAssignees(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<{
  items: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}>;
export function getEligibleLeadAssignee(
  client: QueryClient,
  context: CrmFoundationContext,
  userId: string,
  scope?: Record<string, unknown>,
): Promise<Record<string, unknown> | null>;
export function assertEligibleLeadAssignee(
  client: QueryClient,
  context: CrmFoundationContext,
  userId: string,
  scope?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
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
): Promise<Record<string, unknown>>;
export function setLeadAssignmentPolicyStatus(
  client: QueryClient,
  context: CrmFoundationContext,
  policyId: string,
  status: "active" | "inactive",
): Promise<Record<string, unknown>>;
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

export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-operations.js";

export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-operations.js";

export * from "./modules/sales/quotation-governance.js";

export * from "./modules/sales/order-governance.js";

export * from "./modules/accounting/receivables-governance.js";

export * from "./modules/accounting/payables-governance.js";

export * from "./modules/accounting/banking-governance.js";

export * from "./modules/accounting/tax-reporting-governance.js";

export * from "./modules/procurement/governance.js";

export * from "./modules/crm/crm-data-operations-and-customization/core-acceptance.js";

export * from "./modules/crm/prospect-and-relationship-master-data/account-intelligence.js";

export * from "./modules/crm/prospect-and-relationship-master-data/contact-relationships.js";
export * from "./modules/crm/prospect-and-relationship-master-data/duplicate-rules.js";
export {
  findLeadContactCrossMatches,
  dismissAccountDuplicateMatch,
  dismissContactDuplicateMatch,
  recordAccountDuplicateOverride,
  recordContactDuplicateOverride,
} from "./modules/crm/prospect-and-relationship-master-data/duplicate-matching.js";

export * from "./core/release/governance.js";

export * from "./modules/crm/seller-activity-and-follow-up-workspace/communications.js";
// F018 closeout (§33 shared-inbox reachability) — explicit overrides
// alongside the wildcard above, matching this file's own established
// pattern for communications.js/lead-intelligence.js functions that need
// one.
export function getCommunicationsDashboard(client: QueryClient, context: any): Promise<{
  summary: Record<string, unknown>;
  inboxes: any[];
  threads: any[];
  upcomingMeetings: any[];
  syncAccounts: any[];
  signatures: any[];
}>;
export function listThreadMessages(client: QueryClient, context: any, threadId: string): Promise<{ thread: any; messages: any[] }>;
export function updateSharedInboxThreadStatus(client: QueryClient, context: any, threadId: string, status: unknown): Promise<any>;

export * from "./modules/crm/prospect-and-relationship-master-data/lead-acquisition.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js";
export function listLeadScoringModels(client: QueryClient, context: any): Promise<any[]>;
export function createLeadScoringModel(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function updateLeadScoringModel(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function activateLeadScoringModel(client: QueryClient, context: any, id: string): Promise<any>;
export function createLeadScoringModelRule(client: QueryClient, context: any, modelId: string, input?: Record<string, unknown>): Promise<any>;
export function setLeadScoringModelRuleStatus(client: QueryClient, context: any, modelId: string, ruleId: string, status: string): Promise<any>;
export function enqueueLeadScoreRecalcJob(client: QueryClient, context: any, modelId: string): Promise<any>;
export function getLeadScoreRecalcJob(client: QueryClient, context: any, jobId: string): Promise<any>;
export function processLeadScoreRecalcBatch(client: QueryClient, systemContext: any, jobId: string): Promise<any>;
export const SCORE_RECALC_JOB_TYPE: string;
export const SCORE_RECALC_BATCH_SIZE: number;
export function scanLeadStageDwellBreaches(client: QueryClient, context: any): Promise<{ scanned: number; notified: number }>;
export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-revenue-intelligence.js";
export * from "./modules/crm/crm-data-operations-and-customization/offline-sync.js";
export * from "./modules/stock/index.js";
export * from "./modules/manufacturing/index.js";
export * from "./modules/projects/index.js";
export * from "./modules/assets/index.js";
export * from "./modules/point-of-sale/index.js";
export * from "./modules/quality/index.js";
export * from "./modules/support/index.js";
export * from "./modules/hr-payroll/index.js";
// Pass 1 F015-F114 public API declarations.
export function listCrmTasks(client: QueryClient, context: any, filters?: Record<string, unknown>): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmTask(client: QueryClient, context: any, id: string, options?: { lock?: boolean }): Promise<any>;
export function createCrmTask(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function updateCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function startCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function completeCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function cancelCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function listCrmTaskHistory(client: QueryClient, context: any, id: string): Promise<any[]>;
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
export function createInAppNotification(client: QueryClient, context: any, input: { userId: string; type: string; category: string; title: string; message: string; href?: string | null }): Promise<boolean>;
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
// Prompt 6 (CRM-CAP-004): F017 canonical governed-attachment domain.
export function crmAttachmentStorageEntityType(entityType: string): string;
export function listCrmAttachments(client: QueryClient, context: any, entityType: string, entityId: string): Promise<any[]>;
export function listCrmAttachmentVersions(client: QueryClient, context: any, entityType: string, entityId: string, logicalId: string): Promise<any[]>;
export function createCrmAttachment(client: QueryClient, context: any, entityType: string, entityId: string, input: { id: string; fileName: string; storageKey: string; mimeType: string; sizeBytes: number; content: Buffer; contentSha256: string; scanStatus: string; replacesLogicalId?: string }): Promise<any>;
export function getCrmAttachmentContent(client: QueryClient, context: any, entityType: string, entityId: string, attachmentId: string): Promise<{ file_name: string; mime_type: string; size_bytes: number; content: any }>;
export function deleteCrmAttachment(client: QueryClient, context: any, entityType: string, entityId: string, attachmentId: string): Promise<any>;

export function listSalesPass1Operations(client: QueryClient, context: any, options?: { kind?: string; limit?: number }): Promise<any[]>;
export function recordSalesAdvancePayment(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function requestSalesCreditAdjustment(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function createSalesDropShipRequest(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function createSalesCommissionRule(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function accrueSalesCommission(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function upsertSalesPriceListItem(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function upsertSalesCustomerPrice(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function deactivateSalesPriceListItem(client: QueryClient, context: any, priceListItemId: string): Promise<any>;
export function deactivateSalesPricingRule(client: QueryClient, context: any, pricingRuleId: string): Promise<any>;
export function listSalesPass1Options(client: QueryClient, context: any): Promise<Record<string, any[]>>;
export function getSalesOrderLineReservationContext(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function listSalesPass1CrossModuleOptions(client: QueryClient, salesContext: any, procurementContext: any): Promise<Record<string, any[]>>;
export function createSalesDropShipWithSupplierValidation(client: QueryClient, salesContext: any, procurementContext: any, input?: Record<string, unknown>): Promise<any>;
export function checkSalesOrderLineAvailability(client: QueryClient, salesContext: any, stockContext: any, input?: Record<string, unknown>): Promise<any>;
export function reserveSalesOrderLineFromStock(client: QueryClient, salesContext: any, stockContext: any, input?: Record<string, unknown>): Promise<any>;
export function completeFulfillmentRequestWithStockMovement(client: QueryClient, salesContext: any, stockContext: any, requestId: string, input?: Record<string, unknown>): Promise<any>;
export function confirmSalesOrderWithCrmSync(client: QueryClient, salesContext: any, orderId: string, options?: Record<string, unknown>): Promise<any>;
export function cancelSalesOrderWithCrmSync(client: QueryClient, salesContext: any, orderId: string, reason?: string): Promise<any>;

export function listProcurementPass1Operations(client: QueryClient, context: any, options?: { kind?: string; limit?: number }): Promise<any[]>;
export function upsertSupplierPurchasePrice(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function createProcurementLandedCost(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function upsertSupplierLeadTime(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function createProcurementReorderRequest(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function createProcurementSubcontractOrder(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function listProcurementPass1Options(client: QueryClient, context: any): Promise<Record<string, any[]>>;
export function generateReorderPurchasingRequests(client: QueryClient, stockContext: any, procurementContext: any, options?: { limit?: number; asOf?: Date }): Promise<{ candidates: number; createdOrReplayed: number; rows: any[] }>;
export function transitionProcurementReceiptWithStockMovement(client: QueryClient, procurementContext: any, stockContext: any, receiptId: string, action: string, input?: Record<string, unknown>): Promise<any>;
export function runProcurementMatchWithVendorBillImport(client: QueryClient, procurementContext: any, accountingContext: any, input?: Record<string, unknown>): Promise<any>;

export function getStockAvailability(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function reserveStock(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function releaseStockReservation(client: QueryClient, context: any, id: string, options?: { status?: "released" | "cancelled" | "consumed" }): Promise<any>;
export function listStockReorderCandidates(client: QueryClient, context: any, options?: { limit?: number }): Promise<any[]>;
export function listStockOperationOptions(client: QueryClient, context: any): Promise<Record<string, any[]>>;




// Wave 0 production-integrity primitives.
export * from "./core/document-numbering.js";
export * from "./core/idempotency.js";
export * from "./core/inventory-lock.js";
export * from "./core/references.js";
