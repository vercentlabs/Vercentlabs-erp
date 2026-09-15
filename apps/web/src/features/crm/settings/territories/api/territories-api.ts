"use client";

import type { CrmListResponse, SalesTeam, Territory } from "../types";

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
