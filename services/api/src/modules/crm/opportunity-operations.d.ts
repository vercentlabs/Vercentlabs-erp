import type { CrmFoundationContext, QueryClient } from "../../index.js";
export class OpportunityOperationsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}
export function evaluateOpportunityHealth(
  row: Record<string, unknown>,
  now?: Date,
): Record<string, unknown>;
export function buildPipelineSummary(
  rows: Array<Record<string, unknown>>,
  now?: Date,
): Record<string, unknown>;
export function getOpportunityDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function getOpportunityTimeline(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
): Promise<Record<string, unknown>>;
export function normalizeOpportunityBulkChanges(
  client: QueryClient,
  context: CrmFoundationContext,
  input: unknown,
): Promise<Record<string, unknown>>;
export function bulkUpdateOpportunities(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export const OPPORTUNITY_BULK_MAX_ITEMS: number;
export const OPPORTUNITY_BULK_JOB_TYPE: string;
export function enqueueOpportunityBulkUpdateJob(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getOpportunityBulkJob(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId?: string | null,
): Promise<Record<string, unknown>>;
export function cancelOpportunityBulkJob(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId: string,
): Promise<Record<string, unknown>>;
export function retryFailedOpportunityBulkJobItems(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId: string,
): Promise<Record<string, unknown>>;
export function resolveOpportunityBulkExecutionContext(
  client: QueryClient,
  organizationId: string,
  input: Record<string, unknown>,
): Promise<CrmFoundationContext | null>;
export function captureForecastSnapshot(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
): Promise<Record<string, unknown>>;
