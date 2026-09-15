"use client";

import type { CrmDashboard } from "../types";

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

export async function getCrmDashboardData(): Promise<{ dashboard: CrmDashboard }> {
  const response = await fetch("/api/crm/dashboard");
  return parseResponse(response);
}
