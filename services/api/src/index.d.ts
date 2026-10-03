import type { BusinessDataResourceKey } from "@vercentlabs/shared-types";
import type { CrmFoundationContext, PublicMeetingBookingRow, PublicMeetingLinkRow } from "./modules/crm/index.js";

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

export class LeadAttributionError extends Error {
  readonly status: number;
  readonly code: string;
}
export function recordLeadTouchpoint(
  client: QueryClient,
  context: any,
  leadId: string,
  input?: Record<string, unknown>,
): Promise<any>;
export function calculateAttributionWeights(
  touchpoints: Array<{ event_at: string | Date }>,
  model?: "first_touch" | "last_touch" | "linear" | "position_based" | "time_decay",
): number[];

export function listLeadStages(client: QueryClient, context: any, options?: { status?: string }): Promise<any>;
export function classifyLeadStageCustomization(client: QueryClient, context: any, stages: any[]): Promise<"CUSTOMIZED" | "UNTOUCHED_STANDARD_3_STAGE">;
export function previewLeadStageTemplateUpgrade(client: QueryClient, context: any): Promise<{
  stagesToCreate: Array<{ code: string; name: string; description: string }>;
  labelsToChange: unknown[];
  edgesToAdd: Array<{ fromCode: string; toCode: string }>;
  edgesToRemove: unknown[];
  affectedLeadCount: number;
  requiresLeadMigration: boolean;
  conflicts: Array<{ code: string; issue: string }>;
}>;
export function applyLeadStageTemplateUpgrade(client: QueryClient, context: any, input?: { confirm?: boolean }): Promise<{
  applied: boolean;
  stagesCreated: Array<{ code: string; name: string; description: string }>;
  edgesAdded: Array<{ fromCode: string; toCode: string }>;
}>;
export const FIVE_STAGE_LEAD_TEMPLATE: ReadonlyArray<{ code: string; name: string; description: string; sortOrder: number; isInitial: boolean }>;
export const FIVE_STAGE_LEAD_GRAPH: ReadonlyArray<readonly [string, string]>;
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

// F009 opportunity commercial-record child entities.
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
export const OPPORTUNITY_STAGE_MIGRATION_BATCH_SIZE: number;
export function enqueueOpportunityStageMigrationJob(client: QueryClient, context: any, fromStageId: string, toStageId: string): Promise<any>;
export function getOpportunityStageMigrationJob(client: QueryClient, context: any, jobId: string): Promise<any>;

// F010/F012 stage-age computation.
export function computeStageAge(row: Record<string, unknown>, now?: Date): { enteredAt: string | null; ageDays: number | null; maximumDays: number | null; status: "unknown" | "ok" | "warning" | "breached" };

// F010 historical pipeline snapshots.

export type BusinessDataContext = {
  organizationId: string;
  userId: string;
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
    partyTypes?: string[];
  },
): Promise<{
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}>;

export function getBusinessDataRecord(
  client: QueryClient,
  context: BusinessDataContext,
  resource: BusinessDataResourceKey,
  id: string,
): Promise<Record<string, unknown>>;

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
  expectations?: { expectedUpdatedAt?: string },
): Promise<Record<string, unknown>>;

export function archiveBusinessDataRecord(
  client: QueryClient,
  context: BusinessDataContext,
  resource: BusinessDataResourceKey,
  id: string,
  expectations?: { expectedUpdatedAt?: string },
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
export * from "@vercentlabs/reporting-engine";
export * from "./modules/crm/index.js";
export * from "./compat/crm-root-legacy.js";
// Named so the boundary declarations win over the legacy per-file
// declarations reachable through the compatibility barrel.
export {
  CrmPipelineStageSnapshot,
  capturePipelineSnapshots,
  createCrmAttachment,
  crmAttachmentStorageEntityType,
  deleteCrmAttachment,
  getCrmAttachmentContent,
  listCrmAttachmentVersions,
  listCrmAttachments,
  listOpportunityPipelineStageTotals,
  listOpportunityStageAges,
  listPipelineSnapshots,
} from "./modules/crm/index.js";
export * from "./modules/sales/index.js";

export * from "./modules/accounting/index.js";

export * from "./modules/procurement/index.js";
export class CrmFoundationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code?: string);
}
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
export const DUPLICATE_FULL_SCAN_BATCH_SIZE: number;
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
): Promise<Record<string, unknown> | null>;
export function assertEligibleLeadAssignee(
  client: QueryClient,
  context: CrmFoundationContext,
  userId: string,
): Promise<Record<string, unknown>>;

export * from "./modules/sales/quotation-governance.js";

export * from "./modules/sales/order-governance.js";

export * from "./modules/procurement/governance.js";

export * from "./core/release/governance.js";

// F018 shared-inbox reachability — explicit overrides
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

export function publicQuoteTokenHash(token: string): string;
export function resolvePublicQuoteOrganization(queryable: QueryClient, tokenHash: string): Promise<string>;
// F014 public meeting pages (token-resolved, anonymous host context).
export class PublicMeetingError extends Error { readonly status: number; readonly code: string }
export function enqueueLeadScoreRecalcJob(client: QueryClient, context: any, modelId: string): Promise<any>;
export function getLeadScoreRecalcJob(client: QueryClient, context: any, jobId: string): Promise<any>;
export const SCORE_RECALC_BATCH_SIZE: number;
export * from "./modules/stock/index.js";
export * from "./modules/stock/master-operations.js";
export * from "./modules/sales/record-lookups.js";
export * from "./modules/procurement/record-lookups.js";
export * from "./modules/accounting/record-lookups.js";
export * from "./modules/stock/read-models.js";
export * from "./modules/stock/counts.js";
export * from "./modules/stock/valuation.js";
export * from "./modules/stock/quarantine.js";
export { MfgError } from "./modules/manufacturing/common.js";
export * from "./modules/manufacturing/engineering.js";
export * from "./modules/manufacturing/options.js";
export * from "./modules/manufacturing/shopfloor.js";
export * from "./modules/manufacturing/availability.js";
export * from "./modules/manufacturing/execution.js";
export * from "./modules/manufacturing/costing.js";
export * from "./modules/projects/desk.js";
export * from "./modules/assets/desk.js";
export * from "./modules/point-of-sale/index.js";
export { releaseQualityHold } from "./modules/quality/hold-release.js";
export { qualityContext } from "./modules/quality/common.js";
export {
  getQualitySettings, saveQualitySettings, listQualityPlans, getQualityPlan, createQualityPlan as defineQualityPlan, approveQualityPlan, reviseQualityPlan, retireQualityPlan, listInspections, getInspection, createInspection as createQualityInspection, recordInspectionResults, completeInspection as completeQualityInspection, releaseInspection as releaseQualityInspection, cancelInspection as cancelQualityInspection,
} from "./modules/quality/inspections.js";
export {
  listQualityHolds, getQualityHold, createQualityHold, cancelQualityHold, listNonconformances, getNonconformance, createNonconformance as createQualityNonconformance, transitionNonconformance, setDisposition, approveUseAsIs, closeNonconformance, cancelNonconformance,
} from "./modules/quality/nonconformance.js";
export {
  getQualityKpiDashboard, listQualityOptions,
} from "./modules/quality/dashboard.js";
export { supportContext } from "./modules/support/common.js";
export {
  getSupportSettings, saveSupportSettings, listCategories as listSupportCategories, saveCategory as saveSupportCategory, createTicket, listTickets, getTicket, updateTicket, assignTicket, transitionTicket, listCommunications, addCommunication, listAttachments, addAttachment, removeAttachment, getAttachmentContent as getSupportAttachmentContent, getTicketHistory,
} from "./modules/support/tickets.js";
export {
  getSupportDeskDashboard, listSupportOptions, listCustomerContacts,
} from "./modules/support/service.js";
// F015-F114 public API declarations.
export function listCrmTasks(client: QueryClient, context: any, filters?: Record<string, unknown>): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmTask(client: QueryClient, context: any, id: string, options?: { lock?: boolean }): Promise<any>;
export function createCrmTask(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function updateCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function startCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function completeCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function cancelCrmTask(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function listCrmTaskHistory(client: QueryClient, context: any, id: string): Promise<any[]>;
// F017 canonical governed-attachment domain.

export function listSalesPass1Operations(client: QueryClient, context: any, options?: { kind?: string; limit?: number }): Promise<any[]>;
export function requestSalesCreditAdjustment(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function accrueSalesCommission(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function upsertSalesPriceListItem(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function upsertSalesCustomerPrice(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function deactivateSalesPriceListItem(client: QueryClient, context: any, priceListItemId: string): Promise<any>;
export function deactivateSalesPricingRule(client: QueryClient, context: any, pricingRuleId: string): Promise<any>;
export function listSalesPass1Options(client: QueryClient, context: any): Promise<Record<string, any[]>>;
export function getSalesOrderLineReservationContext(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function checkSalesOrderLineAvailability(client: QueryClient, salesContext: any, stockContext: any, input?: Record<string, unknown>): Promise<any>;
export function reserveSalesOrderLineFromStock(client: QueryClient, salesContext: any, stockContext: any, input?: Record<string, unknown>): Promise<any>;
export function completeFulfillmentRequestWithStockMovement(client: QueryClient, salesContext: any, stockContext: any, requestId: string, input?: Record<string, unknown>): Promise<any>;
export function releaseSalesOrderStockReservations(client: QueryClient, salesContext: any, stockContext: any, orderId: string, reason: string): Promise<any>;
export function previewSalesOrderAmendmentImpact(client: QueryClient, context: any, orderId: string, input?: Record<string, unknown>): Promise<any>;
export function recordFulfillmentShipment(client: QueryClient, context: any, requestId: string, input?: Record<string, unknown>): Promise<any>;
export function recordFulfillmentDelivery(client: QueryClient, context: any, requestId: string, input?: Record<string, unknown>): Promise<any>;
export function getSalesCustomerCreditExposure(client: QueryClient, context: any, partyId: string): Promise<any>;
export function decideSalesCreditAdjustment(client: QueryClient, context: any, adjustmentId: string, input?: Record<string, unknown>): Promise<any>;
export function confirmSalesOrderWithCrmSync(client: QueryClient, salesContext: any, orderId: string, options?: Record<string, unknown>): Promise<any>;
export function cancelSalesOrderWithCrmSync(client: QueryClient, salesContext: any, orderId: string, reason?: string): Promise<any>;

export function listProcurementPass1Operations(client: QueryClient, context: any, options?: { kind?: string; limit?: number }): Promise<any[]>;
export function linkSupplierAccountingParty(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function listProcurementPass1Options(client: QueryClient, context: any): Promise<Record<string, any[]>>;
export function transitionProcurementReceiptWithStockMovement(client: QueryClient, procurementContext: any, stockContext: any, receiptId: string, action: string, input?: Record<string, unknown>): Promise<any>;
export function runProcurementMatchWithVendorBillImport(client: QueryClient, procurementContext: any, accountingContext: any, input?: Record<string, unknown>): Promise<any>;

export function getStockAvailability(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function reserveStock(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function releaseStockReservation(client: QueryClient, context: any, id: string, options?: { status?: "released" | "cancelled" | "consumed" }): Promise<any>;
export function listStockOperationOptions(client: QueryClient, context: any): Promise<Record<string, any[]>>;

// Wave 0 production-integrity primitives.
export * from "./core/platform/numbering/index.js";
export * from "./core/idempotency.js";
export * from "./core/inventory-lock.js";
export * from "./core/references.js";

// Shared Access public boundary (see core/access/index.js).
export * from "./core/access/index.js";
// Shared Platform domain boundaries.
export * from "./core/auth/index.js";
export * from "./core/security/index.js";
export * from "./core/organization/index.js";
export * from "./core/billing/index.js";
export * from "./core/platform/integrations/api-keys/index.js";
export * from "./core/platform/integrations/oauth/index.js";
export * from "./core/platform/secrets/index.js";
export * from "./core/platform/integrations/inbound-mail/index.js";
export * from "./orchestration/integrations/inbound-mail.js";
export * from "./core/tags.js";
export * from "./core/platform/configuration/index.js";
export * from "./core/platform/privacy/index.js";
export * from "./core/platform/ai/index.js";
export * from "./core/platform/notifications/index.js";
export * from "./core/platform/approvals/index.js";
export * from "./core/platform/jobs/index.js";
export * from "./core/platform/audit/index.js";
export * from "./core/platform/files/index.js";
export * from "./core/platform/mail/index.js";
export * from "./core/platform/data-exchange/index.js";
export * from "./orchestration/data-exchange/registry.js";
export * from "./orchestration/documents/registry.js";
export * from "./orchestration/reporting/datasets.js";
export * from "./orchestration/reporting/service.js";
export * from "./orchestration/reporting/schedules.js";
export * from "./core/platform/reporting/execution-context.js";
export * from "./core/platform/events/index.js";
export * from "./core/platform/workflows/index.js";
export * from "./core/platform/integrations/webhooks/index.js";
export * from "./orchestration/integrations/event-fan-out.js";
export * from "./orchestration/approvals/inbox.js";
export { APPROVAL_COMMAND_REGISTRY, REGISTERED_APPROVAL_COMMAND_KEYS, approvalHref } from "./orchestration/approvals/registry.js";
export * from "./orchestration/search/service.js";
export { SEARCH_PROVIDERS } from "./orchestration/search/providers.js";
export * from "./orchestration/notifications/visibility.js";
export * from "./core/platform/module-administration.js";
export { hrContext, HrError } from "./modules/hr-payroll/common.js";
export * from "./modules/hr-payroll/options.js";
export * from "./modules/hr-payroll/workforce.js";
export {
  listShifts, saveShift, listShiftAssignments, assignShift, listHolidayCalendars, saveHolidayCalendar, listHolidays, addHoliday, removeHoliday, assignHolidayCalendar, punch, recordAttendance, listAttendance, getMyPunchState, getAttendanceSummary, computeAttendanceSummary, recomputeDay,
} from "./modules/hr-payroll/time.js";
export { listLeaveTypes, saveLeaveType, listLeavePolicies, saveLeavePolicy, setPolicyEntry, removePolicyEntry, assignLeavePolicy, listLeaveBalances, getLeaveLedger, adjustLeaveBalance, runLeaveAccrual, runYearEndCarryForward, applyLeave, decideLeave, cancelLeave, listLeaveRequests, getLeaveCalendar, getLeaveDashboard } from "./modules/hr-payroll/leave.js";
export { listSalaryComponents, saveSalaryComponent, listSalaryStructures, getSalaryStructure, createSalaryStructure, updateDraftStructure, submitSalaryStructure, decideSalaryStructure, reviseSalaryStructure, obsoleteSalaryStructure, previewSalaryStructure, listCompensation, proposeCompensation, decideCompensation, getMyCompensation } from "./modules/hr-payroll/compensation.js";
export {
  listPayrollPeriods, generatePayrollPeriods, lockPayrollPeriod, unlockPayrollPeriod, closePayrollPeriod, startPayrollRun, runPayrollCalculation, submitPayrollRun, returnPayrollRun, decidePayrollRun, cancelPayroll, listPayrollExceptions, resolvePayrollException, listPayrollRuns, getPayrollRun, listPayslips, getPayslip, listMyPayslips, verifyPayrollDeterminism, holdPayslip, releasePayslipHold, getPayrollDashboard,
} from "./modules/hr-payroll/payroll.js";
export * from "./core/platform/health/index.js";
