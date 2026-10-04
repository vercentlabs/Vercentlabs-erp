"use client";

// Browser client for the pipeline routes under /api/crm/pipeline. The
// pipeline is a view over opportunities: its cards are opportunities, and
// every change it makes goes through an opportunity operation.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import type { Opportunity, OpportunityCapabilities, OpportunityListFilters } from "@/features/crm/opportunities/api/opportunities-api";

export class PipelineApiError extends CrmApiErrorWithBody {}

// A quick edit whose stage move the server wants confirmed first. null for any other failure.
export function quickEditWarningOf(error: unknown): string[] | null {
  if (!(error instanceof PipelineApiError) || error.code !== "CRM_OPPORTUNITY_STAGE_WARNING") return null;
  const details = (error.details.details ?? error.details) as { warnings?: string[] };
  return details.warnings ?? [error.message];
}

const { request } = crmApiClient(PipelineApiError, "body");

export type PipelineStatus = "open" | "won" | "lost" | "all";
export type PipelineCardSort = "expectedCloseDate" | "amount" | "lastActivityAt" | "createdAt" | "priority";

export type PipelineStage = {
  id: string; code: string; name: string; sequence: number; probability: number; isInactive: boolean;
  count: number; value: number; weightedValue: number; averageDaysInStage: number | null; cards: Opportunity[]; hasMore: boolean;
};
export type Pipeline = {
  status: PipelineStatus; cardSort: PipelineCardSort; cardsPerStage: number; stages: PipelineStage[];
  total: number; totalValue: number; weightedValue: number; capabilities: OpportunityCapabilities;
};
type BreakdownRow = { id: string | null; label: string; total: number; value: number; weightedValue: number };
export type PipelineSummary = {
  totals: {
    open: number; value: number; weightedValue: number; closingThisMonth: number; closingThisMonthValue: number; overdue: number; stale: number;
    staleDays: number; noNextActivity: number;
  };
  byOwner: Array<BreakdownRow & { stages: Array<{ stageId: string; total: number; value: number }> }>;
  bySource: BreakdownRow[];
  stageAging: Array<{ stageId: string; entered: number; averageDays: number | null; conversionRate: number | null }>;
};
// The opportunity list filters, plus the board's own.
export type PipelineFilters = Omit<OpportunityListFilters, "status"> & Partial<{ status: PipelineStatus; cardSort: PipelineCardSort; cardsPerStage: number }>;
export type QuickEditInput = Partial<{ stageId: string; expectedCloseDate: string; ownerUserId: string | null; priority: string; probability: number; nextStep: string }>;

const BASE = "/api/crm/pipeline";

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const getPipeline = (filters: PipelineFilters = {}) => request<{ pipeline: Pipeline }>(`${BASE}${query(filters)}`).then((result) => result.pipeline);
export const getPipelineSummary = (filters: PipelineFilters = {}) =>
  request<{ summary: PipelineSummary }>(`${BASE}/summary${query({ ...filters, cardSort: undefined, cardsPerStage: undefined })}`).then((result) => result.summary);
// warn: true asks for confirmation of a stage move that deserves a second look (stageWarningOf).
export const quickEditOpportunity = (id: string, input: QuickEditInput & { expectedUpdatedAt?: string; warn?: boolean }) =>
  request<{ record: Opportunity }>(`${BASE}/cards/${id}`, { method: "PATCH", json: input }).then((result) => result.record);


export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
