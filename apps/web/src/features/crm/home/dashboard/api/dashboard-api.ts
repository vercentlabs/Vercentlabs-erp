"use client";

import type { CrmDashboard, CrmDashboardScope } from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class CrmDashboardApiError extends CrmApiError {}

const { parseResponse } = crmApiClient(CrmDashboardApiError);

export async function getCrmDashboardData(
  options: { scope?: CrmDashboardScope; from?: string; to?: string } = {},
): Promise<{ dashboard: CrmDashboard }> {
  const params = new URLSearchParams();
  if (options.scope) params.set("scope", options.scope);
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  const query = params.toString();
  const response = await fetch(`/api/crm/dashboard${query ? `?${query}` : ""}`);
  return parseResponse(response);
}
