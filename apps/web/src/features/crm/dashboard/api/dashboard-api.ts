"use client";

import type { CrmDashboard, CrmDashboardScope } from "../types";

export class CrmDashboardApiError extends Error {
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
    throw new CrmDashboardApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function getCrmDashboardData(options: { scope?: CrmDashboardScope; from?: string; to?: string } = {}): Promise<{ dashboard: CrmDashboard }> {
  const params = new URLSearchParams();
  if (options.scope) params.set("scope", options.scope);
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  const query = params.toString();
  const response = await fetch(`/api/crm/dashboard${query ? `?${query}` : ""}`);
  return parseResponse(response);
}
