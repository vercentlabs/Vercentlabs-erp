import type { BusinessDataResourceKey } from "@vercentlabs/shared-types";
import type { CrmFoundationContext } from "./modules/crm/index.js";

export type QueryClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount?: number | null;
  }>;
};







































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
export * from "./core/payment-terms/index.js";
export * from "./core/exchange-rates/index.js";
export * from "./modules/sales/index.js";

export * from "./modules/accounting/index.js";

export * from "./modules/procurement/index.js";
export * from "./modules/procurement/suppliers/index.js";
export * from "./modules/procurement/purchase-orders/index.js";
export * from "./modules/procurement/supplier-bills/index.js";
export * from "./modules/procurement/purchase-returns/index.js";
export * from "./modules/procurement/vendor-credits/index.js";
export * from "./modules/procurement/payment-terms/index.js";
export * from "./modules/procurement/form-options.js";
export * from "./modules/procurement/insights/index.js";
export * from "./modules/procurement/payments/index.js";
export * from "./modules/procurement/chain.js";
export * from "./modules/procurement/indents/index.js";
export * from "./modules/procurement/rfqs/index.js";
export * from "./modules/procurement/rate-contracts/index.js";
export function assertEligibleLeadAssignee(
  client: QueryClient,
  context: CrmFoundationContext,
  userId: string,
): Promise<Record<string, unknown>>;




export * from "./core/release/governance.js";

// F018 shared-inbox reachability — explicit overrides
// alongside the wildcard above, matching this file's own established
// pattern for communications.js/lead-intelligence.js functions that need
// one.
export function getCommunicationsDashboard(client: QueryClient, context: any): Promise<{
  summary: Record<string, unknown>;
  inboxes: any[];
  threads: any[];
  syncAccounts: any[];
  signatures: any[];
}>;
export function listThreadMessages(client: QueryClient, context: any, threadId: string): Promise<{ thread: any; messages: any[] }>;
export function updateSharedInboxThreadStatus(client: QueryClient, context: any, threadId: string, status: unknown): Promise<any>;

// F014 public meeting pages (token-resolved, anonymous host context).



export * from "./modules/stock/index.js";
export * from "./modules/stock/master-operations.js";
export * from "./modules/accounting/record-lookups.js";
export * from "./modules/stock/stock-counts.js";
export * from "./modules/stock/valuation.js";
export * from "./modules/stock/quality-holds.js";
export * from "./modules/stock/warehouses.js";
export * from "./modules/stock/opening-stock.js";
export * from "./modules/stock/balances.js";
export * from "./modules/stock/ledger.js";
export * from "./modules/stock/movement-history.js";
export * from "./modules/stock/reorder.js";
export * from "./modules/stock/low-stock-alerts.js";
export * from "./modules/stock/overview.js";
export * from "./modules/stock/tracking-detail.js";
export * from "./modules/stock/inventory-reports.js";
export * from "./modules/related/index.js";
export * from "./modules/stock/goods-issues.js";
export * from "./modules/stock/transfers.js";
export * from "./modules/stock/adjustments.js";
export * from "./modules/stock/reservations.js";
export * from "./modules/stock/negative-stock.js";
export { NEGATIVE_OVERRIDE_REASONS, NEGATIVE_STOCK_POLICIES, NEGATIVE_STOCK_CODES, recordBlockedNegativeStockAttempt } from "./modules/stock/negative-stock-control.js";
export { MfgError, manufacturingContext } from "./modules/manufacturing/common.js";
export * from "./modules/manufacturing/boms/index.js";
export * from "./modules/manufacturing/orders/index.js";
export * from "./modules/manufacturing/demand/index.js";
export * from "./modules/manufacturing/availability/index.js";
export * from "./modules/manufacturing/issues/index.js";
export * from "./modules/manufacturing/receipts/index.js";
export * from "./modules/manufacturing/scrap/index.js";
export * from "./modules/manufacturing/quality/index.js";
export * from "./modules/manufacturing/holds/index.js";
export * from "./modules/manufacturing/variance/index.js";
export * from "./modules/manufacturing/costing/index.js";
export * from "./modules/manufacturing/consumption/index.js";
export * from "./modules/manufacturing/production/index.js";
export * from "./modules/projects/index.js";
export * from "./modules/assets/desk.js";
export * from "./modules/assets/asset-register/index.js";
export * from "./modules/assets/asset-categories/index.js";
export * from "./modules/assets/asset-identification/index.js";
export * from "./modules/assets/asset-status/index.js";
export * from "./modules/assets/asset-locations/index.js";
export * from "./modules/assets/asset-custody/index.js";
export * from "./modules/assets/asset-opening/index.js";
export * from "./modules/assets/asset-capitalization/index.js";
export * from "./modules/assets/asset-invoice/index.js";
export * from "./modules/assets/asset-transfers/index.js";
export * from "./modules/assets/asset-assignments/index.js";
export * from "./modules/assets/asset-movements/index.js";
export * from "./modules/assets/asset-depreciation/index.js";
export * from "./modules/assets/asset-depreciation-automation/index.js";
export * from "./modules/assets/asset-maintenance/index.js";
export * from "./modules/assets/asset-disposal/index.js";
export * from "./modules/assets/asset-overview/index.js";
export * from "./modules/point-of-sale/index.js";
export { qualityContext } from "./modules/quality/common.js";
export * from "./modules/quality/specifications/index.js";
export * from "./modules/quality/control-points/index.js";
export {
  getQualitySettings, saveQualitySettings, listInspections, getInspection, createInspection as createQualityInspection, cancelInspection as cancelQualityInspection,
} from "./modules/quality/inspections.js";
export * from "./modules/quality/incoming/index.js";
export * from "./modules/quality/inprocess/index.js";
export * from "./modules/quality/dispatch/index.js";
export * from "./modules/quality/nonconformance/index.js";
export {
  getQualityKpiDashboard, listQualityOptions,
} from "./modules/quality/dashboard.js";
export { supportContext } from "./modules/support/common.js";
export * from "./modules/support/desk/index.js";
// F015-F114 public API declarations.
// F017 canonical governed-attachment domain.

export function accrueSalesCommission(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function getSalesCustomerCreditExposure(client: QueryClient, context: any, partyId: string): Promise<any>;


export function getStockAvailability(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function reserveStock(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function releaseStockReservation(client: QueryClient, context: any, id: string, options?: { status?: "released" | "cancelled" | "consumed" }): Promise<any>;
export function listStockOperationOptions(client: QueryClient, context: any): Promise<Record<string, any[]>>;

// Wave 0 production-integrity primitives.
export * from "./core/platform/numbering/index.js";
export * from "./core/tax/index.js";
export { INVOICE_MESSAGES, validateGstin, financialYearOf, determineRequiredSalesDocument, evaluateEInvoiceApplicability, listInvoiceSeries, saveInvoiceSeries, setEInvoiceApplicability } from "./core/invoicing/index.js";
export type { GstDocumentType, InvoiceSeriesKind, EInvoiceStatus, InvoiceSeries, InvoiceRegistration } from "./core/invoicing/index.js";
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
export * from "./orchestration/imports/index.js";
export * from "./orchestration/public-api/index.js";
export * from "./orchestration/compliance/index.js";
export { SEARCH_PROVIDERS } from "./orchestration/search/providers.js";
export * from "./orchestration/notifications/visibility.js";
export * from "./core/platform/module-administration.js";
export { hrContext, HrError } from "./modules/hr-payroll/common.js";
export * from "./modules/hr-payroll/options.js";
export * from "./modules/hr-payroll/workforce.js";
export * from "./modules/hr-payroll/statutory/index.js";
export * from "./modules/hr-payroll/accounting/index.js";
export * from "./modules/hr-payroll/exit/index.js";
export * from "./modules/hr-payroll/attendance/index.js";
export * from "./modules/gst/index.js";
export {
  listShifts, saveShift, listShiftAssignments, assignShift, listHolidayCalendars, saveHolidayCalendar, listHolidays, addHoliday, removeHoliday, assignHolidayCalendar, punch, recordAttendance, listAttendance, getMyPunchState, getAttendanceSummary, computeAttendanceSummary, recomputeDay,
} from "./modules/hr-payroll/time.js";
export { listLeaveTypes, saveLeaveType, listLeavePolicies, saveLeavePolicy, setPolicyEntry, removePolicyEntry, assignLeavePolicy, listLeaveBalances, getLeaveLedger, adjustLeaveBalance, runLeaveAccrual, runYearEndCarryForward, applyLeave, decideLeave, cancelLeave, listLeaveRequests, getLeaveCalendar, getLeaveDashboard } from "./modules/hr-payroll/leave.js";
export { listSalaryComponents, saveSalaryComponent, listSalaryStructures, getSalaryStructure, createSalaryStructure, updateDraftStructure, submitSalaryStructure, decideSalaryStructure, reviseSalaryStructure, obsoleteSalaryStructure, previewSalaryStructure, listCompensation, proposeCompensation, decideCompensation, getMyCompensation } from "./modules/hr-payroll/compensation.js";
export {
  listPayrollPeriods, generatePayrollPeriods, lockPayrollPeriod, unlockPayrollPeriod, closePayrollPeriod, startPayrollRun, runPayrollCalculation, submitPayrollRun, returnPayrollRun, decidePayrollRun, cancelPayroll, listPayrollExceptions, resolvePayrollException, listPayrollRuns, getPayrollRun, listPayslips, getPayslip, listMyPayslips, verifyPayrollDeterminism, holdPayslip, releasePayslipHold, getPayrollDashboard,
} from "./modules/hr-payroll/payroll.js";
export * from "./core/platform/health/index.js";
export * from "./core/platform/record-thread/index.js";
export * from "./core/platform/saved-views/index.js";
