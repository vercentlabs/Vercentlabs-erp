"use client";

import type {
  LeadStage,
  LeadStageTransition,
  LeadStageTransitionReason,
} from "../types";
import { CrmApiErrorWithDetails } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class LeadLifecycleApiError extends CrmApiErrorWithDetails {}

const { request, parseResponse } = crmApiClient(
  LeadLifecycleApiError,
  "details-field",
);

export async function listLeadStages(
  status: "active" | "inactive" | "all" = "all",
): Promise<{ rows: LeadStage[]; total: number }> {
  return request(`/api/crm/lead-stages?status=${status}`);
}
export async function createLeadStage(
  input: Record<string, unknown>,
): Promise<{ record: LeadStage }> {
  return request("/api/crm/lead-stages", { method: "POST", json: input });
}
export async function updateLeadStage(
  id: string,
  input: Record<string, unknown>,
): Promise<{ record: LeadStage }> {
  return request(`/api/crm/lead-stages/${id}`, {
    method: "PATCH",
    json: input,
  });
}
export async function reactivateLeadStage(
  id: string,
): Promise<{ record: LeadStage }> {
  return request(`/api/crm/lead-stages/${id}/reactivate`, { method: "POST" });
}
export async function deactivateLeadStage(
  id: string,
  migrateToStageId?: string,
): Promise<{ deactivated: boolean; stage: LeadStage; migrationJob?: unknown }> {
  return request(`/api/crm/lead-stages/${id}/deactivate`, {
    method: "POST",
    json: { migrateToStageId },
  });
}

export async function listLeadStageTransitions(): Promise<{
  rows: LeadStageTransition[];
}> {
  return request("/api/crm/lead-stage-transitions");
}
export async function addLeadStageTransition(
  fromStageId: string,
  toStageId: string,
  reasonRequired: boolean,
): Promise<{ record: unknown }> {
  return request("/api/crm/lead-stage-transitions", {
    method: "POST",
    json: { fromStageId, toStageId, reasonRequired },
  });
}
export async function removeLeadStageTransition(
  fromStageId: string,
  toStageId: string,
): Promise<{ removed: boolean }> {
  const response = await fetch(
    `/api/crm/lead-stage-transitions/${fromStageId}/${toStageId}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

export type LeadStageTemplatePreview = {
  stagesToCreate: Array<{ code: string; name: string; description: string }>;
  labelsToChange: unknown[];
  edgesToAdd: Array<{ fromCode: string; toCode: string }>;
  edgesToRemove: unknown[];
  affectedLeadCount: number;
  requiresLeadMigration: boolean;
  conflicts: Array<{ code: string; issue: string }>;
};

export async function previewLeadStageTemplateUpgrade(): Promise<LeadStageTemplatePreview> {
  return request("/api/crm/lead-stages/recommended-template");
}
export async function applyLeadStageTemplateUpgrade(): Promise<{
  applied: boolean;
  stagesCreated: Array<{ code: string; name: string; description: string }>;
  edgesAdded: Array<{ fromCode: string; toCode: string }>;
}> {
  return request("/api/crm/lead-stages/recommended-template", {
    method: "POST",
    json: { confirm: true },
  });
}

export async function listLeadStageTransitionReasons(): Promise<{
  rows: LeadStageTransitionReason[];
}> {
  return request("/api/crm/lead-stage-transition-reasons");
}
export async function createLeadStageTransitionReason(
  input: Record<string, unknown>,
): Promise<{ record: LeadStageTransitionReason }> {
  return request("/api/crm/lead-stage-transition-reasons", {
    method: "POST",
    json: input,
  });
}
export async function setLeadStageTransitionReasonActive(
  id: string,
  active: boolean,
): Promise<{ record: LeadStageTransitionReason }> {
  const response = await fetch(
    `/api/crm/lead-stage-transition-reasons/${id}/active`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    },
  );
  return parseResponse(response);
}
