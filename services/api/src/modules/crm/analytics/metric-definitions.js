// The ONE catalogue of CRM pipeline and forecast measures (F024 dashboard,
// F025 forecast, F030 reports). Each metric names its population (which
// opportunities count), its measure (what is added up) and its time basis.
// Every consumer computes a metric from opportunity-facts.js through
// pipeline-metrics.js, so a KPI tile, its drill-down, a forecast rollup and
// a report row cannot disagree: the drill-down total IS the KPI.
//
// Currency: amounts are converted to the organisation's base (reporting)
// currency with tenant.exchange_rates (the shared, dated rate table Accounting
// uses): the latest active rate on or before the valuation date. Valuation
// date: the close date for won/lost deals, the as-of date (today) for open
// deals. Conversion keeps full precision; sums are rounded half away from zero
// to 2 decimals once, at the aggregate. A deal whose currency has no rate is
// never added at face value: it is excluded from money totals and reported as
// "unconverted" (count and currencies), still visible in drill-downs.
//
// Forecast categories are cumulative, as in most CRMs: Commit = committed;
// Best case = committed + best case; Pipeline = every open deal not omitted.

export const METRIC_VERSION = "crm-metrics-2026.09";

const PERIOD_OPEN = "f.status='open' AND f.expected_close_date BETWEEN {from} AND {to}";
const PERIOD_CLOSED = (status) => `f.status='${status}' AND f.actual_close_date BETWEEN {from} AND {to}`;

export const METRIC_POPULATIONS = Object.freeze({
  open: { label: "Open opportunities", sql: "f.status='open'", period: false },
  closing: { label: "Open, expected to close in the period", sql: PERIOD_OPEN, period: true },
  commit: { label: "Commit: open, closing in the period, category Commit", sql: `${PERIOD_OPEN} AND f.forecast_category='committed'`, period: true },
  best_case: { label: "Best case: open, closing in the period, category Commit or Best case", sql: `${PERIOD_OPEN} AND f.forecast_category IN ('committed','best_case')`, period: true },
  forecast_pipeline: { label: "Pipeline: open, closing in the period, not omitted", sql: `${PERIOD_OPEN} AND f.forecast_category<>'omitted'`, period: true },
  won: { label: "Won in the period (actual close date)", sql: PERIOD_CLOSED("won"), period: true },
  lost: { label: "Lost in the period (actual close date)", sql: PERIOD_CLOSED("lost"), period: true },
  closed: { label: "Won or lost in the period", sql: "f.status IN ('won','lost') AND f.actual_close_date BETWEEN {from} AND {to}", period: true },
  stalled: { label: "Open and past the stage's stall threshold", sql: "f.status='open' AND f.stalled", period: false },
  unassigned: { label: "Open with no owner", sql: "f.status='open' AND f.owner_user_id IS NULL", period: false },
});

// measure: "count" | "amount" (converted amount) | "weighted" (converted
// expected revenue = amount x probability / 100, F011).
export const PIPELINE_METRICS = Object.freeze({
  open_opportunities: { label: "Open opportunities", unit: "count", population: "open", measure: "count", timeBasis: "Current state" },
  open_pipeline: { label: "Open pipeline", unit: "money", population: "open", measure: "amount", timeBasis: "Current state" },
  weighted_pipeline: { label: "Weighted pipeline", unit: "money", population: "open", measure: "weighted", timeBasis: "Current state" },
  closing_opportunities: { label: "Deals closing in period", unit: "count", population: "closing", measure: "count", timeBasis: "Expected close date in the period" },
  closing_in_period: { label: "Closing in period", unit: "money", population: "closing", measure: "amount", timeBasis: "Expected close date in the period" },
  weighted_closing: { label: "Weighted closing in period", unit: "money", population: "closing", measure: "weighted", timeBasis: "Expected close date in the period" },
  commit: { label: "Commit", unit: "money", population: "commit", measure: "amount", timeBasis: "Expected close date in the period" },
  best_case: { label: "Best case", unit: "money", population: "best_case", measure: "amount", timeBasis: "Expected close date in the period" },
  forecast_pipeline: { label: "Forecast pipeline", unit: "money", population: "forecast_pipeline", measure: "amount", timeBasis: "Expected close date in the period" },
  won_amount: { label: "Won", unit: "money", population: "won", measure: "amount", timeBasis: "Actual close date in the period" },
  won_count: { label: "Deals won", unit: "count", population: "won", measure: "count", timeBasis: "Actual close date in the period" },
  lost_amount: { label: "Lost", unit: "money", population: "lost", measure: "amount", timeBasis: "Actual close date in the period" },
  lost_count: { label: "Deals lost", unit: "count", population: "lost", measure: "count", timeBasis: "Actual close date in the period" },
  win_rate: { label: "Win rate", unit: "percent", population: "closed", measure: "ratio", numerator: "won_count", denominator: "closed_count", timeBasis: "Actual close date in the period" },
  stalled_opportunities: { label: "Stalled opportunities", unit: "count", population: "stalled", measure: "count", timeBasis: "Current state" },
  unassigned_opportunities: { label: "Unassigned opportunities", unit: "count", population: "unassigned", measure: "count", timeBasis: "Current state" },
});

export const BREAKDOWN_DIMENSIONS = Object.freeze({
  stage: { label: "Stage", key: "f.stage_id", name: "COALESCE(f.stage_name,'No stage')", order: "min(f.stage_sequence)" },
  owner: { label: "Owner", key: "f.owner_user_id", name: "COALESCE(f.owner_name,'Unassigned')", order: null },
  team: { label: "Sales team", key: "f.team_id", name: "COALESCE(f.team_name,'No team')", order: null },
  source: { label: "Source", key: "f.source_id", name: "COALESCE(f.source_name,'Unspecified')", order: null },
  forecast_category: { label: "Forecast category", key: "f.forecast_category", name: "f.forecast_category", order: null },
  pipeline: { label: "Pipeline", key: "f.pipeline_id", name: "COALESCE(f.pipeline_name,'No pipeline')", order: null },
  close_month: { label: "Close month", key: "to_char(COALESCE(f.actual_close_date,f.expected_close_date),'YYYY-MM')", name: "to_char(COALESCE(f.actual_close_date,f.expected_close_date),'YYYY-MM')", order: "min(COALESCE(f.actual_close_date,f.expected_close_date))" },
});

export function metricDefinition(key) {
  const metric = PIPELINE_METRICS[key];
  if (!metric) return null;
  return { key, ...metric, populationLabel: METRIC_POPULATIONS[metric.population].label };
}

export function listMetricDefinitions() {
  return Object.keys(PIPELINE_METRICS).map(metricDefinition);
}
