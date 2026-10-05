import { CrmError } from "../data-management/errors.js";
import { recordScope } from "../data-management/record-policy.js";
import { addParameter, managedTeamMembersSql } from "../data-management/record-utils.js";
import { definitionFor } from "../data-management/resource-registry.js";

// The canonical opportunity fact set behind every pipeline/forecast/report
// figure (see metric-definitions.js for the measures computed from it).
//
// Visibility is recordScope() for the opportunities resource — the very rule
// the Opportunities list applies — so no aggregate can include a deal the
// caller could not open. Attribution (effective-dated, one value per deal, so
// hierarchy rollups never double count):
//   team = the owner's primary sales-team membership on the as-of date
//          (active seller/manager membership; highest allocation, then
//          earliest start, then team code).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCOPES = new Set(["mine", "team", "all"]);
const CATEGORIES = new Set(["omitted", "pipeline", "best_case", "committed", "closed"]);
const MAX_RANGE_DAYS = 3700;

const invalid = (message) => new CrmError(400, message, "CRM_ANALYTICS_FILTER_INVALID");
const today = () => new Date().toISOString().slice(0, 10);

function optionalUuid(value, label, { allowUnassigned = false } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (allowUnassigned && text === "unassigned") return text;
  if (!UUID.test(text)) throw invalid(`${label} is not a valid id.`);
  return text;
}

function optionalDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw invalid(`${label} must be a YYYY-MM-DD date.`);
  return text;
}

// Filters shared by the dashboard, drill-downs, breakdowns, forecast and
// reports. Unknown keys are ignored; malformed values are a clear 400.
export function normalizeAnalyticsFilters(input = {}) {
  const monthStart = `${today().slice(0, 8)}01`;
  const from = optionalDate(input.from, "Start date") ?? monthStart;
  const to = optionalDate(input.to, "End date") ?? today();
  if (to < from) throw new CrmError(400, "The start date is after the end date.", "CRM_ANALYTICS_RANGE_INVALID");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new CrmError(400, "The date range can be at most ten years.", "CRM_ANALYTICS_RANGE_INVALID");
  const scope = SCOPES.has(input.scope) ? input.scope : "all";
  const category = input.forecastCategory ? String(input.forecastCategory) : null;
  if (category && !CATEGORIES.has(category)) throw invalid("Forecast category is not recognised.");
  return Object.freeze({
    from,
    to,
    asOf: optionalDate(input.asOf, "As-of date") ?? today(),
    scope,
    pipelineId: optionalUuid(input.pipelineId, "Pipeline"),
    stageId: optionalUuid(input.stageId, "Stage"),
    teamId: optionalUuid(input.teamId, "Sales team"),
    ownerId: optionalUuid(input.ownerId, "Owner", { allowUnassigned: true }),
    sourceId: optionalUuid(input.sourceId, "Source"),
    forecastCategory: category,
  });
}

export function analyticsFiltersFromSearchParams(searchParams) {
  const keys = ["from", "to", "asOf", "scope", "pipelineId", "stageId", "teamId", "ownerId", "sourceId", "forecastCategory"];
  return Object.fromEntries(keys.map((key) => [key, searchParams.get(key) ?? undefined]));
}

// SQL: the ids of a sales team and every descendant team (cycle-safe depth).
export function teamSubtreeSql(organizationParam, teamParam) {
  return `WITH RECURSIVE subtree(id, depth) AS (
      SELECT id, 0 FROM tenant.crm_sales_teams WHERE organization_id=${organizationParam} AND id=${teamParam}
      UNION ALL
      SELECT child.id, subtree.depth+1 FROM tenant.crm_sales_teams child JOIN subtree ON child.parent_team_id=subtree.id
       WHERE child.organization_id=${organizationParam} AND subtree.depth < 25)
    SELECT id FROM subtree`;
}


// SQL expression: a primary team for `ownerExpr` on `asOfExpr`.
export function primaryTeamSql(organizationExpr, ownerExpr, asOfExpr) {
  return `(SELECT member.team_id FROM tenant.crm_sales_team_members member
      JOIN tenant.crm_sales_teams team ON team.organization_id=member.organization_id AND team.id=member.team_id AND team.status='active'
     WHERE member.organization_id=${organizationExpr} AND member.user_id=${ownerExpr} AND member.status='active'
       AND member.member_role IN ('seller','manager')
       AND member.effective_from<=${asOfExpr} AND (member.effective_to IS NULL OR member.effective_to>=${asOfExpr})
     ORDER BY member.allocation_percent DESC, member.effective_from, team.code, team.id LIMIT 1)`;
}

// Set-based attribution, computed once per query (a correlated subquery per
// opportunity cost ~0.2 ms each: 850 ms at 5,000 deals). Same ordering rules
// as primaryTeamSql.
export function ownerTeamCte(organizationParam, asOfExpr) {
  return `owner_team AS (
      SELECT DISTINCT ON (member.user_id) member.user_id, member.team_id
        FROM tenant.crm_sales_team_members member
        JOIN tenant.crm_sales_teams team ON team.organization_id=member.organization_id AND team.id=member.team_id AND team.status='active'
       WHERE member.organization_id=${organizationParam} AND member.status='active' AND member.member_role IN ('seller','manager')
         AND member.effective_from<=${asOfExpr} AND (member.effective_to IS NULL OR member.effective_to>=${asOfExpr})
       ORDER BY member.user_id, member.allocation_percent DESC, member.effective_from, team.code, team.id)`;
}


/**
 * Appends the CTEs `opportunity_facts` (and helpers) to a query and returns
 * their text, binding values into `parameters`. `{from}`/`{to}` placeholders
 * in population SQL are bound separately by the caller (see bindPeriod).
 */
export function opportunityFactsCte(context, filters, parameters) {
  const org = addParameter(parameters, context.organizationId);
  const asOf = `${addParameter(parameters, filters.asOf)}::date`;
  const where = [`o.organization_id=${org}`];
  const scope = recordScope(definitionFor("opportunities"), context, parameters, "o");
  if (filters.scope === "mine") where.push(`o.owner_user_id=${addParameter(parameters, context.userId)}`);
  if (filters.scope === "team") {
    const me = addParameter(parameters, context.userId);
    where.push(`(o.owner_user_id=${me} OR o.owner_user_id IN (${managedTeamMembersSql(org, me)}))`);
  }
  if (filters.pipelineId) where.push(`o.pipeline_id=${addParameter(parameters, filters.pipelineId)}`);
  if (filters.stageId) where.push(`o.stage_id=${addParameter(parameters, filters.stageId)}`);
  if (filters.sourceId) where.push(`o.source_id=${addParameter(parameters, filters.sourceId)}`);
  if (filters.forecastCategory) where.push(`o.forecast_category=${addParameter(parameters, filters.forecastCategory)}`);
  if (filters.ownerId === "unassigned") where.push("o.owner_user_id IS NULL");
  else if (filters.ownerId) where.push(`o.owner_user_id=${addParameter(parameters, filters.ownerId)}`);
  const attributed = [];
  const scopeCtes = [];
  if (filters.teamId) {
    scopeCtes.push(`team_scope AS MATERIALIZED (${teamSubtreeSql(org, addParameter(parameters, filters.teamId))})`);
    attributed.push("team_id IN (SELECT id FROM team_scope)");
  }
  const valuationDate = `(CASE WHEN o.status IN ('won','lost') THEN COALESCE(o.actual_close_date, ${asOf}) ELSE ${asOf} END)`;
  const rate = `(CASE WHEN COALESCE(o.currency_code, organization.base_currency)=organization.base_currency THEN 1::numeric ELSE fx.rate END)`;
  return `${ownerTeamCte(org, asOf)},${scopeCtes.map((cte) => `
    ${cte},`).join("")}
    opportunity_base AS (
      SELECT o.id, o.code, o.name, o.status, o.pipeline_id, o.stage_id, o.owner_user_id, o.party_id, o.source_id,
             COALESCE(o.forecast_category,'pipeline') AS forecast_category,
             o.expected_close_date, o.actual_close_date, o.created_at, o.stage_entered_at, o.probability,
             o.amount, COALESCE(o.expected_revenue, 0) AS expected_revenue,
             COALESCE(o.currency_code, organization.base_currency) AS currency_code,
             organization.base_currency AS reporting_currency,
             ${rate} AS fx_rate,
             CASE WHEN COALESCE(o.currency_code, organization.base_currency)=organization.base_currency THEN NULL ELSE fx.rate_date END AS fx_rate_date,
             o.amount * ${rate} AS amount_reporting,
             COALESCE(o.expected_revenue, 0) * ${rate} AS weighted_reporting,
             (o.status='open' AND COALESCE(policy.maximum_days, stage.stale_after_days) IS NOT NULL
               AND o.stage_entered_at <= now() - (COALESCE(policy.maximum_days, stage.stale_after_days) || ' days')::interval) AS stalled,
             stage.name AS stage_name, stage.sequence AS stage_sequence, pipeline.name AS pipeline_name,
             owner_account.full_name AS owner_name, source.name AS source_name,
             owner_team.team_id
        FROM tenant.crm_opportunities o
        JOIN public.organizations organization ON organization.id=o.organization_id
        LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id=o.organization_id AND stage.id=o.stage_id
        LEFT JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id=o.organization_id AND pipeline.id=o.pipeline_id
        LEFT JOIN tenant.crm_opportunity_stage_sla_policies policy ON policy.organization_id=o.organization_id AND policy.pipeline_id=o.pipeline_id AND policy.stage_id=o.stage_id AND policy.status='active'
        LEFT JOIN public.users owner_account ON owner_account.id=o.owner_user_id
        LEFT JOIN tenant.crm_lead_sources source ON source.organization_id=o.organization_id AND source.id=o.source_id
        LEFT JOIN owner_team ON owner_team.user_id=o.owner_user_id
        LEFT JOIN LATERAL (
          SELECT rate.rate, rate.rate_date FROM tenant.exchange_rates rate
           WHERE rate.organization_id=o.organization_id
             AND rate.from_currency_code=COALESCE(o.currency_code, organization.base_currency) AND rate.to_currency_code=organization.base_currency
             AND rate.rate_date<=${valuationDate} AND rate.status='active'
           ORDER BY rate.rate_date DESC LIMIT 1) fx ON true
       WHERE ${where.join(" AND ")}${scope}
    ),
    opportunity_facts AS (
      SELECT base.*, team.name AS team_name
        FROM opportunity_base base
        LEFT JOIN tenant.crm_sales_teams team ON team.organization_id=${org} AND team.id=base.team_id
       ${attributed.length ? `WHERE ${attributed.map((clause) => `base.${clause}`).join(" AND ")}` : ""}
    )`;
}

// Replaces {from}/{to} in population SQL with bound date parameters, binding
// each distinct period once per parameter list.
const boundPeriods = new WeakMap();
export function bindPeriod(sql, filters, parameters) {
  if (!sql.includes("{from}") && !sql.includes("{to}")) return sql;
  const key = `${filters.from}|${filters.to}`;
  let bound = boundPeriods.get(parameters)?.get(key);
  if (!bound) {
    bound = { from: `${addParameter(parameters, filters.from)}::date`, to: `${addParameter(parameters, filters.to)}::date` };
    if (!boundPeriods.has(parameters)) boundPeriods.set(parameters, new Map());
    boundPeriods.get(parameters).set(key, bound);
  }
  return sql.replaceAll("{from}", bound.from).replaceAll("{to}", bound.to);
}
