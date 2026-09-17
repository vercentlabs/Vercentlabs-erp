"use client";

import type { CrmReportFilters, CrmReportResult } from "../types";

export class CrmReportApiError extends Error {
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
    throw new CrmReportApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function getCrmReportData(report: string, filters: CrmReportFilters): Promise<{ report: CrmReportResult }> {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  const response = await fetch(`/api/crm/reports/${encodeURIComponent(report)}${query ? `?${query}` : ""}`);
  return parseResponse(response);
}
