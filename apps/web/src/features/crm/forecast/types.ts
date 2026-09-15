// getCrmReport(client, context, "forecast", filters)'s row shape
// (services/api/src/modules/crm/pipeline-analytics-and-forecasting/
// analytics-service.js) — grouped by opportunity owner. For a sales
// manager without crm.records.view_all, this now also rolls up their
// active team members via ownerVisibleForForecast(), not just their own
// deals (see the register's Checkpoint re-audit #3).
export type CrmForecastRow = {
  owner: string;
  // ::numeric-cast SQL aggregates — node-postgres returns these as strings
  // at runtime, not numbers (see shared/format.ts's money()).
  pipeline: number | string;
  weighted: number | string;
  won: number | string;
};

export type CrmForecastFilters = { from?: string; to?: string };

// tenant.crm_forecast_periods / crm_forecast_submissions via the generic
// /api/crm/[resource] boundary — F025's own dossier names "submit, roll
// up, adjust and later reproduce a forecast period" as its primary
// capability (F025-CAP-001), not the read-only aggregate view this
// screen had before this pass. Both tables/resources already existed,
// fully field-complete, with zero frontend consumer (confirmed by grep).
export type ForecastPeriod = {
  id: string;
  companyId: string | null;
  name: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  currencyCode: string | null;
  freezeAt: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type ForecastSubmission = {
  id: string;
  companyId: string | null;
  periodId: string;
  teamId: string | null;
  territoryId: string | null;
  ownerUserId: string;
  // numeric(18,2)-shaped amounts — see CrmForecastRow's own caveat.
  pipelineAmount: number | string | null;
  bestCaseAmount: number | string | null;
  commitAmount: number | string | null;
  closedAmount: number | string | null;
  managerAdjustment: number | string | null;
  currencyCode: string | null;
  confidencePercent: number | string | null;
  notes: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
