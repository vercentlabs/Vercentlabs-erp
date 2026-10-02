"use client";

import type { LeadScoringModel, LeadScoringModelRule } from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class ScoringModelApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(ScoringModelApiError);

export async function listLeadScoringModels(): Promise<{
  rows: LeadScoringModel[];
}> {
  return request("/api/crm/lead-scoring-models");
}
export async function createLeadScoringModel(
  input: Record<string, unknown>,
): Promise<{ record: LeadScoringModel }> {
  return request("/api/crm/lead-scoring-models", {
    method: "POST",
    json: input,
  });
}
export async function activateLeadScoringModel(
  id: string,
): Promise<{ model: LeadScoringModel; recalcJob: unknown }> {
  return request(`/api/crm/lead-scoring-models/${id}/activate`, {
    method: "POST",
  });
}
export async function trainLeadScoringModel(
  id: string,
): Promise<{ record: LeadScoringModel }> {
  return request(`/api/crm/lead-scoring-models/${id}/train`, {
    method: "POST",
  });
}
export async function createLeadScoringModelRule(
  modelId: string,
  input: Record<string, unknown>,
): Promise<{ record: LeadScoringModelRule }> {
  const response = await fetch(
    `/api/crm/lead-scoring-models/${modelId}/rules`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return parseResponse(response);
}
export async function setLeadScoringModelRuleStatus(
  modelId: string,
  ruleId: string,
  status: "active" | "inactive",
): Promise<{ record: LeadScoringModelRule }> {
  const response = await fetch(
    `/api/crm/lead-scoring-models/${modelId}/rules/${ruleId}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  return parseResponse(response);
}
