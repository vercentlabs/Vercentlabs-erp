"use client";

import type { CrmListResponse, SalesTeam, SalesTeamMember } from "../types";
import { CrmApiError } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class SettingsApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(SettingsApiError);

// Teams and their members reuse the generic /api/crm/[resource] boundary
// (crm.teams.manage); there are no dedicated routes.
export async function listSalesTeams(): Promise<CrmListResponse<SalesTeam>> {
  return request("/api/crm/sales-teams?limit=100");
}
export async function createSalesTeam(input: Record<string, unknown>): Promise<{ record: SalesTeam }> {
  return request("/api/crm/sales-teams", { method: "POST", json: input });
}
export async function updateSalesTeam(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: SalesTeam }> {
  return request(`/api/crm/sales-teams/${id}`, { method: "PATCH", json: { input, expectedUpdatedAt } });
}
export async function archiveSalesTeam(id: string, expectedUpdatedAt: string): Promise<{ record: SalesTeam }> {
  const response = await fetch(`/api/crm/sales-teams/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

// Members are listed per team (never every team's members at once); removing one archives the membership.
export async function listSalesTeamMembers(teamId: string): Promise<CrmListResponse<SalesTeamMember>> {
  return request(`/api/crm/sales-team-members?teamId=${encodeURIComponent(teamId)}&limit=100`);
}
export async function createSalesTeamMember(input: Record<string, unknown>): Promise<{ record: SalesTeamMember }> {
  return request("/api/crm/sales-team-members", { method: "POST", json: input });
}
export async function archiveSalesTeamMember(id: string, expectedUpdatedAt: string): Promise<{ record: SalesTeamMember }> {
  const response = await fetch(`/api/crm/sales-team-members/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}
