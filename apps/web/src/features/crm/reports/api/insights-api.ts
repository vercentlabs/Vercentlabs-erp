"use client";

// Browser client for the reports added by the CRM plan (3.7): /api/crm/insights/{forecast|trends|pivot|activity|targets}.
import { CrmApiError } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

const { request } = crmApiClient(CrmApiError);
const BASE = "/api/crm/insights";
const query = (input: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type Disclosure = { reportingCurrency: string | null; unconvertedCount: number; unconvertedCurrencies: string[] };
export type ForecastReport = {
  currency: Disclosure; overdue: { deals: number; undated: number; value: number; weighted: number };
  months: Array<{ month: string; deals: number; committed: number; bestCase: number; pipeline: number; weighted: number; won: number; wonDeals: number }>;
};
export type TrendsReport = {
  interval: "week" | "month" | "quarter"; from: string; to: string; currency: string | null; seesLeads: boolean; seesDeals: boolean;
  series: Array<{ period: string; leadsCreated: number; leadsConverted: number; dealsCreated: number; dealsWon: number; wonValue: number; dealsLost: number }>;
};
export type PivotDefinitions = Record<"deals" | "leads", { dimensions: Array<{ key: string; label: string }>; measures: Array<{ key: string; label: string; money?: boolean }> }>;
export type PivotReport = {
  subject: "deals" | "leads"; rows: Array<{ key: string; label: string }>; columns: Array<{ key: string; label: string }>;
  cells: Record<string, Record<string, number>>; rowTotals: Record<string, number>; columnTotals: Record<string, number>; total: number;
  measure: { key: string; label: string; money: boolean }; currency: Disclosure;
};
export type ActivityReport = {
  from: string; to: string; totals: Record<string, number>;
  people: Array<{ userId: string; name: string; calls: number; emails: number; meetings: number; whatsapp: number; sms: number; tasksDone: number; followUpsDone: number;
    overdue: number; leadsTouched: number; dealsTouched: number; total: number }>;
};
export type TargetReport = {
  month: string; canSet: boolean; currency: string | null; metrics: Array<{ key: string; label: string; money?: boolean }>;
  people: Array<{ userId: string; name: string; measures: Record<string, { actual: number; target: number | null; attainment: number | null }> }>;
};

export const getForecast = (months: number) => request<{ report: ForecastReport }>(`${BASE}/forecast${query({ months })}`).then((result) => result.report);
export const getTrends = (input: { interval: string; from?: string; to?: string }) => request<{ report: TrendsReport }>(`${BASE}/trends${query(input)}`).then((result) => result.report);
export const getPivotDefinitions = () => request<{ definitions: PivotDefinitions }>(`${BASE}/pivot-definitions`).then((result) => result.definitions);
export const getPivot = (input: { subject: string; rows: string; columns?: string; measure: string; from?: string; to?: string; status?: string }) =>
  request<{ report: PivotReport }>(`${BASE}/pivot${query(input)}`).then((result) => result.report);
export const getActivityReport = (input: { from?: string; to?: string }) => request<{ report: ActivityReport }>(`${BASE}/activity${query(input)}`).then((result) => result.report);
export const getTargets = (month: string) => request<{ report: TargetReport }>(`${BASE}/targets${query({ month })}`).then((result) => result.report);
export const saveTargets = (month: string, targets: Array<{ userId: string; metric: string; target: number | null }>) =>
  request<{ report: TargetReport }>(`${BASE}/targets`, { method: "PUT", json: { month, targets } }).then((result) => result.report);
