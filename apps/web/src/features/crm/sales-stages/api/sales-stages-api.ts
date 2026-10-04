"use client";

// Browser client for the sales stage settings under /api/crm/sales-stages.
// Moving an opportunity between stages is an opportunity operation
// (changeOpportunityStage in the opportunities client), not part of this one.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class SalesStageApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(SalesStageApiError, "body");

export type SalesStage = {
  id: string; code: string; name: string; description: string | null; guidance: string | null; sequence: number; probability: number;
  isActive: boolean; isStandard: boolean; openCount: number; isUsed: boolean; updatedAt: string;
};
export type SalesStageInput = Partial<{ name: string; description: string; guidance: string; probability: number; isActive: boolean; moveOpenTo: string }>;

const BASE = "/api/crm/sales-stages";

export const listSalesStages = () => request<{ stages: SalesStage[] }>(BASE).then((result) => result.stages);
export const createSalesStage = (input: SalesStageInput) => request<{ stage: SalesStage }>(BASE, { method: "POST", json: input }).then((result) => result.stage);
export const updateSalesStage = (id: string, input: SalesStageInput) =>
  request<{ stage: SalesStage }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.stage);
export const reorderSalesStages = (ids: string[]) =>
  request<{ stages: SalesStage[] }>(`${BASE}/reorder`, { method: "POST", json: { ids } }).then((result) => result.stages);

// A deactivation refused because open opportunities are still in the stage: how many.
export function stageInUseCount(error: unknown): number | null {
  if (error instanceof SalesStageApiError && error.code === "CRM_SALES_STAGE_IN_USE") return Number(error.details.openCount ?? (error.details.details as { openCount?: number } | undefined)?.openCount ?? 0);
  return null;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
