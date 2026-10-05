import { CrmError } from "../data-management/errors.js";
import { canViewAllCrmResource } from "../data-management/crm-access-scope.js";
import { addParameter, camelizeRow, managedTeamMembersSql } from "../data-management/record-utils.js";
import { BREAKDOWN_DIMENSIONS, listMetricDefinitions, METRIC_POPULATIONS, METRIC_VERSION, PIPELINE_METRICS } from "./metric-definitions.js";
import { bindPeriod, normalizeAnalyticsFilters, opportunityFactsCte, primaryTeamSql, teamSubtreeSql } from "./opportunity-facts.js";

// Computes every pipeline/forecast measure from opportunity-facts.js, so a
// KPI, its breakdown rows and its drill-down records are the same query over
// the same population (metric-definitions.js).

// FILTER must sit on the aggregate itself, inside any cast or round().
const MEASURE_SQL = Object.freeze({
  count: (where = "true") => `(count(*) FILTER (WHERE ${where}))::int`,
  amount: (where = "true") => `round(COALESCE(sum(f.amount_reporting) FILTER (WHERE ${where}),0),2)`,
  weighted: (where = "true") => `round(COALESCE(sum(f.weighted_reporting) FILTER (WHERE ${where}),0),2)`,
});

const unknownMetric = () => new CrmError(400, "Unknown pipeline metric.", "CRM_ANALYTICS_METRIC_UNKNOWN");

function populationSql(key, filters, parameters) {
  const population = METRIC_POPULATIONS[key];
  if (!population) throw unknownMetric();
  return `(${bindPeriod(population.sql, filters, parameters)})`;
}

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/** Every KPI in the catalogue, plus the unconverted-currency disclosure. */
export async function getPipelineMetrics(client, context, rawFilters = {}) {
  const filters = normalizeAnalyticsFilters(rawFilters);
  const parameters = [];
  const facts = opportunityFactsCte(context, filters, parameters);
  const selects = [];
  for (const [key, metric] of Object.entries(PIPELINE_METRICS)) {
    if (metric.measure === "ratio") continue;
    selects.push(`${MEASURE_SQL[metric.measure](populationSql(metric.population, filters, parameters))} AS ${key}`);
  }
  selects.push(`count(*) FILTER (WHERE ${populationSql("closed", filters, parameters)})::int AS closed_count`);
  const relevant = `(${populationSql("open", filters, parameters)} OR ${populationSql("closed", filters, parameters)})`;
  selects.push(`count(*) FILTER (WHERE f.fx_rate IS NULL AND ${relevant})::int AS unconverted_count`);
  selects.push(`COALESCE(array_agg(DISTINCT f.currency_code) FILTER (WHERE f.fx_rate IS NULL AND ${relevant}), '{}') AS unconverted_currencies`);
  selects.push(`(SELECT base_currency FROM public.organizations WHERE id=${addParameter(parameters, context.organizationId)}) AS reporting_currency`);
  const { rows } = await client.query(`WITH ${facts} SELECT ${selects.join(",\n  ")} FROM opportunity_facts f`, parameters);
  const row = rows[0] || {};
  const metrics = {};
  for (const [key, metric] of Object.entries(PIPELINE_METRICS)) {
    if (metric.measure === "ratio") {
      const numerator = Number(row[metric.numerator] || 0);
      const denominator = Number(row[metric.denominator] || 0);
      metrics[key] = denominator ? Math.round((numerator / denominator) * 10000) / 100 : null;
    } else metrics[key] = toNumber(row[key]);
  }
  return {
    metricVersion: METRIC_VERSION,
    filters,
    metrics,
    counts: { closed: Number(row.closed_count || 0) },
    currency: {
      reportingCurrency: row.reporting_currency || null,
      unconvertedCount: Number(row.unconverted_count || 0),
      unconvertedCurrencies: row.unconverted_currencies || [],
    },
  };
}

/** One metric grouped by a dimension; the rows add up to the KPI. */
export async function getPipelineBreakdown(client, context, { metric: metricKey, dimension: dimensionKey, filters: rawFilters = {} } = {}) {
  const metric = PIPELINE_METRICS[metricKey];
  if (!metric || metric.measure === "ratio") throw unknownMetric();
  const dimension = BREAKDOWN_DIMENSIONS[dimensionKey];
  if (!dimension) throw new CrmError(400, "Unknown breakdown dimension.", "CRM_ANALYTICS_DIMENSION_UNKNOWN");
  const filters = normalizeAnalyticsFilters(rawFilters);
  const parameters = [];
  const facts = opportunityFactsCte(context, filters, parameters);
  const population = populationSql(metric.population, filters, parameters);
  const { rows } = await client.query(
    `WITH ${facts}
     SELECT ${dimension.key}::text AS key, ${dimension.name} AS label, count(*)::int AS count, ${MEASURE_SQL[metric.measure]()} AS value,
            count(*) FILTER (WHERE f.fx_rate IS NULL)::int AS unconverted_count
       FROM opportunity_facts f WHERE ${population}
      GROUP BY 1, 2
      ORDER BY ${dimension.order ? `${dimension.order}, ` : ""}value DESC, label`,
    parameters,
  );
  return {
    metric: metricKey,
    dimension: dimensionKey,
    filters,
    rows: rows.map((row) => ({ key: row.key, label: row.label, count: row.count, value: Number(row.value), unconvertedCount: row.unconverted_count })),
  };
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (typeof value?.k !== "number" || typeof value?.id !== "string") throw new Error("shape");
    return value;
  } catch {
    throw new CrmError(400, "The page cursor is invalid.", "CRM_ANALYTICS_CURSOR_INVALID");
  }
}

/**
 * The exact records behind a KPI, keyset-paged (largest converted value
 * first), with the population total computed by the same statement shape as
 * the KPI — `summary.value` equals the dashboard figure for the same filters.
 */
export async function getMetricDrilldown(client, context, { metric: metricKey, filters: rawFilters = {}, cursor = null, limit = 50 } = {}) {
  const metric = PIPELINE_METRICS[metricKey];
  if (!metric) throw unknownMetric();
  const filters = normalizeAnalyticsFilters(rawFilters);
  const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 50));
  const after = decodeCursor(cursor);
  const parameters = [];
  const facts = opportunityFactsCte(context, filters, parameters);
  const population = populationSql(metric.population, filters, parameters);
  const sortKey = metric.measure === "weighted" ? "COALESCE(f.weighted_reporting,-1)" : "COALESCE(f.amount_reporting,-1)";
  const keyset = after ? ` AND (${sortKey}, f.id) < (${addParameter(parameters, after.k)}::numeric, ${addParameter(parameters, after.id)}::uuid)` : "";
  const limitParam = addParameter(parameters, pageSize + 1);
  const measure = metric.measure === "ratio" ? "count" : metric.measure;
  const { rows } = await client.query(
    `WITH ${facts},
     population AS (SELECT f.* FROM opportunity_facts f WHERE ${population})
     SELECT page.*, summary.total_count, summary.total_value, summary.unconverted_count
       FROM (SELECT count(*)::int AS total_count, ${MEASURE_SQL[measure]()} AS total_value, count(*) FILTER (WHERE f.fx_rate IS NULL)::int AS unconverted_count FROM population f) summary
       LEFT JOIN LATERAL (
         SELECT f.id, f.code, f.name, f.status, f.stage_id, f.stage_name, f.owner_user_id, f.owner_name, f.team_id, f.team_name,
                f.forecast_category, f.probability, f.amount, f.currency_code, f.fx_rate, f.fx_rate_date,
                round(f.amount_reporting,2) AS amount_reporting, round(f.weighted_reporting,2) AS weighted_reporting,
                f.expected_close_date, f.actual_close_date, f.stalled, ${sortKey} AS sort_key
           FROM population f WHERE true${keyset}
          ORDER BY ${sortKey} DESC, f.id DESC LIMIT ${limitParam}) page ON true`,
    parameters,
  );
  const summaryRow = rows[0] || {};
  const records = rows.filter((row) => row.id).map((row) => {
    const { sort_key: _sortKey, total_count: _count, total_value: _value, unconverted_count: _unconverted, ...record } = row;
    return camelizeRow(record);
  });
  const hasMore = records.length > pageSize;
  const page = hasMore ? records.slice(0, pageSize) : records;
  const last = rows.filter((row) => row.id)[page.length - 1];
  const value = metric.measure === "count" || metric.measure === "ratio" ? Number(summaryRow.total_count || 0) : Number(summaryRow.total_value || 0);
  return {
    metric: metricKey,
    definition: listMetricDefinitions().find((definition) => definition.key === metricKey),
    filters,
    summary: { count: Number(summaryRow.total_count || 0), value, unconvertedCount: Number(summaryRow.unconverted_count || 0) },
    records: page.map((record) => ({
      ...record,
      amount: Number(record.amount || 0),
      probability: toNumber(record.probability),
      fxRate: toNumber(record.fxRate),
      amountReporting: toNumber(record.amountReporting),
      weightedReporting: toNumber(record.weightedReporting),
    })),
    nextCursor: hasMore && last ? encodeCursor({ k: Number(last.sort_key), id: String(last.id) }) : null,
  };
}





/**
 * Several metrics grouped by one dimension in a single pass (forecast
 * rollups, report rows). Ratio metrics are derived per group.
 */
export async function getMetricRollup(client, context, { dimension: dimensionKey, metrics: metricKeys, filters: rawFilters = {} } = {}) {
  const dimension = BREAKDOWN_DIMENSIONS[dimensionKey];
  if (!dimension) throw new CrmError(400, "Unknown breakdown dimension.", "CRM_ANALYTICS_DIMENSION_UNKNOWN");
  const keys = [...new Set(metricKeys)];
  if (!keys.length || keys.some((key) => !PIPELINE_METRICS[key])) throw unknownMetric();
  const filters = normalizeAnalyticsFilters(rawFilters);
  const parameters = [];
  const facts = opportunityFactsCte(context, filters, parameters);
  const selects = [];
  const needed = new Set(keys.flatMap((key) => (PIPELINE_METRICS[key].measure === "ratio" ? [PIPELINE_METRICS[key].numerator] : [key])));
  for (const key of needed) {
    if (key === "closed_count") continue;
    const metric = PIPELINE_METRICS[key];
    selects.push(`${MEASURE_SQL[metric.measure](populationSql(metric.population, filters, parameters))} AS ${key}`);
  }
  selects.push(`count(*) FILTER (WHERE ${populationSql("closed", filters, parameters)})::int AS closed_count`);
  // Groups with nothing relevant to any requested metric are dropped.
  const relevant = [...new Set(keys.map((key) => PIPELINE_METRICS[key].population))].map((population) => populationSql(population, filters, parameters)).join(" OR ");
  const { rows } = await client.query(
    `WITH ${facts}
     SELECT ${dimension.key}::text AS key, ${dimension.name} AS label, ${selects.join(", ")}
       FROM opportunity_facts f WHERE ${relevant}
      GROUP BY 1, 2 ORDER BY ${dimension.order ? `${dimension.order}, ` : ""}label`,
    parameters,
  );
  return {
    dimension: dimensionKey,
    filters,
    rows: rows.map((row) => {
      const values = {};
      for (const key of keys) {
        const metric = PIPELINE_METRICS[key];
        if (metric.measure === "ratio") {
          const denominator = Number(row[metric.denominator] || 0);
          values[key] = denominator ? Math.round((Number(row[metric.numerator] || 0) / denominator) * 10000) / 100 : null;
        } else values[key] = Number(row[key] || 0);
      }
      return { key: row.key, label: row.label, values };
    }),
  };
}

/** F024 dashboard payload: KPIs and the stage breakdown, one filter set. */
export async function getPipelineDashboard(client, context, rawFilters = {}) {
  const filters = normalizeAnalyticsFilters(rawFilters);
  const summary = await getPipelineMetrics(client, context, filters);
  const byStage = await getPipelineBreakdown(client, context, { metric: "open_pipeline", dimension: "stage", filters });
  return { ...summary, byStage: byStage.rows, definitions: listMetricDefinitions() };
}
