"use client";

import type { LeadSource, LeadSourceListResponse } from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class LeadSourceApiError extends CrmApiError {}

const { request } = crmApiClient(LeadSourceApiError);

export async function listLeadSources(): Promise<LeadSourceListResponse> {
  return request("/api/crm/lead-sources");
}

export async function createLeadSource(
  input: Record<string, unknown>,
): Promise<{ record: LeadSource }> {
  return request("/api/crm/lead-sources", { method: "POST", json: input });
}

export async function updateLeadSource(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: LeadSource }> {
  return request(`/api/crm/lead-sources/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}

export async function setLeadSourceActive(
  id: string,
  active: boolean,
  expectedUpdatedAt: string,
): Promise<{ record: LeadSource }> {
  return request(`/api/crm/lead-sources/${id}/active`, {
    method: "POST",
    json: { active, expectedUpdatedAt },
  });
}
