"use client";

import type { CrmReportFilters, CrmReportResult } from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class CrmReportApiError extends CrmApiError {}

const { parseResponse } = crmApiClient(CrmReportApiError);

export async function getCrmReportData(
  report: string,
  filters: CrmReportFilters,
): Promise<{ report: CrmReportResult }> {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  const response = await fetch(
    `/api/crm/reports/${encodeURIComponent(report)}${query ? `?${query}` : ""}`,
  );
  return parseResponse(response);
}
