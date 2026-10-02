"use client";

import type { CrmListResponse, CrmPipeline, CrmSalesStage } from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class PipelineStagesApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(PipelineStagesApiError);

// Pipelines reuse the generic /api/crm/[resource] boundary.
export async function listPipelines(): Promise<CrmListResponse<CrmPipeline>> {
  return request("/api/crm/pipelines?limit=100");
}
export async function createPipeline(
  input: Record<string, unknown>,
): Promise<{ record: CrmPipeline }> {
  return request("/api/crm/pipelines", { method: "POST", json: input });
}
export async function archivePipeline(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: CrmPipeline }> {
  const response = await fetch(
    `/api/crm/pipelines/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// Stages go through the dedicated sales-stage-operations.js module.
export async function listStages(
  pipelineId: string,
): Promise<{ rows: CrmSalesStage[]; total: number }> {
  return request(
    `/api/crm/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`,
  );
}
export async function createStage(
  input: Record<string, unknown>,
): Promise<{ record: CrmSalesStage }> {
  return request("/api/crm/pipeline-stages", { method: "POST", json: input });
}
export async function setStageActive(
  id: string,
  active: boolean,
  expectedUpdatedAt: string,
): Promise<{ record: CrmSalesStage }> {
  return request(`/api/crm/pipeline-stages/${id}/active`, {
    method: "POST",
    json: { active, expectedUpdatedAt },
  });
}
export async function reorderStages(
  pipelineId: string,
  entries: Array<{ id: string; expectedUpdatedAt: string }>,
): Promise<{ changed: boolean; rows: CrmSalesStage[] }> {
  return request("/api/crm/pipeline-stages/reorder", {
    method: "POST",
    json: { pipelineId, entries },
  });
}

// F010 gap-closure — crm_opportunity_stage_sla_policies previously had no
// admin UI at all: an auto-seeded, probability-tiered default was frozen at
// migration time with no way to view, edit, or deactivate it, and no policy
// row was ever created for a pipeline/stage added afterward.
export type StageSlaPolicy = {
  stageId: string;
  name: string;
  sequence: number;
  fallbackDays: number | null;
  policyId: string | null;
  overrideDays: number | null;
  overrideStatus: "active" | "inactive" | null;
  updatedAt: string | null;
};

export async function listStageSlaPolicies(
  pipelineId: string,
): Promise<{ rows: StageSlaPolicy[] }> {
  return request(
    `/api/crm/pipeline-stages/sla-policies?pipelineId=${encodeURIComponent(pipelineId)}`,
  );
}

export async function saveStageSlaPolicy(
  stageId: string,
  input: {
    pipelineId: string;
    maximumDays: number | null;
    status: "active" | "inactive";
    expectedUpdatedAt?: string | null;
  },
): Promise<{ record: Record<string, unknown> }> {
  const response = await fetch(
    `/api/crm/pipeline-stages/${stageId}/sla-policy`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return parseResponse(response);
}

// F012 gap-closure — deactivateSalesStageWithMigration/listSalesStageHistory
// existed, tested and (in the migration job's case) wired to a real worker
// handler, but had no route or UI at all: an admin blocked from
// deactivating a stage with open Opportunities had no way to actually do
// what the error message told them to ("choose a replacement stage to
// migrate them"), and the full configuration audit trail was unreadable.
export type StageDeactivationResult = {
  deactivated: boolean;
  stage: CrmSalesStage;
  migrationJob?: {
    id: string;
    status: string;
    resultManifest: Record<string, unknown>;
  };
};

export async function deactivateStageWithMigration(
  id: string,
  migrateToStageId: string | undefined,
  expectedUpdatedAt: string,
): Promise<StageDeactivationResult> {
  return request(`/api/crm/pipeline-stages/${id}/deactivate`, {
    method: "POST",
    json: { migrateToStageId, expectedUpdatedAt },
  });
}

export type StageHistoryEntry = {
  id: string;
  stageId: string;
  stageName: string;
  stageCode: string;
  action: "created" | "updated" | "reordered" | "deactivated" | "reactivated";
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
};

export async function listStageHistory(
  pipelineId: string,
): Promise<{ rows: StageHistoryEntry[] }> {
  return request(
    `/api/crm/pipeline-stages/history?pipelineId=${encodeURIComponent(pipelineId)}`,
  );
}
