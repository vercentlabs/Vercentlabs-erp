import type { CrmFoundationContext, QueryClient } from "../../../index.js";

export class LeadOperationsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
}

export function evaluateLeadReadiness(
  lead: Record<string, unknown>,
  now?: Date,
  options?: { scoringConfigured?: boolean },
): Record<string, unknown>;
export function isLeadScoringConfigured(
  client: QueryClient,
  organizationId: string,
): Promise<boolean>;
export function buildLeadAgingBuckets(
  rows: Array<Record<string, unknown>>,
  now?: Date,
): Record<string, unknown>;
export function previewLeadAssignment(
  client: QueryClient,
  context: CrmFoundationContext,
  input: object,
): Promise<Record<string, unknown>>;

export const LEAD_BULK_SYNC_LIMIT: number;
export const LEAD_BULK_MAX_ITEMS: number;
export const LEAD_BULK_JOB_TYPE: string;

export function normalizeLeadBulkChanges(
  input: Record<string, unknown>,
): Record<string, unknown>;
export function normalizeLeadBulkFilters(
  input?: Record<string, unknown>,
): Record<string, unknown>;

export function bulkUpdateLeads(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getLeadOperationsDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;

export function enqueueLeadBulkUpdateJob(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getLeadBulkJob(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId?: string | null,
): Promise<Record<string, unknown>>;
export function cancelLeadBulkJob(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId: string,
): Promise<Record<string, unknown>>;
export function retryFailedLeadBulkJobItems(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId: string,
): Promise<Record<string, unknown>>;
export function resolveLeadBulkExecutionContext(
  client: QueryClient,
  organizationId: string,
  input: Record<string, unknown>,
): Promise<CrmFoundationContext | null>;
