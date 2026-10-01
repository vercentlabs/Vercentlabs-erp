"use client";

import type {
  CrmListResponse,
  Opportunity,
  OpportunityListFilters,
} from "../types";
import { CrmApiError } from "../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../shared/http/crm-request.ts";

export class OpportunityApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(OpportunityApiError);

// Opportunities ARE a generic CRM_RESOURCE_KEYS resource (unlike Accounts/
// Contacts), so plain CRUD reuses the same /api/crm/[resource] boundary
// Leads uses — only stage/probability/timeline are dedicated actions.
export async function listOpportunities(
  filters: OpportunityListFilters,
): Promise<CrmListResponse<Opportunity>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all")
      params.set(key, String(value));
  }
  return request(`/api/crm/opportunities?${params.toString()}`);
}

export async function getOpportunity(
  id: string,
): Promise<{ record: Opportunity }> {
  return request(`/api/crm/opportunities/${id}`);
}

export async function createOpportunity(
  input: Record<string, unknown>,
): Promise<{ record: Opportunity }> {
  return request("/api/crm/opportunities", { method: "POST", json: input });
}

export async function updateOpportunity(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: Opportunity }> {
  return request(`/api/crm/opportunities/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}

export async function archiveOpportunity(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: Opportunity }> {
  const response = await fetch(
    `/api/crm/opportunities/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// F009 gap-closure — Archived was the one Opportunity state with no way
// back; every competitor in the benchmark report treats a closed deal as
// reversible. Requires a reason, mirroring moveOpportunityStage's own
// Won/Lost reopen contract.
export async function restoreOpportunity(
  id: string,
  reason: string,
  expectedUpdatedAt: string,
): Promise<{ record: Opportunity }> {
  return request(`/api/crm/opportunities/${id}/restore`, {
    method: "POST",
    json: { reason, expectedUpdatedAt },
  });
}

export async function moveOpportunityStage(
  id: string,
  input: {
    stageId: string;
    note?: string | null;
    expectedUpdatedAt?: string;
    expectedStageId?: string | null;
    outcomeReasonId?: string | null;
    outcomeNotes?: string | null;
  },
): Promise<{ record: Opportunity }> {
  return request(`/api/crm/opportunities/${id}/stage`, {
    method: "POST",
    json: input,
  });
}

export async function updateOpportunityProbability(
  id: string,
  input: {
    probability: number;
    note?: string | null;
    expectedUpdatedAt?: string;
    expectedProbability?: number | null;
  },
): Promise<{ record: Opportunity }> {
  return request(`/api/crm/opportunities/${id}/probability`, {
    method: "POST",
    json: input,
  });
}

// F010 gap-closure — authoritative per-stage totals/ages/bottlenecks the
// Pipeline board previously approximated client-side from its own capped
// fetch. See stage-aging.js for the governed computation.
export type PipelineStageTotals = {
  opportunityCount: number;
  byCurrency: Record<
    string,
    { opportunityCount: number; amount: number; weightedAmount: number }
  >;
};
export type PipelineStageAge = {
  enteredAt: string | null;
  ageDays: number | null;
  maximumDays: number | null;
  status: "ok" | "warning" | "breached" | "unknown";
};
export type PipelineStageBottleneck = {
  stageId: string;
  name: string;
  sequence: number;
  opportunityCount: number;
  averageAgeDays: number;
  maximumDays: number | null;
  breachedCount: number;
  isBottleneck: boolean;
};

export async function getPipelineSummary(pipelineId: string): Promise<{
  stageTotals: Record<string, PipelineStageTotals>;
  stageAges: Record<string, PipelineStageAge>;
  bottlenecks: PipelineStageBottleneck[];
}> {
  return request(
    `/api/crm/opportunities/pipeline-summary?pipelineId=${encodeURIComponent(pipelineId)}`,
  );
}

export type PipelineSnapshot = {
  id: string;
  pipelineId: string;
  companyId: string | null;
  stageId: string;
  currencyCode: string;
  snapshotDate: string;
  opportunityCount: number;
  amount: string;
  weightedAmount: string;
  source: "scheduled" | "manual";
  capturedBy: string | null;
  capturedAt: string;
};

export async function listPipelineSnapshots(
  pipelineId: string,
): Promise<{ rows: PipelineSnapshot[] }> {
  return request(
    `/api/crm/pipeline/snapshots?pipelineId=${encodeURIComponent(pipelineId)}`,
  );
}

export async function capturePipelineSnapshotNow(pipelineId: string): Promise<{
  snapshotDate: string;
  source: string;
  pipelinesProcessed: number;
  rowsWritten: number;
  rowsSkippedDuplicate: number;
}> {
  return request("/api/crm/pipeline/snapshots", {
    method: "POST",
    json: { pipelineId },
  });
}

// F011 gap-closure — crm_opportunity_probability_history has been an
// immutable, provenance-tagged ledger since day one with no reader
// anywhere; this is that reader.
export type OpportunityProbabilityHistoryEntry = {
  id: string;
  fromProbability: string;
  toProbability: string;
  expectedRevenue: string;
  note: string | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
  source:
    | "manual_override"
    | "stage_default"
    | "terminal_won"
    | "terminal_lost"
    | "reopen"
    | "restored"
    | null;
};

export async function getOpportunityProbabilityHistory(
  id: string,
): Promise<{ rows: OpportunityProbabilityHistoryEntry[] }> {
  return request(`/api/crm/opportunities/${id}/probability-history`);
}

// F011 gap-closure — the predictive-forecast model already computes a real
// per-Opportunity predicted probability on every snapshot capture; this
// surfaces THIS Opportunity's own entry instead of only the org-wide
// aggregate the Forecast screen shows.
export type OpportunityPredictiveProbability = {
  predictedProbability: number;
  predictedAmount: number;
  factors: Record<string, number> | null;
  modelVersion: string;
  capturedAt: string;
};

export async function getOpportunityPredictiveProbability(
  id: string,
): Promise<{ prediction: OpportunityPredictiveProbability | null }> {
  return request(`/api/crm/opportunities/${id}/predictive-probability`);
}

// F029 governed bulk edit — only ownerUserId/forecastCategory/
// expectedCloseDate/nextStep are supported (see opportunity-operations.js's
// OPPORTUNITY_BULK_FIELDS); stage/status/probability/outcome remain
// single-record governed actions. Unlike Lead's sync result, Opportunity's
// sync path has no per-record applied/conflict/skipped/failed manifest —
// only an aggregate updated count (see the bulk route's own comment).
// F029 — one outcome per selected record (each ran through the single-record rules).
export type OpportunityBulkItem = {
  id: string;
  name?: string | null;
  status: "applied" | "would_apply" | "conflict" | "skipped" | "failed";
  code?: string;
  message?: string;
};
export type OpportunityBulkSyncResult = {
  mode: "synchronous";
  preview: boolean;
  requested: number;
  updated: number;
  applied: number;
  would_apply: number;
  conflict: number;
  skipped: number;
  failed: number;
  items: OpportunityBulkItem[];
};
export type OpportunityBulkJobResult = {
  mode: "asynchronous";
  deduped: boolean;
  job: {
    id: string;
    status: string;
    progress: Record<string, unknown>;
    resultManifest: Record<string, unknown>;
  };
};

export async function bulkUpdateOpportunitiesRequest(
  ids: string[],
  changes: Record<string, unknown>,
  idempotencyKey?: string,
  preview = false,
): Promise<OpportunityBulkSyncResult | OpportunityBulkJobResult> {
  return request("/api/crm/opportunities/bulk", {
    method: "POST",
    json: { ids, changes, idempotencyKey, preview },
  });
}
