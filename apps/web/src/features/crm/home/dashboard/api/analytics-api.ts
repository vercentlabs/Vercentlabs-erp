"use client";

import { CrmDashboardApiError } from "./dashboard-api.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

// Canonical pipeline analytics (services/api/.../pipeline-metrics.js). The
// dashboard, its drill-downs and breakdowns share one filter set, so every
// figure reconciles with the records it opens.

export type PipelineFilters = {
  from?: string;
  to?: string;
  scope?: string;
  pipelineId?: string;
  stageId?: string;
  teamId?: string;
  ownerId?: string;
  sourceId?: string;
  forecastCategory?: string;
};

const PIPELINE_FILTER_KEYS: Array<keyof PipelineFilters> = [
  "from",
  "to",
  "scope",
  "pipelineId",
  "stageId",
  "teamId",
  "ownerId",
  "sourceId",
  "forecastCategory",
];

type MetricDefinition = {
  key: string;
  label: string;
  unit: "money" | "count" | "percent";
  population: string;
  populationLabel: string;
  measure: string;
  timeBasis: string;
};

type PipelineCurrency = {
  reportingCurrency: string | null;
  unconvertedCount: number;
  unconvertedCurrencies: string[];
};

export type PipelineDashboard = {
  metricVersion: string;
  filters: Required<PipelineFilters> & { asOf: string };
  metrics: Record<string, number | null>;
  currency: PipelineCurrency;
  byStage: Array<{
    key: string | null;
    label: string;
    count: number;
    value: number;
    unconvertedCount: number;
  }>;
  definitions: MetricDefinition[];
};

type DrilldownRecord = {
  id: string;
  code: string;
  name: string;
  status: string;
  stageName: string | null;
  ownerName: string | null;
  teamName: string | null;
  forecastCategory: string;
  probability: number | null;
  amount: number;
  currencyCode: string;
  fxRate: number | null;
  amountReporting: number | null;
  weightedReporting: number | null;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  stalled: boolean;
};

export type MetricDrilldown = {
  metric: string;
  definition: MetricDefinition;
  summary: { count: number; value: number; unconvertedCount: number };
  records: DrilldownRecord[];
  nextCursor: string | null;
};

function toSearch(
  filters: PipelineFilters,
  extra: Record<string, string | null | undefined> = {},
) {
  const params = new URLSearchParams();
  for (const key of PIPELINE_FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra))
    if (value) params.set(key, value);
  return params.toString();
}

const { parseResponse: parse } = crmApiClient(CrmDashboardApiError);

export async function getPipelineDashboard(
  filters: PipelineFilters,
): Promise<PipelineDashboard> {
  const payload = await parse<{ dashboard: PipelineDashboard }>(
    await fetch(`/api/crm/analytics/pipeline?${toSearch(filters)}`),
  );
  return payload.dashboard;
}

export async function getMetricDrilldown(
  metric: string,
  filters: PipelineFilters,
  cursor?: string | null,
): Promise<MetricDrilldown> {
  const payload = await parse<{ drilldown: MetricDrilldown }>(
    await fetch(
      `/api/crm/analytics/drilldown?${toSearch(filters, { metric, cursor: cursor ?? null, limit: "50" })}`,
    ),
  );
  return payload.drilldown;
}
