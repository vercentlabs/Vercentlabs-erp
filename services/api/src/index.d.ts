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

export function listLeadStages(client: QueryClient, context: any, options?: { status?: string }): Promise<any>;
export function getLeadStage(client: QueryClient, context: any, idOrCode: string): Promise<any>;
export function createLeadStage(client: QueryClient, context: any, input?: Record<string, unknown>): Promise<any>;
export function updateLeadStage(client: QueryClient, context: any, id: string, input?: Record<string, unknown>): Promise<any>;
export function setLeadStageActive(client: QueryClient, context: any, id: string, active: boolean): Promise<any>;
export function transitionLeadStage(client: QueryClient, context: any, leadId: string, input?: Record<string, unknown>): Promise<any>;
export function listLeadStageHistory(client: QueryClient, context: any, leadId: string): Promise<any[]>;

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
  },
): Promise<void>;

export function seedBusinessDataFoundation(
  client: QueryClient,
  context: Pick<BusinessDataContext, "organizationId" | "userId">,
): Promise<void>;
export * from "./modules/crm/index.js";
export * from "./modules/crm/account-operations.js";
export * from "./modules/crm/contact-operations.js";
export * from "./modules/crm/lead-source-operations.js";
export * from "./modules/crm/lead-qualification.js";
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
export function assignLeadOwner(
  client: QueryClient,
  context: CrmFoundationContext,
  leadId: string,
  ownerUserId: string | null,
  options?: { reason?: string },
): Promise<any>;

export * from "./modules/crm/lead-operations.js";

export * from "./modules/crm/opportunity-operations.js";

export * from "./modules/sales/quotation-governance.js";

export * from "./modules/sales/order-governance.js";

export * from "./modules/accounting/receivables-governance.js";

export * from "./modules/accounting/payables-governance.js";

export * from "./modules/accounting/banking-governance.js";

export * from "./modules/accounting/tax-reporting-governance.js";

export * from "./modules/procurement/governance.js";

export * from "./modules/crm/core-acceptance.js";

export * from "./modules/crm/account-intelligence.js";

export * from "./core/release/governance.js";

export * from "./modules/crm/communications.js";

export * from "./modules/crm/lead-acquisition.js";
export * from "./modules/crm/lead-intelligence.js";
export * from "./modules/crm/opportunity-revenue-intelligence.js";
export * from "./modules/crm/offline-sync.js";
export * from "./modules/stock/index.js";
export * from "./modules/manufacturing/index.js";
export * from "./modules/projects/index.js";
export * from "./modules/assets/index.js";
export * from "./modules/point-of-sale/index.js";
export * from "./modules/quality/index.js";
export * from "./modules/support/index.js";
export * from "./modules/hr-payroll/index.js";
