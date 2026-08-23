import type { CrmFoundationContext, QueryClient } from "../../index.js";

export class LeadOperationsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}

export function evaluateLeadReadiness(
  lead: Record<string, unknown>,
  now?: Date,
): Record<string, unknown>;
export function buildLeadAgingBuckets(
  rows: Array<Record<string, unknown>>,
  now?: Date,
): Record<string, unknown>;
export function getLeadTimeline(
  client: QueryClient,
  context: CrmFoundationContext,
  leadId: string,
): Promise<Array<Record<string, unknown>>>;
export function previewLeadAssignment(
  client: QueryClient,
  context: CrmFoundationContext,
  input: object,
): Promise<Record<string, unknown>>;
export function bulkUpdateLeads(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getLeadOperationsDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
