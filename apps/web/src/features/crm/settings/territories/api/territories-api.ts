"use client";

import type { CrmListResponse, QuotaPlan, SalesTeam, SalesTeamMember, Territory, TerritoryAssignment } from "../types";

export class SettingsApiError extends Error {
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
    throw new SettingsApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// Both resources reuse the generic /api/crm/[resource] boundary — no
// dedicated routes exist or are needed (see resource-permissions.ts for
// the crm.settings.manage gate applied to both).
export async function listSalesTeams(): Promise<CrmListResponse<SalesTeam>> {
  const response = await fetch("/api/crm/sales-teams?limit=100");
  return parseResponse(response);
}
export async function createSalesTeam(input: Record<string, unknown>): Promise<{ record: SalesTeam }> {
  const response = await fetch("/api/crm/sales-teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateSalesTeam(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: SalesTeam }> {
  const response = await fetch(`/api/crm/sales-teams/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, expectedUpdatedAt }) });
  return parseResponse(response);
}
export async function archiveSalesTeam(id: string, expectedUpdatedAt: string): Promise<{ record: SalesTeam }> {
  const response = await fetch(`/api/crm/sales-teams/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function listTerritories(): Promise<CrmListResponse<Territory>> {
  const response = await fetch("/api/crm/territories?limit=100");
  return parseResponse(response);
}
export async function createTerritory(input: Record<string, unknown>): Promise<{ record: Territory }> {
  const response = await fetch("/api/crm/territories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateTerritory(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: Territory }> {
  const response = await fetch(`/api/crm/territories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, expectedUpdatedAt }) });
  return parseResponse(response);
}
export async function archiveTerritory(id: string, expectedUpdatedAt: string): Promise<{ record: Territory }> {
  const response = await fetch(`/api/crm/territories/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

// Membership is effective-dated, not a separate lifecycle object — "ending"
// a membership archives it (crm_sales_team_members.status -> inactive, a
// real archive transition the generic mutation service already supports).
export async function listSalesTeamMembers(teamId: string): Promise<CrmListResponse<SalesTeamMember>> {
  const response = await fetch(`/api/crm/sales-team-members?teamId=${encodeURIComponent(teamId)}&limit=100`);
  return parseResponse(response);
}
export async function createSalesTeamMember(input: Record<string, unknown>): Promise<{ record: SalesTeamMember }> {
  const response = await fetch("/api/crm/sales-team-members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function archiveSalesTeamMember(id: string, expectedUpdatedAt: string): Promise<{ record: SalesTeamMember }> {
  const response = await fetch(`/api/crm/sales-team-members/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

// territory-assignments has no statusColumn/archive transition in the
// resource registry — it is purely effective-dated. "Ending" an assignment
// means setting effectiveTo, an update, never a DELETE (which the generic
// mutation service would reject with CRM_ARCHIVE_UNSUPPORTED for this
// resource).
export async function listTerritoryAssignments(territoryId: string): Promise<CrmListResponse<TerritoryAssignment>> {
  const response = await fetch(`/api/crm/territory-assignments?territoryId=${encodeURIComponent(territoryId)}&limit=100`);
  return parseResponse(response);
}
export async function createTerritoryAssignment(input: Record<string, unknown>): Promise<{ record: TerritoryAssignment }> {
  const response = await fetch("/api/crm/territory-assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function endTerritoryAssignment(id: string, effectiveTo: string, expectedUpdatedAt: string): Promise<{ record: TerritoryAssignment }> {
  const response = await fetch(`/api/crm/territory-assignments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: { effectiveTo }, expectedUpdatedAt }),
  });
  return parseResponse(response);
}

// F020 Stage A2 §8 — quota-plans (tenant.crm_quota_plans) is a real,
// already-migrated generic resource FK'd to team/territory/user, with
// zero frontend consumer before this pass (confirmed by grep). Reuses
// the same generic /api/crm/[resource] boundary.
export async function listQuotaPlans(): Promise<CrmListResponse<QuotaPlan>> {
  const response = await fetch("/api/crm/quota-plans?limit=100");
  return parseResponse(response);
}
export async function createQuotaPlan(input: Record<string, unknown>): Promise<{ record: QuotaPlan }> {
  const response = await fetch("/api/crm/quota-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateQuotaPlan(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: QuotaPlan }> {
  const response = await fetch(`/api/crm/quota-plans/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, expectedUpdatedAt }) });
  return parseResponse(response);
}
export async function archiveQuotaPlan(id: string, expectedUpdatedAt: string): Promise<{ record: QuotaPlan }> {
  const response = await fetch(`/api/crm/quota-plans/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}
