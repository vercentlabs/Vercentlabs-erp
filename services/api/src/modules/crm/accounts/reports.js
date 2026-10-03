// The account summary cards and the account report. Both use the account
// list's WHERE clause (view, filters and visibility), so a figure and the
// list behind it always agree.
import { requireAccountPermission } from "./access.js";
import { ACCOUNT_PERMISSIONS, ACCOUNT_STATUSES, ACCOUNT_TYPES } from "./constants.js";
import { buildAccountListWhere } from "./records.js";

const PIPELINE = `LEFT JOIN LATERAL (
    SELECT count(*)::int AS open_opportunities, COALESCE(sum(opportunity.amount), 0) AS open_pipeline_value
      FROM tenant.crm_opportunities opportunity
     WHERE opportunity.organization_id = account.organization_id AND opportunity.party_id = account.id AND opportunity.status = 'open') pipeline ON true`;
const STALE_DAYS = 30;

// The cards above the account list, for the current view and filters.
export async function getAccountListSummary(client, context, filters = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.view, "You do not have permission to view accounts.");
  const values = [];
  const where = buildAccountListWhere(context, filters, values);
  const { rows } = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE account.status = 'active')::int AS active,
            count(*) FILTER (WHERE account.account_type = 'prospect')::int AS prospects,
            count(*) FILTER (WHERE account.account_type = 'customer')::int AS customers,
            count(*) FILTER (WHERE pipeline.open_opportunities > 0)::int AS with_open_opportunities,
            COALESCE(sum(pipeline.open_pipeline_value), 0)::float8 AS open_pipeline_value,
            count(*) FILTER (WHERE account.status = 'active' AND (account.last_activity_at IS NULL OR account.last_activity_at < now() - interval '${STALE_DAYS} days'))::int AS without_recent_activity,
            count(*) FILTER (WHERE account.owner_user_id IS NULL)::int AS unassigned
       FROM tenant.business_parties account
       ${PIPELINE}
       ${where}`,
    values,
  );
  const row = rows[0];
  return {
    total: row.total,
    active: row.active,
    prospects: row.prospects,
    customers: row.customers,
    withOpenOpportunities: row.with_open_opportunities,
    openPipelineValue: row.open_pipeline_value,
    withoutRecentActivity: row.without_recent_activity,
    unassigned: row.unassigned,
    staleDays: STALE_DAYS,
  };
}

const REPORT_GROUPS = Object.freeze({
  owner: { expression: "COALESCE(owner.full_name, 'Unassigned')", label: "Owner" },
  type: { expression: "account.account_type", label: "Account type" },
  status: { expression: "account.status", label: "Status" },
  industry: { expression: "COALESCE(NULLIF(account.industry, ''), 'No industry')", label: "Industry" },
  source: { expression: "COALESCE(source.name, 'No source')", label: "Source" },
  team: { expression: "COALESCE(team.name, 'No team')", label: "Team" },
  month: { expression: "to_char(date_trunc('month', account.created_at), 'YYYY-MM')", label: "Created month" },
});

// Accounts by owner, type, status, industry, source, team or created month,
// with open opportunities and accounts without recent activity. Accepts the
// account list's filters (createdFrom/To, ownerId, accountType, …).
export async function getAccountReport(client, context, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.view, "You do not have permission to view accounts.");
  const groupBy = REPORT_GROUPS[input.groupBy] ? input.groupBy : "owner";
  const values = [];
  const where = buildAccountListWhere(context, { ...input, view: input.view || "all" }, values);
  const { rows } = await client.query(
    `SELECT ${REPORT_GROUPS[groupBy].expression} AS group_key,
            count(*)::int AS total,
            count(*) FILTER (WHERE account.account_type = 'prospect')::int AS prospects,
            count(*) FILTER (WHERE account.account_type = 'customer')::int AS customers,
            count(*) FILTER (WHERE account.created_at >= now() - interval '30 days')::int AS new_last_30_days,
            count(*) FILTER (WHERE pipeline.open_opportunities > 0)::int AS with_open_opportunities,
            COALESCE(sum(pipeline.open_pipeline_value), 0)::float8 AS open_pipeline_value,
            count(*) FILTER (WHERE account.status = 'active' AND (account.last_activity_at IS NULL OR account.last_activity_at < now() - interval '${STALE_DAYS} days'))::int AS without_recent_activity
       FROM tenant.business_parties account
       LEFT JOIN public.users owner ON owner.id = account.owner_user_id
       LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = account.organization_id AND team.id = account.team_id
       LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = account.organization_id AND source.id = account.source_id
       ${PIPELINE}
       ${where}
      GROUP BY 1 ORDER BY ${groupBy === "month" ? "1 DESC" : "total DESC, 1"}`,
    values,
  );
  const labels = new Map([...ACCOUNT_TYPES, ...ACCOUNT_STATUSES].map((entry) => [entry.code, entry.label]));
  const reportRows = rows.map((row) => ({
    group: groupBy === "type" || groupBy === "status" ? labels.get(row.group_key) ?? row.group_key : row.group_key,
    total: row.total,
    prospects: row.prospects,
    customers: row.customers,
    newLast30Days: row.new_last_30_days,
    withOpenOpportunities: row.with_open_opportunities,
    openPipelineValue: row.open_pipeline_value,
    withoutRecentActivity: row.without_recent_activity,
  }));
  const keys = ["total", "prospects", "customers", "newLast30Days", "withOpenOpportunities", "openPipelineValue", "withoutRecentActivity"];
  return {
    groupBy,
    groupLabel: REPORT_GROUPS[groupBy].label,
    staleDays: STALE_DAYS,
    rows: reportRows,
    totals: Object.fromEntries(keys.map((key) => [key, reportRows.reduce((sum, row) => sum + row[key], 0)])),
  };
}
