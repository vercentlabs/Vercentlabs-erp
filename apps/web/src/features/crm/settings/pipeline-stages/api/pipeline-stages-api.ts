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
