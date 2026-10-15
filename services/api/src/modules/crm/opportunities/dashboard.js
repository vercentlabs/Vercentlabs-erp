// The opportunity dashboard, the "CRM Opportunities by Stage" report and the
// export. All three count only the deals the caller can see, with the same
// scope and filters as the opportunity list, so a figure and the list behind
// it always agree.
import { csvCellWriter, dayIn, organizationTimeZone } from "../data-management/csv.js";
import { CrmError } from "../data-management/errors.js";
import { opportunityScopeSql, requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS, OPPORTUNITY_STALE_DAYS, opportunityPriorityLabel, opportunityStatusLabel } from "./constants.js";
import { OPPORTUNITY_SELECT, buildOpportunityListWhere, toOpportunity } from "./records.js";
import { orgMonthStart, orgPeriod, orgToday } from "../data-management/org-date.js";

const NOT_ARCHIVED = "opportunity.archived_at IS NULL AND opportunity.status NOT IN ('archived', 'abandoned')";
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;


export async function getOpportunityDashboard(client, context, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view deals.");
  const period = await orgPeriod(client, context.organizationId, input);
  const values = [context.organizationId, period.from, period.to];
  const scope = opportunityScopeSql(context, values, "opportunity");
  const month = orgMonthStart("$1");
  // Results (won, lost, win rate, deal size, cycle) count the deals closed in the period; the pipeline figures are now.
  const closed = (alias) => `${alias}.actual_close_date >= $2::date AND ${alias}.actual_close_date <= $3::date`;
  const totals = (await client.query(
    `SELECT count(*) FILTER (WHERE opportunity.status = 'open')::int AS open,
            COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'open'), 0)::float8 AS open_value,
            COALESCE(sum(opportunity.amount * opportunity.probability / 100) FILTER (WHERE opportunity.status = 'open'), 0)::float8 AS weighted_value,
            count(*) FILTER (WHERE opportunity.status = 'open' AND opportunity.expected_close_date >= ${month} AND opportunity.expected_close_date < ${month} + interval '1 month')::int AS closing_this_month,
            count(*) FILTER (WHERE opportunity.status = 'won' AND ${closed("opportunity")})::int AS won_in_period,
            COALESCE(sum(COALESCE(opportunity.won_amount, opportunity.amount)) FILTER (WHERE opportunity.status = 'won' AND ${closed("opportunity")}), 0)::float8 AS won_value_in_period,
            count(*) FILTER (WHERE opportunity.status = 'lost' AND ${closed("opportunity")})::int AS lost_in_period,
            -- what was lost keeps its estimated value
            COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'lost' AND ${closed("opportunity")}), 0)::float8 AS lost_value_in_period,
            (SELECT reason.name FROM tenant.crm_opportunities lost JOIN tenant.crm_lost_reasons reason ON reason.organization_id = lost.organization_id AND reason.id = lost.outcome_reason_id
              WHERE lost.organization_id = $1 AND lost.status = 'lost' AND lost.archived_at IS NULL AND ${closed("lost")}
                AND lost.id IN (SELECT opportunity.id FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1${scope})
              GROUP BY reason.name ORDER BY count(*) DESC, reason.name LIMIT 1) AS top_lost_reason_in_period,
            count(*) FILTER (WHERE opportunity.status = 'open' AND opportunity.expected_close_date < ${orgToday("$1")})::int AS overdue,
            count(*) FILTER (WHERE opportunity.status = 'open' AND COALESCE(opportunity.last_activity_at, opportunity.created_at) < now() - interval '${OPPORTUNITY_STALE_DAYS} days')::int AS stale,
            count(*) FILTER (WHERE opportunity.status = 'won' AND ${closed("opportunity")})::int AS won,
            count(*) FILTER (WHERE opportunity.status = 'lost' AND ${closed("opportunity")})::int AS lost,
            COALESCE(avg(COALESCE(opportunity.won_amount, opportunity.amount)) FILTER (WHERE opportunity.status = 'won' AND ${closed("opportunity")}), 0)::float8 AS average_deal_size,
            round((avg(EXTRACT(epoch FROM COALESCE(opportunity.closed_at, opportunity.actual_close_date::timestamptz) - opportunity.created_at))
                   FILTER (WHERE opportunity.status = 'won' AND ${closed("opportunity")}) / 86400)::numeric, 1)::float8 AS average_sales_cycle_days
       FROM tenant.crm_opportunities opportunity
      WHERE opportunity.organization_id = $1 AND ${NOT_ARCHIVED}${scope}`,
    values,
  )).rows[0];

  // Open deals in each stage, in process order.
  const byStage = (await client.query(
    `SELECT stage.id, stage.name, count(opportunity.id)::int AS total, COALESCE(sum(opportunity.amount), 0)::float8 AS value,
            COALESCE(sum(opportunity.amount * opportunity.probability / 100), 0)::float8 AS weighted
       FROM tenant.crm_pipeline_stages stage
       JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id = stage.organization_id AND pipeline.id = stage.pipeline_id AND pipeline.status = 'active'
       LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = stage.organization_id AND opportunity.stage_id = stage.id
             AND opportunity.status = 'open' AND ${NOT_ARCHIVED}${scope}
      -- open deals are "now"; the period parameters are shared with the totals query, so they are referenced here too
      WHERE stage.organization_id = $1 AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost AND $2::date IS NOT NULL AND $3::date IS NOT NULL
      GROUP BY stage.id, stage.name, stage.sequence, pipeline.is_default
     HAVING pipeline.is_default OR count(opportunity.id) > 0
      ORDER BY pipeline.is_default DESC, stage.sequence`,
    values,
  )).rows;

  const decided = totals.won + totals.lost;
  return {
    totals: {
      open: totals.open,
      openValue: money(totals.open_value),
      weightedValue: money(totals.weighted_value),
      closingThisMonth: totals.closing_this_month,
      won: totals.won_in_period,
      wonValue: money(totals.won_value_in_period),
      lost: totals.lost_in_period,
      lostValue: money(totals.lost_value_in_period),
      topLostReason: totals.top_lost_reason_in_period ?? null,
      overdue: totals.overdue,
      stale: totals.stale,
      staleDays: OPPORTUNITY_STALE_DAYS,
      averageDealSize: money(totals.average_deal_size),
      // won ÷ (won + lost), as a percentage
      // Nothing closed in the period: no rate (shown as –), never a 0% that reads as a result.
      winRate: decided ? Math.round((totals.won / decided) * 1000) / 10 : null,
      lossRate: decided ? Math.round((totals.lost / decided) * 1000) / 10 : null,
      // from the day the deal was created to the day it was won
      averageSalesCycleDays: totals.average_sales_cycle_days ?? null,
    },
    period,
    byStage: byStage.map((row) => ({ stageId: row.id, label: row.name, total: row.total, value: money(row.value), weightedValue: money(row.weighted) })),
  };
}

// Grouping expressions over the list query's columns (aliased "counted").
const REPORT_GROUPS = Object.freeze({
  stage: { expression: "COALESCE(counted.stage_name, 'No stage')", label: "Stage" },
  status: { expression: "counted.status", label: "Status" },
  owner: { expression: "COALESCE(counted.owner_name, 'Unassigned')", label: "Owner" },
  team: { expression: "COALESCE(counted.team_name, 'No team')", label: "Team" },
  source: { expression: "COALESCE(counted.source_name, 'No source')", label: "Source" },
  account: { expression: "COALESCE(counted.account_name, 'No account')", label: "Company" },
  product: { expression: "COALESCE(NULLIF(btrim(counted.product_interest), ''), 'Not set')", label: "Product / service" },
  priority: { expression: "counted.priority", label: "Priority" },
  closeMonth: { expression: "COALESCE(to_char(date_trunc('month', counted.expected_close_date), 'YYYY-MM'), 'No close date')", label: "Expected close month" },
  lostReason: { expression: "COALESCE(counted.lost_reason_name, 'Not lost')", label: "Lost reason" },
});

// CRM Opportunities by Stage. One dataset, grouped and filtered many ways:
// input.groupBy plus every filter the opportunity list accepts.
export async function getOpportunitiesByStageReport(client, context, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view deals.");
  const groupBy = REPORT_GROUPS[input.groupBy] ? input.groupBy : "stage";
  const group = REPORT_GROUPS[groupBy];
  const values = [];
  const where = buildOpportunityListWhere(context, input, values);
  const { rows } = await client.query(
    `SELECT grouped.group_key, count(*)::int AS total,
            count(*) FILTER (WHERE grouped.status = 'open')::int AS open,
            count(*) FILTER (WHERE grouped.status = 'won')::int AS won,
            count(*) FILTER (WHERE grouped.status = 'lost')::int AS lost,
            COALESCE(sum(grouped.amount), 0)::float8 AS value,
            COALESCE(sum(grouped.amount * grouped.probability / 100) FILTER (WHERE grouped.status = 'open'), 0)::float8 AS weighted,
            min(grouped.sort_key) AS sort_key
       FROM (SELECT counted.*, ${group.expression} AS group_key,
                    ${groupBy === "stage" ? "counted.stage_sequence" : "0"} AS sort_key
               FROM (${OPPORTUNITY_SELECT} ${where}) counted) grouped
      GROUP BY grouped.group_key
      ORDER BY ${groupBy === "stage" ? "sort_key, 1" : groupBy === "closeMonth" ? "1" : "value DESC, 1"}`,
    values,
  );
  const label = (key) => (groupBy === "status" ? opportunityStatusLabel(key) : groupBy === "priority" ? opportunityPriorityLabel(key) : key);
  const reportRows = rows.map((row) => ({
    group: label(row.group_key), total: row.total, open: row.open, won: row.won, lost: row.lost, value: money(row.value), weightedValue: money(row.weighted),
    winRate: row.won + row.lost ? Math.round((row.won / (row.won + row.lost)) * 1000) / 10 : null,
  }));
  return {
    groupBy,
    groupLabel: group.label,
    rows: reportRows,
    totals: reportRows.reduce((sum, row) => ({
      total: sum.total + row.total, open: sum.open + row.open, won: sum.won + row.won, lost: sum.lost + row.lost,
      value: money(sum.value + row.value), weightedValue: money(sum.weightedValue + row.weightedValue),
    }), { total: 0, open: 0, won: 0, lost: 0, value: 0, weightedValue: 0 }),
  };
}

// ------------------------------------------------------------------ export

const EXPORT_ROW_LIMIT = 10000;

// A value starting with a formula character would run in a spreadsheet.

const EXPORT_COLUMNS = Object.freeze([
  ["Deal Number", (row) => row.code],
  ["Deal", (row) => row.name],
  ["Company", (row) => row.accountName],
  ["Primary Contact", (row) => row.contactName],
  ["Stage", (row) => row.stageName],
  ["Status", (row) => opportunityStatusLabel(row.status)],
  ["Estimated Value", (row) => row.amount],
  ["Currency", (row) => row.currencyCode],
  ["Probability %", (row) => row.probability],
  ["Weighted Value", (row) => row.weightedValue],
  ["Expected Close Date", (row) => row.expectedCloseDate],
  ["Actual Close Date", (row) => row.actualCloseDate],
  ["Owner", (row) => row.ownerName],
  ["Team", (row) => row.teamName],
  ["Priority", (row) => opportunityPriorityLabel(row.priority)],
  ["Product / Service Interest", (row) => row.productInterest],
  ["Source", (row) => row.sourceName],
  ["Next Step", (row) => row.nextStep],
  ["Next Follow-up", (row) => row.nextFollowUpAt],
  ["Last Activity", (row) => row.lastActivityAt],
  ["Final Value", (row) => row.wonAmount],
  ["Lost Reason", (row) => row.lostReasonName],
  ["Competitor", (row) => row.competitorName],
  ["Latest Quotation", (row) => row.latestQuotationNumber],
  ["Created By", (row) => row.createdByName],
  ["Created At", (row) => row.createdAt],
  ["Updated At", (row) => row.updatedAt],
]);

// Exports exactly the opportunities the list shows for the same view and filters.
export async function exportOpportunities(client, context, filters = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.export, "You do not have permission to export deals.");
  const values = [];
  const where = buildOpportunityListWhere(context, filters, values);
  const { rows } = await client.query(`${OPPORTUNITY_SELECT} ${where} ORDER BY opportunity.created_at DESC, opportunity.id DESC LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
  if (rows.length > EXPORT_ROW_LIMIT)
    throw new CrmError(413, `This export has more than ${EXPORT_ROW_LIMIT} deals. Narrow the filters and try again.`, "CRM_OPPORTUNITY_EXPORT_TOO_LARGE");
  const opportunities = rows.map(toOpportunity);
  const timeZone = await organizationTimeZone(client, context);
  const csvCell = csvCellWriter(timeZone);
  return {
    fileName: `deals-${dayIn(timeZone)}.csv`,
    rowCount: opportunities.length,
    csv: `﻿${[EXPORT_COLUMNS.map(([label]) => label), ...opportunities.map((row) => EXPORT_COLUMNS.map(([, read]) => read(row)))].map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`,
  };
}
