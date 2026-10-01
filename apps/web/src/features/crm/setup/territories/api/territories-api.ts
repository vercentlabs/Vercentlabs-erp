"use client";

import type {
  CrmListResponse,
  QuotaPlan,
  SalesTeam,
  SalesTeamMember,
  Territory,
  TerritoryAssignment,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class SettingsApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(SettingsApiError);

// Both resources reuse the generic /api/crm/[resource] boundary — no
// dedicated routes exist or are needed (see resource-permissions.ts for
// the crm.settings.manage gate applied to both).
export async function listSalesTeams(): Promise<CrmListResponse<SalesTeam>> {
  return request("/api/crm/sales-teams?limit=100");
}
export async function createSalesTeam(
  input: Record<string, unknown>,
): Promise<{ record: SalesTeam }> {
  return request("/api/crm/sales-teams", { method: "POST", json: input });
}
export async function updateSalesTeam(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: SalesTeam }> {
  return request(`/api/crm/sales-teams/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}
export async function archiveSalesTeam(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: SalesTeam }> {
  const response = await fetch(
    `/api/crm/sales-teams/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

export async function listTerritories(): Promise<CrmListResponse<Territory>> {
  return request("/api/crm/territories?limit=100");
}
export async function createTerritory(
  input: Record<string, unknown>,
): Promise<{ record: Territory }> {
  return request("/api/crm/territories", { method: "POST", json: input });
}
export async function updateTerritory(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: Territory }> {
  return request(`/api/crm/territories/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}
export async function archiveTerritory(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: Territory }> {
  const response = await fetch(
    `/api/crm/territories/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// Membership is effective-dated, not a separate lifecycle object — "ending"
// a membership archives it (crm_sales_team_members.status -> inactive, a
// real archive transition the generic mutation service already supports).
export async function listSalesTeamMembers(
  teamId: string,
): Promise<CrmListResponse<SalesTeamMember>> {
  return request(
    `/api/crm/sales-team-members?teamId=${encodeURIComponent(teamId)}&limit=100`,
  );
}
export async function createSalesTeamMember(
  input: Record<string, unknown>,
): Promise<{ record: SalesTeamMember }> {
  return request("/api/crm/sales-team-members", {
    method: "POST",
    json: input,
  });
}
export async function archiveSalesTeamMember(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: SalesTeamMember }> {
  const response = await fetch(
    `/api/crm/sales-team-members/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// territory-assignments has no statusColumn/archive transition in the
// resource registry — it is purely effective-dated. "Ending" an assignment
// means setting effectiveTo, an update, never a DELETE (which the generic
// mutation service would reject with CRM_ARCHIVE_UNSUPPORTED for this
// resource).
export async function listTerritoryAssignments(
  territoryId: string,
): Promise<CrmListResponse<TerritoryAssignment>> {
  return request(
    `/api/crm/territory-assignments?territoryId=${encodeURIComponent(territoryId)}&limit=100`,
  );
}
export async function createTerritoryAssignment(
  input: Record<string, unknown>,
): Promise<{ record: TerritoryAssignment }> {
  return request("/api/crm/territory-assignments", {
    method: "POST",
    json: input,
  });
}
export async function endTerritoryAssignment(
  id: string,
  effectiveTo: string,
  expectedUpdatedAt: string,
): Promise<{ record: TerritoryAssignment }> {
  return request(`/api/crm/territory-assignments/${id}`, {
    method: "PATCH",
    json: { input: { effectiveTo }, expectedUpdatedAt },
  });
}

// F020 Stage A2 §8 — quota-plans (tenant.crm_quota_plans) is a real,
// already-migrated generic resource FK'd to team/territory/user, with
// zero frontend consumer before this pass (confirmed by grep). Reuses
// the same generic /api/crm/[resource] boundary.
export async function listQuotaPlans(): Promise<CrmListResponse<QuotaPlan>> {
  return request("/api/crm/quota-plans?limit=100");
}
export async function createQuotaPlan(
  input: Record<string, unknown>,
): Promise<{ record: QuotaPlan }> {
  return request("/api/crm/quota-plans", { method: "POST", json: input });
}
export async function updateQuotaPlan(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: QuotaPlan }> {
  return request(`/api/crm/quota-plans/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}
export async function archiveQuotaPlan(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: QuotaPlan }> {
  const response = await fetch(
    `/api/crm/quota-plans/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// F020: which territory a lead with these details would fall in.
export type TerritoryMatch = {
  territoryId: string;
  code: string;
  name: string;
  matchedOn: string[];
  alternatives: Array<{
    territoryId: string;
    name: string;
    matchedOn: string[];
  }>;
} | null;
export async function checkTerritoryMatch(lead: {
  countryCode?: string;
  state?: string;
  city?: string;
  industry?: string;
}): Promise<{ match: TerritoryMatch }> {
  const params = new URLSearchParams(
    Object.entries(lead).filter(([, value]) => value && value.trim()) as Array<
      [string, string]
    >,
  );
  return request(`/api/crm/territory-match?${params.toString()}`);
}
