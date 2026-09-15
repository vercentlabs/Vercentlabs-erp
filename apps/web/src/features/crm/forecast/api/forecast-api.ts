"use client";

import type { CrmForecastFilters, CrmForecastRow } from "../types";

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
