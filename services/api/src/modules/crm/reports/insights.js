// CRM plan 3.7 — the reports Odoo's CRM has that this one lacked: the forecast by expected close month, trends over time, and a free
// pivot over deals or leads. Every figure counts only what the caller may open (the deal facts apply the Deals list's own rule, the lead
// figures the Leads list's), and money is in the organization's base currency at the dated exchange rate, a deal with no rate being left
// out of the sums and disclosed.
import { crmMediumLabel } from "@vercentlabs/shared-types";

import { normalizeAnalyticsFilters, opportunityFactsCte } from "../analytics/opportunity-facts.js";
import { CrmError } from "../data-management/errors.js";
import { reportingCurrencyOf } from "../data-management/reporting-currency.js";
import { leadScopeSql, requireLeadPermission } from "../leads/access.js";
import { LEAD_PERMISSIONS } from "../leads/constants.js";
import { requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";

const ZONE = (org) => `(SELECT org_tz.timezone FROM public.organizations org_tz WHERE org_tz.id = ${org})`;
const num = (value) => Number(value ?? 0);
const invalid = (message) => new CrmError(400, message, "CRM_REPORT_INVALID");

// ------------------------------------------------------------------ forecast by expected close month (CRM-R2)

// The open deals by the month they are expected to close, from this month for `months` months, in their forecast categories, with the
// weighted value and what was actually won in each month; deals whose close date has already passed are shown apart as overdue.
export async function getForecastByMonth(client, context, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view deals.");
  const months = Math.min(Math.max(Number(input.months) || 6, 1), 24);
  const filters = normalizeAnalyticsFilters({ ...input, from: undefined, to: undefined });
  const parameters = [];
  const facts = opportunityFactsCte(context, filters, parameters);
  const org = "$1";
  const monthsParam = `$${parameters.push(months)}`;
  const { rows } = await client.query(
    `WITH ${facts},
     bounds AS (SELECT date_trunc('month', (now() AT TIME ZONE ${ZONE(org)}))::date AS first_month),
     months AS (SELECT (bounds.first_month + make_interval(months => step))::date AS month FROM bounds, generate_series(0, ${monthsParam}::int - 1) AS step)
     SELECT to_char(months.month, 'YYYY-MM') AS month,
            count(open.id)::int AS deals,
            COALESCE(sum(open.amount_reporting) FILTER (WHERE open.forecast_category = 'committed'), 0)::float8 AS committed,
            COALESCE(sum(open.amount_reporting) FILTER (WHERE open.forecast_category = 'best_case'), 0)::float8 AS best_case,
            COALESCE(sum(open.amount_reporting) FILTER (WHERE open.forecast_category NOT IN ('committed', 'best_case', 'omitted')), 0)::float8 AS pipeline,
            COALESCE(sum(open.weighted_reporting) FILTER (WHERE open.forecast_category <> 'omitted'), 0)::float8 AS weighted,
            count(open.id) FILTER (WHERE open.fx_rate IS NULL)::int AS unconverted,
            (SELECT COALESCE(sum(won.won_reporting), 0)::float8 FROM opportunity_facts won
              WHERE won.status = 'won' AND date_trunc('month', won.actual_close_date)::date = months.month) AS won,
            (SELECT count(*)::int FROM opportunity_facts won WHERE won.status = 'won' AND date_trunc('month', won.actual_close_date)::date = months.month) AS won_deals
       FROM months
       LEFT JOIN opportunity_facts open ON open.status = 'open' AND date_trunc('month', open.expected_close_date)::date = months.month
      GROUP BY months.month ORDER BY months.month`, parameters);
  const overdueParameters = [];
  const overdue = (await client.query(
    `WITH ${opportunityFactsCte(context, filters, overdueParameters)}
     SELECT count(*)::int AS deals, COALESCE(sum(amount_reporting), 0)::float8 AS value, COALESCE(sum(weighted_reporting), 0)::float8 AS weighted,
            count(*) FILTER (WHERE expected_close_date IS NULL)::int AS undated
       FROM opportunity_facts WHERE status = 'open' AND (expected_close_date IS NULL OR expected_close_date < date_trunc('month', (now() AT TIME ZONE ${ZONE("$1")}))::date)`,
    overdueParameters)).rows[0];
  const currency = await reportingCurrencyOf(client, context.organizationId);
  return {
    currency: { reportingCurrency: currency, unconvertedCount: rows.reduce((total, row) => total + num(row.unconverted), 0), unconvertedCurrencies: [] },
    months: rows.map((row) => ({
      month: row.month, deals: row.deals, committed: num(row.committed), bestCase: num(row.best_case), pipeline: num(row.pipeline),
      weighted: num(row.weighted), won: num(row.won), wonDeals: row.won_deals,
    })),
    overdue: { deals: overdue.deals, undated: overdue.undated, value: num(overdue.value), weighted: num(overdue.weighted) },
  };
}

// ------------------------------------------------------------------ trends (CRM-R3)

const INTERVALS = new Set(["week", "month", "quarter"]);

// Leads in, leads converted, deals made, won and lost, per week, month or quarter (in the organization's time zone), over a period.
export async function getCrmTrends(client, context, input = {}) {
  const interval = INTERVALS.has(input.interval) ? input.interval : "month";
  const filters = normalizeAnalyticsFilters(input.from ? input : { ...input, from: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10) });
  const seesLeads = (() => { try { requireLeadPermission(context, LEAD_PERMISSIONS.view); return true; } catch { return false; } })();
  const seesDeals = (() => { try { requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view); return true; } catch { return false; } })();
  if (!seesLeads && !seesDeals) throw new CrmError(403, "You do not have permission to view leads or deals.", "PERMISSION_DENIED");
  const buckets = (await client.query(
    `SELECT to_char(bucket, 'YYYY-MM-DD') AS bucket FROM generate_series(date_trunc($1, $2::date), date_trunc($1, $3::date), ('1 ' || $1)::interval) AS bucket`,
    [interval, filters.from, filters.to])).rows.map((row) => row.bucket);
  const series = new Map(buckets.map((bucket) => [bucket, { period: bucket, leadsCreated: 0, leadsConverted: 0, dealsCreated: 0, dealsWon: 0, wonValue: 0, dealsLost: 0 }]));
  if (seesLeads) {
    const values = [context.organizationId, interval, filters.from, filters.to];
    const scope = leadScopeSql(context, values, "lead");
    const local = (column) => `(${column} AT TIME ZONE ${ZONE("$1")})`;
    const { rows } = await client.query(
      `SELECT to_char(date_trunc($2, ${local("lead.created_at")}), 'YYYY-MM-DD') AS bucket, count(*)::int AS created, 0 AS converted
         FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND ${local("lead.created_at")}::date BETWEEN $3::date AND $4::date${scope}
        GROUP BY 1
       UNION ALL
       SELECT to_char(date_trunc($2, ${local("lead.converted_at")}), 'YYYY-MM-DD'), 0, count(*)::int
         FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.converted_at IS NOT NULL AND ${local("lead.converted_at")}::date BETWEEN $3::date AND $4::date${scope}
        GROUP BY 1`, values);
    for (const row of rows) {
      const entry = series.get(row.bucket);
      if (entry) { entry.leadsCreated += num(row.created); entry.leadsConverted += num(row.converted); }
    }
  }
  if (seesDeals) {
    const parameters = [];
    const facts = opportunityFactsCte(context, filters, parameters);
    const at = (expression) => `to_char(date_trunc(${`$${parameters.push(interval)}`}, ${expression}), 'YYYY-MM-DD')`;
    const from = `$${parameters.push(filters.from)}::date`;
    const to = `$${parameters.push(filters.to)}::date`;
    const created = at(`(created_at AT TIME ZONE ${ZONE("$1")})`);
    const closed = at("actual_close_date");
    const { rows } = await client.query(
      `WITH ${facts}
       SELECT ${created} AS bucket, count(*)::int AS created, 0 AS won, 0::float8 AS won_value, 0 AS lost FROM opportunity_facts
        WHERE (created_at AT TIME ZONE ${ZONE("$1")})::date BETWEEN ${from} AND ${to} GROUP BY 1
       UNION ALL
       SELECT ${closed}, 0, count(*) FILTER (WHERE status = 'won')::int, COALESCE(sum(won_reporting) FILTER (WHERE status = 'won'), 0)::float8,
              count(*) FILTER (WHERE status = 'lost')::int FROM opportunity_facts
        WHERE status IN ('won', 'lost') AND actual_close_date BETWEEN ${from} AND ${to} GROUP BY 1`, parameters);
    for (const row of rows) {
      const entry = series.get(row.bucket);
      if (!entry) continue;
      entry.dealsCreated += num(row.created); entry.dealsWon += num(row.won); entry.wonValue += num(row.won_value); entry.dealsLost += num(row.lost);
    }
  }
  return { interval, from: filters.from, to: filters.to, currency: await reportingCurrencyOf(client, context.organizationId), seesLeads, seesDeals, series: [...series.values()] };
}

// ------------------------------------------------------------------ pivot (new)

// What a pivot may group deals and leads by: SQL expressions over opportunity_facts (`f`) or tenant.crm_leads (`lead`) with joins.
const DEAL_DIMENSIONS = Object.freeze({
  stage: { label: "Stage", key: "f.stage_id::text", name: "COALESCE(f.stage_name, 'No stage')", order: "min(f.stage_sequence)" },
  status: { label: "Status", key: "f.status", name: "initcap(f.status)" },
  owner: { label: "Owner", key: "COALESCE(f.owner_user_id::text, '-')", name: "COALESCE(f.owner_name, 'Unassigned')" },
  team: { label: "Team", key: "COALESCE(f.team_id::text, '-')", name: "COALESCE(f.team_name, 'No team')" },
  source: { label: "Source", key: "COALESCE(f.source_id::text, '-')", name: "COALESCE(f.source_name, 'No source')" },
  campaign: { label: "Campaign", key: "COALESCE(f.campaign_id::text, '-')", name: "COALESCE(f.campaign_name, 'No campaign')" },
  medium: { label: "Medium", key: "COALESCE(f.medium, '-')", name: "COALESCE(f.medium, 'Not set')" },
  priority: { label: "Priority", key: "COALESCE(f.priority, '-')", name: "initcap(COALESCE(f.priority, 'none'))" },
  forecast: { label: "Forecast category", key: "f.forecast_category", name: "replace(initcap(f.forecast_category), '_', ' ')" },
  closeMonth: { label: "Expected close month", key: "COALESCE(to_char(f.expected_close_date, 'YYYY-MM'), '-')", name: "COALESCE(to_char(f.expected_close_date, 'Mon YYYY'), 'No date')", order: "min(f.expected_close_date)" },
  createdMonth: { label: "Created month", key: "to_char(f.created_at, 'YYYY-MM')", name: "to_char(f.created_at, 'Mon YYYY')", order: "min(f.created_at)" },
});
const DEAL_MEASURES = Object.freeze({
  count: { label: "Deals", sql: "count(*)::float8" },
  value: { label: "Value", sql: "COALESCE(sum(f.amount_reporting), 0)::float8", money: true },
  weighted: { label: "Weighted value", sql: "COALESCE(sum(f.weighted_reporting) FILTER (WHERE f.status = 'open'), 0)::float8", money: true },
  wonValue: { label: "Won value", sql: "COALESCE(sum(f.won_reporting) FILTER (WHERE f.status = 'won'), 0)::float8", money: true },
});
const LEAD_DIMENSIONS = Object.freeze({
  status: { label: "Status", key: "lead.status", name: "initcap(lead.status)" },
  stage: { label: "Stage", key: "COALESCE(lead.stage, '-')", name: "COALESCE(stage.name, initcap(lead.stage), 'No stage')" },
  owner: { label: "Owner", key: "COALESCE(lead.owner_user_id::text, '-')", name: "COALESCE(owner.full_name, 'Unassigned')" },
  team: { label: "Team", key: "COALESCE(lead.team_id::text, '-')", name: "COALESCE(team.name, 'No team')" },
  source: { label: "Source", key: "COALESCE(lead.source_id::text, '-')", name: "COALESCE(source.name, 'No source')" },
  campaign: { label: "Campaign", key: "COALESCE(lead.campaign_id::text, '-')", name: "COALESCE(campaign.name, 'No campaign')" },
  medium: { label: "Medium", key: "COALESCE(lead.medium, '-')", name: "COALESCE(lead.medium, 'Not set')" },
  rating: { label: "Rating", key: "COALESCE(lead.rating, '-')", name: "initcap(COALESCE(lead.rating, 'none'))" },
  state: { label: "State", key: "COALESCE(lead.state, '-')", name: "COALESCE(lead.state, 'No state')" },
  createdMonth: { label: "Created month", key: "to_char(lead.created_at, 'YYYY-MM')", name: "to_char(lead.created_at, 'Mon YYYY')", order: "min(lead.created_at)" },
});
const LEAD_MEASURES = Object.freeze({
  count: { label: "Leads", sql: "count(*)::float8" },
  converted: { label: "Converted", sql: "count(*) FILTER (WHERE lead.status = 'converted')::float8" },
  estimated: { label: "Estimated value", sql: "COALESCE(sum(lead.estimated_value), 0)::float8", money: true },
});

export function getPivotDefinitions() {
  const list = (object) => Object.entries(object).map(([key, entry]) => ({ key, label: entry.label, ...(entry.money ? { money: true } : {}) }));
  return { deals: { dimensions: list(DEAL_DIMENSIONS), measures: list(DEAL_MEASURES) }, leads: { dimensions: list(LEAD_DIMENSIONS), measures: list(LEAD_MEASURES) } };
}

// A table of `measure` by `rows` × `columns` (columns optional) over deals or leads. input: { subject, rows, columns?, measure, from?, to?, … }
export async function getCrmPivot(client, context, input = {}) {
  const subject = input.subject === "leads" ? "leads" : "deals";
  const dimensions = subject === "leads" ? LEAD_DIMENSIONS : DEAL_DIMENSIONS;
  const measures = subject === "leads" ? LEAD_MEASURES : DEAL_MEASURES;
  const row = dimensions[input.rows];
  const column = input.columns ? dimensions[input.columns] : null;
  const measure = measures[input.measure ?? "count"];
  if (!row) throw invalid("Choose what the rows are.");
  if (input.columns && !column) throw invalid("Choose what the columns are.");
  if (!measure) throw invalid("Choose what to measure.");
  const groupKeys = [`${row.key} AS row_key`, `${row.name} AS row_name`, ...(column ? [`${column.key} AS column_key`, `${column.name} AS column_name`] : [])];
  const groupBy = column ? "1, 2, 3, 4" : "1, 2";
  let sql;
  let values;
  if (subject === "deals") {
    requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view deals.");
    // Without a period: everything from the last nine years (the analytics range limit is ten).
    const filters = normalizeAnalyticsFilters(input.from || input.to ? input : { ...input, from: new Date(Date.now() - 9 * 365 * 86400000).toISOString().slice(0, 10) });
    values = [];
    const facts = opportunityFactsCte(context, filters, values);
    const from = `$${values.push(filters.from)}::date`;
    const to = `$${values.push(filters.to)}::date`;
    const period = input.period === "closed" ? `f.actual_close_date BETWEEN ${from} AND ${to}` : `f.created_at::date BETWEEN ${from} AND ${to}`;
    const status = ["open", "won", "lost"].includes(input.status) ? ` AND f.status = $${values.push(input.status)}` : "";
    sql = `WITH ${facts} SELECT ${groupKeys.join(", ")}, ${measure.sql} AS value, ${row.order ?? "NULL"} AS row_order${column ? `, ${column.order ?? "NULL"} AS column_order` : ""},
                  count(*) FILTER (WHERE f.fx_rate IS NULL)::int AS unconverted
             FROM opportunity_facts f WHERE ${period}${status} GROUP BY ${groupBy}`;
  } else {
    requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
    values = [context.organizationId];
    const scope = leadScopeSql(context, values, "lead");
    const range = [];
    if (input.from) range.push(` AND lead.created_at::date >= $${values.push(String(input.from).slice(0, 10))}::date`);
    if (input.to) range.push(` AND lead.created_at::date <= $${values.push(String(input.to).slice(0, 10))}::date`);
    sql = `SELECT ${groupKeys.join(", ")}, ${measure.sql} AS value, ${row.order ?? "NULL"} AS row_order${column ? `, ${column.order ?? "NULL"} AS column_order` : ""}, 0 AS unconverted
             FROM tenant.crm_leads lead
             LEFT JOIN tenant.crm_lead_stages stage ON stage.organization_id = lead.organization_id AND stage.code = lead.stage
             LEFT JOIN public.users owner ON owner.id = lead.owner_user_id
             LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = lead.organization_id AND team.id = lead.team_id
             LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = lead.organization_id AND source.id = lead.source_id
             LEFT JOIN tenant.crm_campaigns campaign ON campaign.organization_id = lead.organization_id AND campaign.id = lead.campaign_id
            WHERE lead.organization_id = $1 AND lead.archived_at IS NULL${range.join("")}${scope} GROUP BY ${groupBy}`;
  }
  const { rows } = await client.query(sql, values);
  // A medium reads as its name ("Paid search"), never its code.
  const label = (dimension, key, name) => (dimension === "medium" ? crmMediumLabel(key) ?? "Not set" : name);
  const order = (list) => [...list.values()].sort((a, b) => (a.order !== null && b.order !== null ? String(a.order).localeCompare(String(b.order)) : 0) || String(a.label).localeCompare(String(b.label)));
  const rowMap = new Map();
  const columnMap = new Map();
  const cells = {};
  let unconverted = 0;
  for (const entry of rows) {
    rowMap.set(entry.row_key, { key: entry.row_key, label: label(input.rows, entry.row_key, entry.row_name), order: entry.row_order ?? null });
    const columnKey = column ? entry.column_key : "all";
    if (column) columnMap.set(entry.column_key, { key: entry.column_key, label: label(input.columns, entry.column_key, entry.column_name), order: entry.column_order ?? null });
    cells[entry.row_key] ??= {};
    cells[entry.row_key][columnKey] = num(entry.value);
    unconverted += num(entry.unconverted);
  }
  const rowsOut = order(rowMap).map(({ key, label: text }) => ({ key, label: text }));
  const columnsOut = column ? order(columnMap).map(({ key, label: text }) => ({ key, label: text })) : [{ key: "all", label: measure.label }];
  const rowTotals = Object.fromEntries(rowsOut.map((entry) => [entry.key, Object.values(cells[entry.key] ?? {}).reduce((total, value) => total + value, 0)]));
  const columnTotals = Object.fromEntries(columnsOut.map((entry) => [entry.key, rowsOut.reduce((total, rowEntry) => total + (cells[rowEntry.key]?.[entry.key] ?? 0), 0)]));
  return {
    subject, rows: rowsOut, columns: columnsOut, cells, rowTotals, columnTotals, total: Object.values(rowTotals).reduce((total, value) => total + value, 0),
    measure: { key: input.measure ?? "count", label: measure.label, money: Boolean(measure.money) },
    currency: { reportingCurrency: await reportingCurrencyOf(client, context.organizationId), unconvertedCount: unconverted, unconvertedCurrencies: [] },
  };
}
