// Win / loss reporting over the opportunities the caller can see, by their
// current close (a reopened deal counts again only when it closes again):
//   win rate = won / (won + lost)
//   the share of each won reason and each lost reason
//   the same, grouped by owner, team, lead source, product, account, industry,
//   final stage or close month
// Won value is the final deal value; lost value is the estimate the deal
// still carried, so the size of what was lost stays visible.
import { opportunityScopeSql, requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { CLOSE_REPORT_GROUPS } from "./constants.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const rate = (won, lost) => (won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : null);

const GROUP_SQL = Object.freeze({
  reason: ["history.reason_id::text", "COALESCE(history.reason_name, reason.name, 'No reason')"],
  owner: ["opportunity.owner_user_id::text", "COALESCE(owner.full_name, 'Unassigned')"],
  team: ["opportunity.team_id::text", "COALESCE(team.name, 'No team')"],
  source: ["opportunity.source_id::text", "COALESCE(source.name, 'No source')"],
  product: ["lower(COALESCE(NULLIF(btrim(opportunity.product_interest), ''), ''))", "COALESCE(NULLIF(btrim(opportunity.product_interest), ''), 'Not set')"],
  account: ["opportunity.party_id::text", "COALESCE(account.display_name, 'No account')"],
  industry: ["lower(COALESCE(NULLIF(btrim(account.industry), ''), ''))", "COALESCE(NULLIF(btrim(account.industry), ''), 'Not set')"],
  stage: ["history.final_stage_id::text", "COALESCE(history.final_stage_name, 'Unknown')"],
  month: ["to_char(history.actual_close_date, 'YYYY-MM')", "to_char(history.actual_close_date, 'Mon YYYY')"],
});

function period(input) {
  const today = new Date();
  const from = DATE.test(String(input.from ?? "")) ? input.from : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = DATE.test(String(input.to ?? "")) ? input.to : today.toISOString().slice(0, 10);
  return { from, to };
}

// input: { from?, to?, groupBy?, ownerId?, teamId?, sourceId?, outcome? }
export async function getWinLossReport(client, context, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view opportunities.");
  const { from, to } = period(input);
  const groupBy = GROUP_SQL[input.groupBy] ? input.groupBy : "reason";
  const values = [context.organizationId, from, to];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const filters = [];
  if (UUID.test(String(input.ownerId ?? ""))) filters.push(`opportunity.owner_user_id = ${bind(input.ownerId)}`);
  if (UUID.test(String(input.teamId ?? ""))) filters.push(`opportunity.team_id = ${bind(input.teamId)}`);
  if (UUID.test(String(input.sourceId ?? ""))) filters.push(`opportunity.source_id = ${bind(input.sourceId)}`);
  if (["won", "lost"].includes(input.outcome)) filters.push(`history.outcome = ${bind(input.outcome)}`);
  const scope = opportunityScopeSql(context, values, "opportunity");
  const base = `
    FROM tenant.crm_opportunity_close_history history
    JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = history.organization_id AND opportunity.id = history.opportunity_id
    LEFT JOIN tenant.crm_lost_reasons reason ON reason.organization_id = history.organization_id AND reason.id = history.reason_id
    LEFT JOIN public.users owner ON owner.id = opportunity.owner_user_id
    LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = opportunity.organization_id AND team.id = opportunity.team_id
    LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = opportunity.organization_id AND source.id = opportunity.source_id
    LEFT JOIN tenant.business_parties account ON account.organization_id = opportunity.organization_id AND account.id = opportunity.party_id
   WHERE history.organization_id = $1 AND history.reopened_at IS NULL AND history.actual_close_date BETWEEN $2::date AND $3::date
     AND opportunity.archived_at IS NULL${filters.map((filter) => ` AND ${filter}`).join("")}${scope}`;

  const totals = (await client.query(
    `SELECT count(*) FILTER (WHERE history.outcome = 'won')::int AS won, count(*) FILTER (WHERE history.outcome = 'lost')::int AS lost,
            COALESCE(sum(COALESCE(history.final_value, history.estimated_value)) FILTER (WHERE history.outcome = 'won'), 0)::float8 AS won_value,
            COALESCE(sum(history.estimated_value) FILTER (WHERE history.outcome = 'lost'), 0)::float8 AS lost_value
       ${base}`,
    values,
  )).rows[0];
  const reasons = (await client.query(
    `SELECT history.outcome, history.reason_id, COALESCE(history.reason_name, reason.name, 'No reason') AS name, count(*)::int AS total,
            COALESCE(sum(CASE WHEN history.outcome = 'won' THEN COALESCE(history.final_value, history.estimated_value) ELSE history.estimated_value END), 0)::float8 AS value
       ${base}
      GROUP BY 1, 2, 3 ORDER BY total DESC, name`,
    values,
  )).rows;
  const [keySql, labelSql] = GROUP_SQL[groupBy];
  const groups = (await client.query(
    `SELECT ${keySql} AS key, ${labelSql} AS label,
            count(*) FILTER (WHERE history.outcome = 'won')::int AS won, count(*) FILTER (WHERE history.outcome = 'lost')::int AS lost,
            COALESCE(sum(COALESCE(history.final_value, history.estimated_value)) FILTER (WHERE history.outcome = 'won'), 0)::float8 AS won_value,
            COALESCE(sum(history.estimated_value) FILTER (WHERE history.outcome = 'lost'), 0)::float8 AS lost_value,
            mode() WITHIN GROUP (ORDER BY COALESCE(history.reason_name, reason.name)) FILTER (WHERE history.outcome = 'lost') AS top_lost_reason,
            mode() WITHIN GROUP (ORDER BY COALESCE(history.reason_name, reason.name)) FILTER (WHERE history.outcome = 'won') AS top_won_reason
       ${base}
      GROUP BY 1, 2 ORDER BY (count(*)) DESC, 2`,
    values,
  )).rows;

  const share = (outcome) => {
    const rows = reasons.filter((row) => row.outcome === outcome);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    return rows.map((row) => ({ reasonId: row.reason_id, name: row.name, count: row.total, share: total ? Math.round((row.total / total) * 1000) / 10 : 0, value: money(row.value) }));
  };
  const lostReasons = share("lost");
  return {
    period: { from, to },
    groupBy,
    groupLabel: CLOSE_REPORT_GROUPS[groupBy],
    totals: {
      won: totals.won, lost: totals.lost, wonValue: money(totals.won_value), lostValue: money(totals.lost_value), winRate: rate(totals.won, totals.lost),
      topLostReason: lostReasons[0]?.name ?? null,
    },
    wonReasons: share("won"),
    lostReasons,
    groups: groups.map((row) => ({
      key: row.key ?? "none", label: row.label, won: row.won, lost: row.lost, wonValue: money(row.won_value), lostValue: money(row.lost_value),
      winRate: rate(row.won, row.lost), topLostReason: row.top_lost_reason ?? null, topWonReason: row.top_won_reason ?? null,
    })),
  };
}
