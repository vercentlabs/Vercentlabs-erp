"use client";

import type { CrmForecastFilters, CrmForecastRow, CrmListResponse, ForecastPeriod, ForecastSubmission } from "../types";

export class CrmForecastApiError extends Error {
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
    throw new CrmForecastApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// Reuses getCrmReport("forecast", ...) via the same /api/crm/reports/[report]
// boundary the Reports screen uses — no separate backend route.
export async function getCrmForecast(filters: CrmForecastFilters): Promise<{ report: { rows: CrmForecastRow[]; filters: { from: string | null; to: string | null } } }> {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  const response = await fetch(`/api/crm/reports/forecast${query ? `?${query}` : ""}`);
  return parseResponse(response);
}

// F025 Tranche K — the periods admin surface + a rep's own submission
// for a period. Both reuse the generic /api/crm/[resource] boundary
// (forecast-periods/forecast-submissions were already fully field-
// complete, zero frontend consumer before this pass).
export async function listForecastPeriods(): Promise<CrmListResponse<ForecastPeriod>> {
  const response = await fetch("/api/crm/forecast-periods?limit=100");
  return parseResponse(response);
}
export async function createForecastPeriod(input: Record<string, unknown>): Promise<{ record: ForecastPeriod }> {
  const response = await fetch("/api/crm/forecast-periods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}

export async function listForecastSubmissions(periodId: string): Promise<CrmListResponse<ForecastSubmission>> {
  const response = await fetch(`/api/crm/forecast-submissions?periodId=${encodeURIComponent(periodId)}&limit=200`);
  return parseResponse(response);
}
export async function createForecastSubmission(input: Record<string, unknown>): Promise<{ record: ForecastSubmission }> {
  const response = await fetch("/api/crm/forecast-submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateForecastSubmission(id: string, input: Record<string, unknown>, expectedUpdatedAt?: string): Promise<{ record: ForecastSubmission }> {
  const response = await fetch(`/api/crm/forecast-submissions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, expectedUpdatedAt }) });
  return parseResponse(response);
}
