"use client";

import type { CrmListResponse, CrmPipeline, CrmSalesStage } from "../types";

export class PipelineStagesApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new PipelineStagesApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// Pipelines reuse the generic /api/crm/[resource] boundary.
export async function listPipelines(): Promise<CrmListResponse<CrmPipeline>> {
  const response = await fetch("/api/crm/pipelines?limit=100");
  return parseResponse(response);
}
export async function createPipeline(input: Record<string, unknown>): Promise<{ record: CrmPipeline }> {
  const response = await fetch("/api/crm/pipelines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function archivePipeline(id: string, expectedUpdatedAt: string): Promise<{ record: CrmPipeline }> {
  const response = await fetch(`/api/crm/pipelines/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

// Stages go through the dedicated sales-stage-operations.js module.
export async function listStages(pipelineId: string): Promise<{ rows: CrmSalesStage[]; total: number }> {
  const response = await fetch(`/api/crm/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`);
  return parseResponse(response);
}
export async function createStage(input: Record<string, unknown>): Promise<{ record: CrmSalesStage }> {
  const response = await fetch("/api/crm/pipeline-stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateStage(id: string, input: Record<string, unknown>): Promise<{ record: CrmSalesStage }> {
  const response = await fetch(`/api/crm/pipeline-stages/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function setStageActive(id: string, active: boolean, expectedUpdatedAt: string): Promise<{ record: CrmSalesStage }> {
  const response = await fetch(`/api/crm/pipeline-stages/${id}/active`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active, expectedUpdatedAt }) });
  return parseResponse(response);
}
export async function reorderStages(pipelineId: string, entries: Array<{ id: string; expectedUpdatedAt: string }>): Promise<{ changed: boolean; rows: CrmSalesStage[] }> {
  const response = await fetch("/api/crm/pipeline-stages/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pipelineId, entries }) });
  return parseResponse(response);
}

// F010 gap-closure — crm_opportunity_stage_sla_policies previously had no
// admin UI at all: an auto-seeded, probability-tiered default was frozen at
// migration time with no way to view, edit, or deactivate it, and no policy
// row was ever created for a pipeline/stage added afterward.
export type StageSlaPolicy = { stageId: string; name: string; sequence: number; fallbackDays: number | null; policyId: string | null; overrideDays: number | null; overrideStatus: "active" | "inactive" | null; updatedAt: string | null };

export async function listStageSlaPolicies(pipelineId: string): Promise<{ rows: StageSlaPolicy[] }> {
  const response = await fetch(`/api/crm/pipeline-stages/sla-policies?pipelineId=${encodeURIComponent(pipelineId)}`);
  return parseResponse(response);
}

export async function saveStageSlaPolicy(
  stageId: string,
  input: { pipelineId: string; maximumDays: number | null; status: "active" | "inactive"; expectedUpdatedAt?: string | null },
): Promise<{ record: Record<string, unknown> }> {
  const response = await fetch(`/api/crm/pipeline-stages/${stageId}/sla-policy`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}

// F012 gap-closure — deactivateSalesStageWithMigration/listSalesStageHistory
// existed, tested and (in the migration job's case) wired to a real worker
// handler, but had no route or UI at all: an admin blocked from
// deactivating a stage with open Opportunities had no way to actually do
// what the error message told them to ("choose a replacement stage to
// migrate them"), and the full configuration audit trail was unreadable.
export type StageDeactivationResult = { deactivated: boolean; stage: CrmSalesStage; migrationJob?: { id: string; status: string; resultManifest: Record<string, unknown> } };

export async function deactivateStageWithMigration(id: string, migrateToStageId: string | undefined, expectedUpdatedAt: string): Promise<StageDeactivationResult> {
  const response = await fetch(`/api/crm/pipeline-stages/${id}/deactivate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ migrateToStageId, expectedUpdatedAt }) });
  return parseResponse(response);
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

export async function listStageHistory(pipelineId: string): Promise<{ rows: StageHistoryEntry[] }> {
  const response = await fetch(`/api/crm/pipeline-stages/history?pipelineId=${encodeURIComponent(pipelineId)}`);
  return parseResponse(response);
}
