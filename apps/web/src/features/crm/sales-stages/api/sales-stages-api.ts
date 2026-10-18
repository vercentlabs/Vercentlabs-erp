"use client";

// Browser client for the pipelines and sales stage settings under /api/crm/pipelines and /api/crm/sales-stages.
// Moving an opportunity between stages is an opportunity operation
// (changeOpportunityStage in the opportunities client), not part of this one.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class SalesStageApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(SalesStageApiError, "body");

export type StageRuleKey = "contact" | "closeDate" | "amount" | "products" | "quotation" | "nextActivity";
export type StageRule = { rule: StageRuleKey; level: "require" | "warn" };
export type SalesStage = {
  id: string; code: string; name: string; description: string | null; guidance: string | null; sequence: number; probability: number;
  isActive: boolean; isStandard: boolean; openCount: number; isUsed: boolean; updatedAt: string;
  pipelineId: string; entryRules: StageRule[]; rulesAreStandard: boolean; timeLimitDays: number | null;
};
export type SalesStageInput = Partial<{
  name: string; description: string; guidance: string; probability: number; isActive: boolean; moveOpenTo: string; pipelineId: string;
  entryRules: StageRule[] | null; timeLimitDays: number | null;
}>;
export type Pipeline = {
  id: string; code: string; name: string; description: string | null; isDefault: boolean; isActive: boolean; teamId: string | null; teamName: string | null;
  openCount: number; stageCount: number;
};

// What each condition is called on the settings screen.
export const STAGE_RULE_LABELS: Record<StageRuleKey, string> = {
  contact: "Primary contact", closeDate: "Expected close date", amount: "Estimated value", products: "Products on the deal", quotation: "A quotation",
  nextActivity: "A next activity planned",
};

const BASE = "/api/crm/sales-stages";

export const listSalesStages = (pipelineId?: string | null) =>
  request<{ stages: SalesStage[] }>(`${BASE}${pipelineId ? `?pipelineId=${pipelineId}` : ""}`).then((result) => result.stages);
export const createSalesStage = (input: SalesStageInput) => request<{ stage: SalesStage }>(BASE, { method: "POST", json: input }).then((result) => result.stage);
export const updateSalesStage = (id: string, input: SalesStageInput) =>
  request<{ stage: SalesStage }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.stage);
export const reorderSalesStages = (ids: string[], pipelineId?: string | null) =>
  request<{ stages: SalesStage[] }>(`${BASE}/reorder`, { method: "POST", json: { ids, pipelineId: pipelineId ?? null } }).then((result) => result.stages);

export const listPipelines = (includeInactive = false) =>
  request<{ pipelines: Pipeline[] }>(`/api/crm/pipelines${includeInactive ? "?all=1" : ""}`).then((result) => result.pipelines);
export const createPipeline = (input: { name: string; description?: string; teamId?: string | null; copyStagesFrom?: string | null }) =>
  request<{ pipeline: Pipeline }>("/api/crm/pipelines", { method: "POST", json: input }).then((result) => result.pipeline);
export const updatePipeline = (id: string, input: Partial<{ name: string; description: string; teamId: string | null; isDefault: boolean; isActive: boolean; moveOpenTo: string }>) =>
  request<{ pipeline: Pipeline }>(`/api/crm/pipelines/${id}`, { method: "PATCH", json: input }).then((result) => result.pipeline);

// A deactivation refused because open opportunities are still in the stage (or pipeline): how many.
export function stageInUseCount(error: unknown): number | null {
  if (error instanceof SalesStageApiError && ["CRM_SALES_STAGE_IN_USE", "CRM_PIPELINE_IN_USE"].includes(error.code ?? ""))
    return Number(error.details.openCount ?? (error.details.details as { openCount?: number } | undefined)?.openCount ?? 0);
  return null;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
