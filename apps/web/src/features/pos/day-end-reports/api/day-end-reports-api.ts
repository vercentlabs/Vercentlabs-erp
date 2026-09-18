"use client";

import type { PosDayEndReport, PosDayEndReportCorrection } from "@vercentlabs/api";

import { request, post } from "@/features/pos/shared/http";

// F303 Day-end / Z report
export type PosDayEndReportFilters = {
  storeId?: string;
  terminalId?: string;
  status?: string;
  scopeType?: string;
  businessDateFrom?: string;
  businessDateTo?: string;
  limit?: number;
  offset?: number;
};
export const listPosDayEndReports = (query: PosDayEndReportFilters = {}) => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "") as [string, string][],
  );
  return request<{ rows: PosDayEndReport[] }>(`/reports/day-end${params.size ? `?${params}` : ""}`);
};
export const getPosDayEndReport = (id: string) => request<{ report: PosDayEndReport & { corrections: PosDayEndReportCorrection[] } }>(`/reports/day-end/${id}`);
export const generatePosDayEndReport = (input: Record<string, unknown>) => post<{ report: PosDayEndReport }>("/reports/day-end", input);
export const reviewPosDayEndReport = (id: string, input: Record<string, unknown> = {}) => post<{ report: PosDayEndReport }>(`/reports/day-end/${id}/review`, input);
export const finalizePosDayEndReport = (id: string, input: Record<string, unknown> = {}) => post<{ report: PosDayEndReport }>(`/reports/day-end/${id}/finalize`, input);
export const recordPosDayEndVariance = (id: string, input: Record<string, unknown>) => post<{ correction: PosDayEndReportCorrection }>(`/reports/day-end/${id}/variance`, input);
