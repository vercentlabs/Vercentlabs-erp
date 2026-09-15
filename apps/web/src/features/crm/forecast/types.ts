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
