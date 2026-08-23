import type { CrmFoundationContext, QueryClient } from "../../index.js";
export class OpportunityOperationsError extends Error {
  readonly status: number;
  readonly code: string;
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
export function bulkUpdateOpportunities(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function captureForecastSnapshot(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
): Promise<Record<string, unknown>>;
