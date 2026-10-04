import { createHash } from "node:crypto";
import { taskOverdueSql } from "../data-management/activity-query-rules.js";
import { CrmError } from "../data-management/errors.js";
import { canViewAllCrmRecords } from "../data-management/record-policy.js";
import { canViewAllCrmResource, crmAccountAccessSql, crmOwnerScopeSql } from "../data-management/crm-access-scope.js";
import { camelizeRow, managedTeamMembersSql } from "../data-management/record-utils.js";
import { getMetricRollup, getPipelineBreakdown, getPipelineMetrics, getUserQuotas } from "./pipeline-metrics.js";



const DASHBOARD_SCOPES = new Set(["mine", "team", "all"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// F024 — resolves the dashboard's scope and reporting period. Scope only ever
// NARROWS what the caller may already see (owner visibility,
// identical to record lists), so every figure stays openable: "mine" = records
// the caller owns; "team" = the caller plus active members of sales teams the
// caller manages; "all" = everything the caller is permitted to see. The
// period defaults to the current calendar month up to today; the previous
// period is the same number of days immediately before it.
export function resolveDashboardOptions(options = {}) {
  const scope = DASHBOARD_SCOPES.has(options.scope) ? options.scope : "all";
  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const from = ISO_DATE.test(String(options.from || "")) ? String(options.from) : monthStart.toISOString().slice(0, 10);
  let to = ISO_DATE.test(String(options.to || "")) ? String(options.to) : today.toISOString().slice(0, 10);
  if (to < from) to = from;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const previousTo = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const previousFrom = new Date(Date.parse(from) - days * 86400000).toISOString().slice(0, 10);
  return { scope, from, to, previousFrom, previousTo };
}

// Dashboard/report aliases → the CRM resource whose visibility rule applies.
const ALIAS_RESOURCE = Object.freeze({ lead: "leads", scoped_lead: "leads", opportunity: "opportunities", scoped_opportunity: "opportunities", activity: "activities" });

// The central owner/team/resource/relationship rule (crm-access-scope.js)
// as a boolean SQL expression. `callerParam` stays referenced even when the
// caller may see every row of that resource (all bound params must appear).
function resourceVisibleSql(context, alias, column, callerParam) {
  const scope = crmOwnerScopeSql(context, () => callerParam, `${alias}.${column}`, `${alias}.organization_id`, { resource: ALIAS_RESOURCE[alias] ?? null, alias });
  return scope ? `(${scope.replace(/^ AND /, "")})` : `(${callerParam}::uuid IS NULL OR true)`;
}

export async function getCrmDashboard(client, context, options = {}) {
  const period = resolveDashboardOptions(options);
  const parameters = [
    context.organizationId,
    Boolean(canViewAllCrmRecords(context)),
    context.userId,
    period.from,
    period.to,
    period.previousFrom,
    period.previousTo,
  ];
  // Mirrors recordScope()'s owner-scoping rule so dashboard totals never
  // reveal counts/sums that include records a restricted caller could not
  // otherwise list or open individually.
  // Own + unassigned + owned by a member of a team the caller manages — the
  // shared rule (crm-access-scope.js); $2 = view-all, $3 = caller.
  const permitted = (alias, column) => `($2::boolean OR ${resourceVisibleSql(context, alias, column, "$3")})`;
  const ownerVisible = (alias, column) =>
    period.scope === "mine"
      ? `(${permitted(alias, column)} AND ${alias}.${column} = $3)`
      : period.scope === "team"
        ? `(${permitted(alias, column)} AND (${alias}.${column} = $3 OR ${alias}.${column} IN (${managedTeamMembersSql("$1", "$3")})))`
        : permitted(alias, column);
  const inPeriod = (column, fromParam = "$4", toParam = "$5") => `${column} >= ${fromParam}::date AND ${column} < ${toParam}::date + 1`;
  const orgWide = period.scope === "all" ? "true" : "false";
  // Stage/source/activity lists reference only $1-$3 (no period params).
  const baseParameters = parameters.slice(0, 3);
  // One pass over the caller's leads and one over their activities (each
  // figure is a FILTER on that pass) instead of
  // a separate scan per figure.
  const leadVisible = ownerVisible("lead", "owner_user_id");
  const activityVisible = ownerVisible("activity", "assigned_to");
  const result = await client.query(
    `WITH scoped_leads AS (
       -- Visibility is evaluated once per lead (it can contain a managed-team
       -- EXISTS for restricted users), not once per figure below.
       SELECT lead.organization_id, lead.status, lead.stage, lead.rating, lead.created_at, lead.converted_at,
              lead.owner_user_id, (${leadVisible}) AS visible
         FROM tenant.crm_leads lead
        WHERE lead.organization_id = $1 AND lead.archived_at IS NULL
     ), lead_counts AS (
       SELECT
         count(*) FILTER (WHERE lead.status = 'open' AND lead.visible)::int AS open_leads,
         count(*) FILTER (WHERE lead.status = 'qualified' AND lead.visible)::int AS qualified_leads,
         count(*) FILTER (WHERE ${inPeriod("lead.created_at")} AND lead.visible)::int AS leads_in_period,
         count(*) FILTER (WHERE ${inPeriod("lead.created_at", "$6", "$7")} AND lead.visible)::int AS leads_previous_period,
         count(*) FILTER (WHERE lead.status = 'converted' AND ${inPeriod("lead.converted_at")} AND lead.visible)::int AS conversions_in_period,
         count(*) FILTER (WHERE lead.status = 'converted' AND ${inPeriod("lead.converted_at", "$6", "$7")} AND lead.visible)::int AS conversions_previous_period,
         count(*) FILTER (WHERE lead.status = 'open' AND lead.owner_user_id IS NULL AND ${orgWide})::int AS unassigned_leads,
         count(*) FILTER (WHERE lead.status = 'open' AND lead.stage = 'qualification' AND lead.visible)::int AS needs_qualification_leads,
         count(*) FILTER (WHERE lead.status = 'open' AND lead.rating = 'hot' AND lead.visible)::int AS high_priority_leads
       FROM scoped_leads lead
     ), activity_counts AS (
       SELECT
         count(*) FILTER (WHERE ${taskOverdueSql("activity")})::int AS overdue_activities,
         count(*) FILTER (WHERE activity.activity_type = 'task' AND ${taskOverdueSql("activity")})::int AS overdue_tasks,
         count(*) FILTER (WHERE activity.status NOT IN ('completed','cancelled') AND activity.due_at >= current_date AND activity.due_at < current_date + interval '1 day')::int AS due_today
       FROM tenant.crm_activities activity
       WHERE activity.organization_id = $1 AND ${activityVisible}
     )
     SELECT
      (SELECT organization.base_currency FROM public.organizations organization WHERE organization.id = $1) AS currency_code,
      lead_counts.*, activity_counts.*,
      -- F020 (Territories/sales teams) coverage gap: a territory with
      -- nobody currently, effectively assigned as its primary owner. A territory with only an 'overlay'/
      -- 'shared'/'manager' assignment role and no 'primary' one still
      -- counts as a coverage gap — those roles supplement primary
      -- ownership, they do not substitute for it.
      (SELECT count(*)::int FROM tenant.crm_territories territory
        WHERE territory.organization_id = $1 AND territory.status = 'active' AND ${orgWide}
          AND NOT EXISTS (
            SELECT 1 FROM tenant.crm_territory_assignments assignment
             WHERE assignment.organization_id = territory.organization_id AND assignment.territory_id = territory.id
               AND assignment.assignment_role = 'primary'
               AND assignment.effective_from <= current_date
               AND (assignment.effective_to IS NULL OR assignment.effective_to >= current_date)
          )) AS uncovered_territories
     FROM lead_counts, activity_counts`,
    parameters,
  );
  // Stage rows only; each stage's count/amount is the canonical breakdown below.
  const stages = await client.query(
    `SELECT stage.id, stage.name, stage.sequence FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id = stage.pipeline_id AND pipeline.organization_id = stage.organization_id
      WHERE stage.organization_id = $1 AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost
      ORDER BY stage.sequence`,
    [context.organizationId],
  );
  const sources = await client.query(
    `SELECT COALESCE(source.name,'Unspecified') AS name, count(lead.id)::int AS lead_count, count(lead.id) FILTER (WHERE lead.status = 'converted')::int AS converted_count FROM tenant.crm_leads lead LEFT JOIN tenant.crm_lead_sources source ON source.id = lead.source_id WHERE lead.organization_id = $1 AND ${ownerVisible("lead", "owner_user_id")} GROUP BY source.name ORDER BY lead_count DESC LIMIT 10`,
    baseParameters,
  );
  const activities = await client.query(
    `SELECT activity.*, user_account.full_name AS assigned_name FROM tenant.crm_activities activity LEFT JOIN public.users user_account ON user_account.id = activity.assigned_to WHERE activity.organization_id = $1 AND activity.status NOT IN ('completed','cancelled') AND ${ownerVisible("activity", "assigned_to")} ORDER BY activity.due_at ASC NULLS LAST LIMIT 10`,
    baseParameters,
  );
  // Opportunity figures come from the canonical metric layer (currency
  // converted, same population as their drill-downs) — never a second formula.
  const current = await getPipelineMetrics(client, context, { from: period.from, to: period.to, scope: period.scope });
  const previous = await getPipelineMetrics(client, context, { from: period.previousFrom, to: period.previousTo, scope: period.scope });
  const byStage = await getPipelineBreakdown(client, context, { metric: "open_pipeline", dimension: "stage", filters: { from: period.from, to: period.to, scope: period.scope } });
  const stageValue = new Map(byStage.rows.map((row) => [row.key, row]));
  return {
    scope: period.scope,
    period: { from: period.from, to: period.to, previousFrom: period.previousFrom, previousTo: period.previousTo },
    canViewAll: Boolean(canViewAllCrmRecords(context)),
    metricVersion: current.metricVersion,
    currency: current.currency,
    metrics: {
      ...camelizeRow(result.rows[0]),
      openOpportunities: current.metrics.open_opportunities,
      pipelineValue: current.metrics.open_pipeline,
      weightedPipeline: current.metrics.weighted_pipeline,
      wonInPeriod: current.metrics.won_count,
      wonAmountInPeriod: current.metrics.won_amount,
      lostInPeriod: current.metrics.lost_count,
      wonPreviousPeriod: previous.metrics.won_count,
      wonAmountPreviousPeriod: previous.metrics.won_amount,
      lostPreviousPeriod: previous.metrics.lost_count,
      stalledOpportunities: current.metrics.stalled_opportunities,
    },
    stages: stages.rows.map((row) => {
      const stage = camelizeRow(row);
      const canonical = stageValue.get(String(stage.id));
      return { ...stage, opportunityCount: canonical?.count ?? 0, amount: canonical?.value ?? 0 };
    }),
    sources: sources.rows.map(camelizeRow),
    activities: activities.rows.map(camelizeRow),
  };
}



// Pipeline, forecast and revenue-operations reports are rows of the canonical
// metric layer (metric-definitions.js) — the same figures as the dashboard
// and forecast, in the reporting currency — never their own formulas.
const CANONICAL_REPORTS = new Set(["pipeline", "forecast", "revenue-operations"]);

async function canonicalReport(client, context, report, { from, to }) {
  const filters = { from: from ?? undefined, to: to ?? undefined };
  const summary = await getPipelineMetrics(client, context, filters);
  let rows;
  if (report === "pipeline") {
    const rollup = await getMetricRollup(client, context, { dimension: "stage", metrics: ["open_opportunities", "open_pipeline", "weighted_pipeline"], filters });
    rows = rollup.rows.map((row) => ({ stageId: row.key, name: row.label, count: row.values.open_opportunities, amount: row.values.open_pipeline, weightedAmount: row.values.weighted_pipeline }));
  } else if (report === "forecast") {
    const rollup = await getMetricRollup(client, context, { dimension: "owner", metrics: ["forecast_pipeline", "weighted_closing", "best_case", "commit", "won_amount", "closing_opportunities", "won_count"], filters });
    rows = rollup.rows.map((row) => ({
      ownerUserId: row.key, owner: row.label, pipeline: row.values.forecast_pipeline, weighted: row.values.weighted_closing, bestCase: row.values.best_case,
      commitAmount: row.values.commit, won: row.values.won_amount, openDeals: row.values.closing_opportunities, wonDeals: row.values.won_count,
    })).sort((a, b) => b.weighted - a.weighted);
  } else {
    const rollup = await getMetricRollup(client, context, { dimension: "owner", metrics: ["open_pipeline", "best_case", "commit", "won_amount", "win_rate", "closing_in_period"], filters });
    const quotas = await getUserQuotas(client, context, filters);
    const seen = new Set();
    rows = rollup.rows.map((row) => {
      seen.add(String(row.key));
      const quota = quotas.get(String(row.key)) ?? null;
      return {
        ownerUserId: row.key, owner: row.label, quota, pipeline: row.values.open_pipeline, bestCase: row.values.best_case, committed: row.values.commit, won: row.values.won_amount,
        pipelineCoverage: quota ? Math.round((row.values.closing_in_period / quota) * 100) / 100 : null,
        quotaAttainmentPercent: quota ? Math.round((row.values.won_amount / quota) * 10000) / 100 : null,
        winRatePercent: row.values.win_rate,
      };
    });
    const names = quotas.size ? await client.query(`SELECT id, full_name FROM public.users WHERE id = ANY($1::uuid[])`, [[...quotas.keys()].filter((id) => !seen.has(id))]) : { rows: [] };
    for (const user of names.rows)
      rows.push({ ownerUserId: user.id, owner: user.full_name, quota: quotas.get(String(user.id)), pipeline: 0, bestCase: 0, committed: 0, won: 0, pipelineCoverage: 0, quotaAttainmentPercent: 0, winRatePercent: null });
    rows.sort((a, b) => b.won - a.won || b.pipeline - a.pipeline);
  }
  const reportFilters = { from: summary.filters.from, to: summary.filters.to };
  const fingerprint = createHash("sha256").update(JSON.stringify({ report, filters: reportFilters, rows })).digest("hex");
  return { report, rows, filters: reportFilters, currency: summary.currency, metricVersion: summary.metricVersion, generatedAt: new Date().toISOString(), fingerprint };
}

export async function getCrmReport(client, context, report, filters = {}) {
  const from = filters.from || null;
  const to = filters.to || null;
  // F030 — a malformed date is a clear 400, never a raw database cast error.
  for (const value of [from, to])
    if (value !== null && !ISO_DATE.test(String(value)))
      throw new CrmError(400, "Report dates must be in YYYY-MM-DD format.", "CRM_REPORT_DATE_INVALID");
  if (from && to && from > to) throw new CrmError(400, "The report start date is after its end date.", "CRM_REPORT_DATE_RANGE_INVALID");
  const parameters = [
    context.organizationId,
    from,
    to,
    Boolean(canViewAllCrmRecords(context)),
    context.userId,
  ];
  const dateClause = (column) =>
    `AND ($2::date IS NULL OR ${column} >= $2::date) AND ($3::date IS NULL OR ${column} < $3::date + 1)`;
  // Same owner-scoping rule as recordScope()/getCrmDashboard() — reports
  // built from crm_leads/crm_opportunities/crm_activities (the three
  // resources with an ownerField) must not aggregate rows a restricted
  // caller could not otherwise see individually. Reports built from other
  // tables (campaigns, account plans, pipeline inspections, conversations,
  // buying committees, partner accounts, AI predictions) are unaffected —
  // none of those resources were given per-record ownership scope.
  // The shared rule (crm-access-scope.js): every report now includes the
  // managed-team tier, not only the forecast. $4 = view-all, $5 = caller.
  const ownerVisible = (alias, column) => `($4::boolean OR ${resourceVisibleSql(context, alias, column, "$5")})`;
  // Child-record tiers for reports built on tables without their own owner:
  // a row counts only when the record it describes is visible to the caller
  // under that record's own rule (crm-access-scope.js).
  const opportunityVisible = (idExpr) =>
    `EXISTS (SELECT 1 FROM tenant.crm_opportunities scoped_opportunity WHERE scoped_opportunity.organization_id=$1 AND scoped_opportunity.id=${idExpr} AND ${ownerVisible("scoped_opportunity", "owner_user_id")})`;
  const leadVisible = (idExpr) =>
    `EXISTS (SELECT 1 FROM tenant.crm_leads scoped_lead WHERE scoped_lead.organization_id=$1 AND scoped_lead.id=${idExpr} AND ${ownerVisible("scoped_lead", "owner_user_id")})`;
  const accountVisible = (idExpr) =>
    `EXISTS (SELECT 1 FROM tenant.business_parties scoped_account WHERE scoped_account.organization_id=$1 AND scoped_account.id=${idExpr}${crmAccountAccessSql(context, () => "$5", "scoped_account")})`;
  // Organisation-wide operational rollups (every campaign member, touchpoint,
  // partner deal, AI prediction or privacy request) cannot be narrowed to a
  // caller's own records without changing what the report means, so they
  // are only for callers who can see every CRM record.
  // Who may see each organisation-wide rollup: Campaign/attribution figures
  // aggregate campaign members and Lead touchpoints (Lead-wide visibility,
  // e.g. Marketing) — revenue there is the touchpoint's recorded amount, not
  // Opportunity records; partner pipeline needs the partner relationship.
  const rollupAllowed = {
    campaigns: () => canViewAllCrmResource(context, "leads"),
    attribution: () => canViewAllCrmResource(context, "leads"),
    "partner-pipeline": () => canViewAllCrmRecords(context) || Boolean(context.permissions?.includes("crm.partners.manage")),
    "ai-governance": () => canViewAllCrmRecords(context),
    privacy: () => canViewAllCrmRecords(context),
  }[report];
  if (rollupAllowed && !rollupAllowed())
    throw new CrmError(403, "This report covers records outside your CRM access.", "CRM_REPORT_SCOPE_FORBIDDEN");
  if (CANONICAL_REPORTS.has(report)) return canonicalReport(client, context, report, { from, to });
  let sql;
  if (report === "conversion")
    sql = `SELECT date_trunc('month', lead.created_at)::date AS period, count(*)::int AS leads, count(*) FILTER (WHERE lead.status='converted')::int AS converted, round((count(*) FILTER (WHERE lead.status='converted')::numeric / NULLIF(count(*),0))*100,2) AS conversion_rate FROM tenant.crm_leads lead WHERE lead.organization_id=$1 ${dateClause("lead.created_at")} AND ${ownerVisible("lead", "owner_user_id")} GROUP BY period ORDER BY period`;
  else if (report === "sources")
    // source.id is selected for the same reason as
    // pipeline's stage.id above.
    sql = `SELECT source.id AS source_id, COALESCE(source.name,'Unspecified') AS source, count(lead.id)::int AS leads, count(lead.id) FILTER (WHERE lead.status='converted')::int AS converted, COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status='won'),0)::numeric AS won_revenue FROM tenant.crm_leads lead LEFT JOIN tenant.crm_lead_sources source ON source.id=lead.source_id LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.lead_id=lead.id AND opportunity.organization_id=lead.organization_id AND ${ownerVisible("opportunity", "owner_user_id")} WHERE lead.organization_id=$1 ${dateClause("lead.created_at")} AND ${ownerVisible("lead", "owner_user_id")} GROUP BY source.id, source.name ORDER BY leads DESC`;
  else if (report === "activities")
    sql = `SELECT activity.activity_type, count(*)::int AS total, count(*) FILTER (WHERE activity.status='completed')::int AS completed, count(*) FILTER (WHERE ${taskOverdueSql("activity")})::int AS overdue FROM tenant.crm_activities activity WHERE activity.organization_id=$1 ${dateClause("activity.created_at")} AND ${ownerVisible("activity", "assigned_to")} GROUP BY activity.activity_type ORDER BY total DESC`;
  else if (report === "win-loss")
    // F026 — closed deals by outcome and recorded reason, for the deals won
    // or lost in the period (actual close date) that the caller may see.
    // Each row carries the reason id so it drills into the Opportunities
    // list with the same predicates (status, outcomeReasonId, closedFrom/
    // closedTo) and reconciles exactly. Deals closed before reasons were
    // required group under "No reason recorded" (outcomeReasonId=none).
    sql = `SELECT COALESCE(reason.name,'No reason recorded') AS reason, opportunity.status AS outcome, opportunity.outcome_reason_id,
      count(*)::int AS deals, COALESCE(sum(opportunity.amount),0)::numeric AS amount,
      round(count(*)::numeric*100/NULLIF(sum(count(*)) OVER (PARTITION BY opportunity.status),0),1) AS share_of_outcome_percent,
      round(avg(opportunity.actual_close_date - opportunity.created_at::date))::int AS avg_days_to_close
    FROM tenant.crm_opportunities opportunity
    LEFT JOIN tenant.crm_lost_reasons reason ON reason.organization_id=opportunity.organization_id AND reason.id=opportunity.outcome_reason_id
    WHERE opportunity.organization_id=$1 AND opportunity.status IN ('won','lost') ${dateClause("opportunity.actual_close_date")}
      AND ${ownerVisible("opportunity", "owner_user_id")}
    GROUP BY opportunity.status, opportunity.outcome_reason_id, reason.name
    ORDER BY opportunity.status DESC, deals DESC, reason`;
  else if (report === "campaigns")
    sql = `SELECT campaign.name, campaign.status, campaign.budget, campaign.actual_cost, count(member.id)::int AS members, count(member.id) FILTER (WHERE member.member_status IN ('responded','attended','converted'))::int AS responses, count(member.id) FILTER (WHERE member.member_status='converted')::int AS conversions FROM tenant.crm_campaigns campaign LEFT JOIN tenant.crm_campaign_members member ON member.campaign_id=campaign.id AND member.organization_id=campaign.organization_id WHERE campaign.organization_id=$1 ${dateClause("campaign.created_at")} GROUP BY campaign.id ORDER BY campaign.created_at DESC`;
  else if (report === "attribution")
    // Multi-touch rollup over tenant.crm_marketing_touchpoints (see
    // lead-attribution.js) — per-campaign touch volume, first/last-touch
    // counts and converted revenue. Per-Lead weighted credit under any of
    // the 5 attribution models lives at GET
    // /api/crm/leads/[id]/attribution instead; this report is the
    // org-level rollup the "campaigns" report above has no touch-sequence
    // data to produce.
    sql = `SELECT campaign.name, campaign.attribution_model, count(DISTINCT touchpoint.subject_id)::int AS leads_touched, count(touchpoint.id)::int AS touches, count(touchpoint.id) FILTER (WHERE touchpoint.event_type='converted')::int AS conversions, COALESCE(sum(touchpoint.revenue) FILTER (WHERE touchpoint.event_type='converted'),0)::numeric AS attributed_revenue, count(touchpoint.id) FILTER (WHERE touchpoint.rank_asc=1)::int AS first_touches, count(touchpoint.id) FILTER (WHERE touchpoint.rank_desc=1)::int AS last_touches FROM (SELECT raw.*, row_number() OVER (PARTITION BY raw.subject_id ORDER BY raw.event_at ASC) AS rank_asc, row_number() OVER (PARTITION BY raw.subject_id ORDER BY raw.event_at DESC) AS rank_desc FROM tenant.crm_marketing_touchpoints raw WHERE raw.organization_id=$1 AND raw.subject_type='lead' AND raw.campaign_id IS NOT NULL) touchpoint JOIN tenant.crm_campaigns campaign ON campaign.organization_id=$1 AND campaign.id=touchpoint.campaign_id WHERE campaign.organization_id=$1 ${dateClause("touchpoint.event_at")} GROUP BY campaign.id, campaign.name, campaign.attribution_model ORDER BY attributed_revenue DESC`;
  else if (report === "account-health")
    sql = `SELECT party.display_name AS account, plan.account_tier, plan.lifecycle_stage, plan.health_status, plan.health_score, plan.annual_revenue, plan.potential_revenue, plan.renewal_date, plan.next_review_at FROM tenant.crm_account_plans plan JOIN tenant.business_parties party ON party.id = plan.party_id AND party.organization_id = plan.organization_id WHERE plan.organization_id = $1 AND plan.status = 'active' AND ${accountVisible("plan.party_id")} ORDER BY CASE plan.health_status WHEN 'critical' THEN 1 WHEN 'at_risk' THEN 2 WHEN 'watch' THEN 3 WHEN 'healthy' THEN 4 ELSE 5 END, plan.next_review_at NULLS LAST`;
  else if (report === "privacy")
    sql = `SELECT request.request_type, request.status, count(*)::int AS requests, count(*) FILTER (WHERE request.due_at < now() AND request.status NOT IN ('completed','rejected','cancelled'))::int AS overdue FROM tenant.crm_privacy_requests request WHERE request.organization_id = $1 ${dateClause("request.created_at")} GROUP BY request.request_type, request.status ORDER BY request.request_type, request.status`;
  else if (report === "pipeline-intelligence")
    sql = `SELECT inspection.health_status, count(*)::int AS opportunities, round(avg(inspection.health_score),2) AS average_health_score, round(avg(inspection.stage_age_days),2) AS average_stage_age_days, round(avg(inspection.days_since_activity),2) AS average_days_since_activity, count(*) FILTER (WHERE inspection.close_date_slip_days > 0)::int AS slipped_close_dates FROM tenant.crm_pipeline_inspections inspection WHERE inspection.organization_id = $1 ${dateClause("inspection.inspected_at")} AND ${opportunityVisible("inspection.opportunity_id")} GROUP BY inspection.health_status ORDER BY CASE inspection.health_status WHEN 'critical' THEN 1 WHEN 'at_risk' THEN 2 WHEN 'watch' THEN 3 ELSE 4 END`;
  else if (report === "engagement-intelligence")
    sql = `SELECT conversation.channel, count(DISTINCT conversation.id)::int AS conversations, count(insight.id)::int AS insights, count(insight.id) FILTER (WHERE insight.insight_type = 'risk')::int AS risks, count(insight.id) FILTER (WHERE insight.insight_type = 'next_action')::int AS next_actions, count(insight.id) FILTER (WHERE insight.review_status = 'pending')::int AS pending_review FROM tenant.crm_conversations conversation LEFT JOIN tenant.crm_conversation_insights insight ON insight.organization_id = conversation.organization_id AND insight.conversation_id = conversation.id WHERE conversation.organization_id = $1 ${dateClause("conversation.started_at")} AND ($4::boolean OR (conversation.lead_id IS NOT NULL AND ${leadVisible("conversation.lead_id")}) OR (conversation.lead_id IS NULL AND conversation.opportunity_id IS NOT NULL AND ${opportunityVisible("conversation.opportunity_id")}) OR (conversation.lead_id IS NULL AND conversation.opportunity_id IS NULL AND conversation.party_id IS NOT NULL AND ${accountVisible("conversation.party_id")})) GROUP BY conversation.channel ORDER BY conversations DESC`;
  else if (report === "relationship-coverage")
    sql = `SELECT committee.status, count(DISTINCT committee.id)::int AS committees, round(avg(committee.coverage_score),2) AS average_coverage_score, count(member.id)::int AS members, count(member.id) FILTER (WHERE member.member_role = 'economic_buyer')::int AS economic_buyers, count(member.id) FILTER (WHERE member.member_role = 'champion')::int AS champions, count(member.id) FILTER (WHERE member.sentiment IN ('detractor','strong_detractor'))::int AS detractors FROM tenant.crm_buying_committees committee LEFT JOIN tenant.crm_buying_committee_members member ON member.organization_id = committee.organization_id AND member.committee_id = committee.id AND member.status = 'active' WHERE committee.organization_id = $1 ${dateClause("committee.created_at")} AND (CASE WHEN committee.opportunity_id IS NOT NULL THEN ${opportunityVisible("committee.opportunity_id")} ELSE ${accountVisible("committee.party_id")} END) GROUP BY committee.status ORDER BY committees DESC`;
  else if (report === "partner-pipeline")
    sql = `SELECT partner.partner_type, partner.tier, count(deal.id)::int AS registered_deals, COALESCE(sum(deal.expected_value),0)::numeric AS expected_value, count(deal.id) FILTER (WHERE deal.status = 'won')::int AS won_deals, count(deal.id) FILTER (WHERE deal.status IN ('submitted','approved','active'))::int AS active_deals FROM tenant.crm_partner_accounts partner LEFT JOIN tenant.crm_partner_deals deal ON deal.organization_id = partner.organization_id AND deal.partner_account_id = partner.id ${dateClause("deal.registered_at")} WHERE partner.organization_id = $1 AND partner.status = 'active' GROUP BY partner.partner_type, partner.tier ORDER BY expected_value DESC`;
  else if (report === "ai-governance")
    sql = `SELECT prediction.prediction_type, prediction.model_provider, prediction.model_name, count(*)::int AS predictions, round(avg(prediction.score),4) AS average_score, count(feedback.id)::int AS feedback_events, count(feedback.id) FILTER (WHERE feedback.outcome IN ('accepted','correct'))::int AS positive_feedback, count(feedback.id) FILTER (WHERE feedback.outcome IN ('rejected','incorrect','not_actionable'))::int AS negative_feedback FROM tenant.crm_ai_predictions prediction LEFT JOIN tenant.crm_ai_feedback feedback ON feedback.organization_id = prediction.organization_id AND feedback.prediction_id = prediction.id WHERE prediction.organization_id = $1 ${dateClause("prediction.generated_at")} GROUP BY prediction.prediction_type, prediction.model_provider, prediction.model_name ORDER BY predictions DESC`;
  else throw new CrmError(404, "Unknown CRM report.");
  // All 5 elements of `parameters` are bound on every call regardless of
  // report type, but only report variants that call ownerVisible() ($4/$5)
  // reference $4/$5 in their own SQL — Postgres infers the required bind
  // count from the highest $n it finds in the final query text, so a report
  // branch that never touches $4/$5 would deterministically fail with
  // "bind message supplies 5 parameters, but prepared statement "" requires
  // 3" (reproduced live: account-health/privacy/pipeline-intelligence/
  // engagement-intelligence/relationship-coverage/partner-pipeline/
  // ai-governance/campaigns all hit this on every single call against a
  // real database — no fake-DB-client unit test caught it since none
  // enforce real Postgres bind-count validation). Referencing $4/$5 here
  // unconditionally guarantees every report's final query always
  // references all 5 placeholders, matching what's always bound.
  const scopeParametersCte = `crm_scope_parameters AS (
    SELECT $1::uuid AS organization_id,
      $2::date AS date_from,
      $3::date AS date_to,
      $4::boolean AS can_view_all_records,
      $5::uuid AS active_user_id
  )`;
  sql = /^\s*WITH\s+/i.test(sql)
    ? sql.replace(/^\s*WITH\s+/i, `WITH ${scopeParametersCte}, `)
    : `WITH ${scopeParametersCte} ${sql}`;

  const result = await client.query(sql, parameters);
  const rows = result.rows.map(camelizeRow);
  // F030 — reproducibility: a fingerprint of the report key, filters and
  // rows. The same data, scope and period give the same fingerprint, so a
  // figure shared or exported earlier can be checked against a re-run.
  const fingerprint = createHash("sha256").update(JSON.stringify({ report, filters: { from, to }, rows })).digest("hex");
  return { report, rows, filters: { from, to }, generatedAt: new Date().toISOString(), fingerprint };
}
