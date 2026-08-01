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
export * from "./crm.js";
export * from "./billing.js";
export * from "./sales.js";

export * from "./accounting.js";

export * from "./procurement.js";
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

export * from "./crm/lead-operations.js";

export * from "./crm/opportunity-operations.js";
