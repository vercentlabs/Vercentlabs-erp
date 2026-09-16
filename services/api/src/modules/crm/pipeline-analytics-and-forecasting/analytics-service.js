import { taskOverdueSql } from "../seller-activity-and-follow-up-workspace/task-operations.js";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { canViewAllCrmRecords } from "../crm-data-operations-and-customization/record-policy.js";
import { camelizeRow } from "../crm-data-operations-and-customization/record-utils.js";



export async function getCrmDashboard(client, context) {
  const parameters = [
    context.organizationId,
    context.activeCompanyId,
    context.activeBranchId,
    Boolean(context.allowAllCompanies),
    Boolean(canViewAllCrmRecords(context)),
    context.userId,
  ];
  // As of the company-switcher fix below: the active company/branch, when
  // selected, always scopes dashboard totals — for every role, including
  // organization_owner/system_administrator. $4 (allowAllCompanies) only
  // matters when no company is actively selected at all (the genuine
  // "no company chosen" case), matching recordScope()'s corrected
  // semantics. Previously $4 alone bypassed this filter unconditionally,
  // so an owner/admin's dashboard totals never actually reflected which
  // company was selected in the top bar.
  const companyVisible = (alias) =>
    `(($2::uuid IS NOT NULL AND (${alias}.company_id IS NULL OR ${alias}.company_id = $2)) OR ($2::uuid IS NULL AND $4::boolean))`;
  const branchVisible = (alias) =>
    `(($3::uuid IS NOT NULL AND (${alias}.branch_id IS NULL OR ${alias}.branch_id = $3)) OR ($3::uuid IS NULL AND $4::boolean))`;
  // Mirrors recordScope()'s owner-scoping rule so dashboard totals never
  // reveal counts/sums that include records a restricted caller could not
  // otherwise list or open individually (docs/implementation/
  // ERP_SECURITY_HARDENING_003.md, Part 2, "CRM Analytics Security").
  const ownerVisible = (alias, column) =>
    `($5::boolean OR ${alias}.${column} IS NULL OR ${alias}.${column} = $6)`;
  const result = await client.query(
    `SELECT
      (SELECT organization.base_currency FROM public.organizations organization WHERE organization.id = $1) AS currency_code,
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.record_status='active' AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")}) AS open_leads,
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.qualification_state = 'qualified' AND lead.record_status='active' AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")}) AS qualified_leads,
      (SELECT count(*)::int FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status = 'open' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} AND ${ownerVisible("opportunity", "owner_user_id")}) AS open_opportunities,
      (SELECT COALESCE(sum(opportunity.amount),0)::numeric FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status = 'open' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} AND ${ownerVisible("opportunity", "owner_user_id")}) AS pipeline_value,
      (SELECT COALESCE(sum(opportunity.expected_revenue),0)::numeric FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status = 'open' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} AND ${ownerVisible("opportunity", "owner_user_id")}) AS weighted_pipeline,
      (SELECT count(*)::int FROM tenant.crm_activities activity WHERE activity.organization_id = $1 AND ${taskOverdueSql("activity")} AND ${companyVisible("activity")} AND ${branchVisible("activity")} AND ${ownerVisible("activity", "assigned_to")}) AS overdue_activities,
      (SELECT count(*)::int FROM tenant.crm_activities activity WHERE activity.organization_id = $1 AND activity.status NOT IN ('completed','cancelled') AND activity.due_at >= current_date AND activity.due_at < current_date + interval '1 day' AND ${companyVisible("activity")} AND ${branchVisible("activity")} AND ${ownerVisible("activity", "assigned_to")}) AS due_today,
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.created_at >= date_trunc('month', now()) AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")}) AS leads_this_month,
      (SELECT count(*)::int FROM tenant.crm_conversion_records conversion JOIN tenant.crm_leads lead ON lead.id = conversion.lead_id AND lead.organization_id = conversion.organization_id WHERE conversion.organization_id = $1 AND conversion.converted_at >= date_trunc('month', now()) AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")}) AS conversions_this_month,
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.record_status='active' AND lead.owner_user_id IS NULL AND ${companyVisible("lead")} AND ${branchVisible("lead")}) AS unassigned_leads,
      (SELECT count(*)::int FROM tenant.crm_leads lead JOIN tenant.crm_lead_stages stage ON stage.organization_id=lead.organization_id AND stage.code=lead.status WHERE lead.organization_id = $1 AND lead.record_status='active' AND stage.dwell_breach_hours IS NOT NULL AND lead.stage_entered_at <= now() - (stage.dwell_breach_hours || ' hours')::interval AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")}) AS dwell_breached_leads,
      -- F024 (Pipeline dashboard) — LAST PROMPT 1/3 closeout: the dossier's
      -- required "stalled/risk signals" item had no Opportunity-side
      -- equivalent on the dashboard despite the real per-stage threshold
      -- (crm_opportunity_stage_sla_policies, falling back to
      -- crm_pipeline_stages.stale_after_days — see opportunity-and-pipeline-
      -- governance/stage-aging.js's computeStageAge, already used by the
      -- pipeline board) already existing; this reuses the identical
      -- threshold precedence at the SQL level rather than inventing a
      -- second one.
      (SELECT count(*)::int FROM tenant.crm_opportunities opportunity
         LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id=opportunity.organization_id AND stage.id=opportunity.stage_id
         LEFT JOIN tenant.crm_opportunity_stage_sla_policies policy ON policy.organization_id=opportunity.organization_id AND policy.pipeline_id=opportunity.pipeline_id AND policy.stage_id=opportunity.stage_id AND policy.status='active'
        WHERE opportunity.organization_id = $1 AND opportunity.status = 'open' AND COALESCE(policy.maximum_days, stage.stale_after_days) IS NOT NULL
          AND opportunity.stage_entered_at <= now() - (COALESCE(policy.maximum_days, stage.stale_after_days) || ' days')::interval
          AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} AND ${ownerVisible("opportunity", "owner_user_id")}) AS stalled_opportunities,
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.record_status='active' AND lead.qualification_state='not_reviewed' AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")}) AS needs_qualification_leads,
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.record_status='active' AND lead.lead_grade IN ('hot','qualified') AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")}) AS high_priority_leads,
      -- F020 (Territories/sales teams) — LAST PROMPT 1/3 closeout: the
      -- dossier's required "coverage gap" signal (a territory with nobody
      -- currently, effectively assigned as its primary owner) had no
      -- detection/reporting anywhere. A territory with only an 'overlay'/
      -- 'shared'/'manager' assignment role and no 'primary' one still
      -- counts as a coverage gap — those roles supplement primary
      -- ownership, they do not substitute for it.
      (SELECT count(*)::int FROM tenant.crm_territories territory
        WHERE territory.organization_id = $1 AND territory.status = 'active' AND ${companyVisible("territory")}
          AND NOT EXISTS (
            SELECT 1 FROM tenant.crm_territory_assignments assignment
             WHERE assignment.organization_id = territory.organization_id AND assignment.territory_id = territory.id
               AND assignment.assignment_role = 'primary'
               AND assignment.effective_from <= current_date
               AND (assignment.effective_to IS NULL OR assignment.effective_to >= current_date)
          )) AS uncovered_territories`,
    parameters,
  );
  const stages = await client.query(
    `SELECT stage.id, stage.name, stage.sequence, count(opportunity.id)::int AS opportunity_count, COALESCE(sum(opportunity.amount),0)::numeric AS amount FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id = stage.pipeline_id AND pipeline.organization_id = stage.organization_id LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.stage_id = stage.id AND opportunity.organization_id = stage.organization_id AND opportunity.status = 'open' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} AND ${ownerVisible("opportunity", "owner_user_id")} WHERE stage.organization_id = $1 AND stage.status = 'active' AND ${companyVisible("pipeline")} GROUP BY stage.id ORDER BY stage.sequence`,
    parameters,
  );
  const sources = await client.query(
    `SELECT COALESCE(source.name,'Unspecified') AS name, count(lead.id)::int AS lead_count, count(lead.id) FILTER (WHERE lead.record_status = 'converted')::int AS converted_count FROM tenant.crm_leads lead LEFT JOIN tenant.crm_lead_sources source ON source.id = lead.source_id WHERE lead.organization_id = $1 AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")} GROUP BY source.name ORDER BY lead_count DESC LIMIT 10`,
    parameters,
  );
  const activities = await client.query(
    `SELECT activity.*, user_account.full_name AS assigned_name FROM tenant.crm_activities activity LEFT JOIN public.users user_account ON user_account.id = activity.assigned_to WHERE activity.organization_id = $1 AND activity.status NOT IN ('completed','cancelled') AND ${companyVisible("activity")} AND ${branchVisible("activity")} AND ${ownerVisible("activity", "assigned_to")} ORDER BY activity.due_at ASC NULLS LAST LIMIT 10`,
    parameters,
  );
  return {
    metrics: camelizeRow(result.rows[0]),
    stages: stages.rows.map(camelizeRow),
    sources: sources.rows.map(camelizeRow),
    activities: activities.rows.map(camelizeRow),
  };
}



export async function getCrmReport(client, context, report, filters = {}) {
  const from = filters.from || null;
  const to = filters.to || null;
  const parameters = [
    context.organizationId,
    context.activeCompanyId,
    context.activeBranchId,
    Boolean(context.allowAllCompanies),
    from,
    to,
    Boolean(canViewAllCrmRecords(context)),
    context.userId,
  ];
  const dateClause = (column) =>
    `AND ($5::date IS NULL OR ${column} >= $5::date) AND ($6::date IS NULL OR ${column} < $6::date + 1)`;
  // See getCrmDashboard()'s identical fix: the active company/branch, when
  // selected, scopes reports for every role — $4 (allowAllCompanies) only
  // matters when no company is actively selected at all.
  const companyVisible = (alias) =>
    `(($2::uuid IS NOT NULL AND (${alias}.company_id IS NULL OR ${alias}.company_id = $2)) OR ($2::uuid IS NULL AND $4::boolean))`;
  const branchVisible = (alias) =>
    `(($3::uuid IS NOT NULL AND (${alias}.branch_id IS NULL OR ${alias}.branch_id = $3)) OR ($3::uuid IS NULL AND $4::boolean))`;
  // Same owner-scoping rule as recordScope()/getCrmDashboard() — reports
  // built from crm_leads/crm_opportunities/crm_activities (the three
  // resources with an ownerField, see Part 2 of docs/implementation/
  // ERP_SECURITY_HARDENING_003.md) must not aggregate rows a restricted
  // caller could not otherwise see individually. Reports built from other
  // tables (campaigns, account plans, pipeline inspections, conversations,
  // buying committees, partner accounts, AI predictions) are unaffected —
  // none of those resources were given per-record ownership scope.
  const ownerVisible = (alias, column) =>
    `($7::boolean OR ${alias}.${column} IS NULL OR ${alias}.${column} = $8)`;
  // Checkpoint audit (Prompt 3 continuation, F025 re-audit explicitly
  // requested by the mega-prompt): the plain ownerVisible() above is
  // binary — either the caller's own records only, or (view-all) every
  // record in scope. There was no middle tier for "a sales manager sees
  // their own team's rollup" anywhere in the codebase; a manager without
  // the broad crm.records.view_all grant could only ever forecast their
  // own deals, not their team's, even though crm_sales_teams/
  // crm_sales_team_members (already used by Tasks' team-queue feature)
  // model exactly that relationship. Scoped to the "forecast" report only
  // — the one place this was explicitly called out — rather than
  // retrofitting every report/dashboard metric with a new visibility tier
  // in the same pass, which would be a much larger, riskier change to
  // the shared ownerVisible() every other report/dashboard metric still
  // uses unchanged.
  const ownerVisibleForForecast = (alias, column) =>
    `($7::boolean OR ${alias}.${column} IS NULL OR ${alias}.${column} = $8 OR ${alias}.${column} IN (
        SELECT member.user_id FROM tenant.crm_sales_team_members member
          JOIN tenant.crm_sales_teams team ON team.id = member.team_id AND team.organization_id = member.organization_id
         WHERE team.organization_id = $1 AND team.manager_user_id = $8 AND member.status = 'active'
           AND member.effective_from <= now() AND (member.effective_to IS NULL OR member.effective_to >= now())
      ))`;
  let sql;
  if (report === "pipeline")
    sql = `SELECT stage.name, stage.sequence, count(opportunity.id)::int AS count, COALESCE(sum(opportunity.amount),0)::numeric AS amount, COALESCE(sum(opportunity.expected_revenue),0)::numeric AS weighted_amount FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id = stage.pipeline_id AND pipeline.organization_id = stage.organization_id LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.stage_id = stage.id AND opportunity.organization_id = stage.organization_id AND opportunity.status='open' ${dateClause("opportunity.created_at")} AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} AND ${ownerVisible("opportunity", "owner_user_id")} WHERE stage.organization_id = $1 AND ${companyVisible("pipeline")} GROUP BY stage.id ORDER BY stage.sequence`;
  else if (report === "conversion")
    sql = `SELECT date_trunc('month', lead.created_at)::date AS period, count(*)::int AS leads, count(*) FILTER (WHERE lead.record_status='converted')::int AS converted, round((count(*) FILTER (WHERE lead.record_status='converted')::numeric / NULLIF(count(*),0))*100,2) AS conversion_rate FROM tenant.crm_leads lead WHERE lead.organization_id=$1 ${dateClause("lead.created_at")} AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")} GROUP BY period ORDER BY period`;
  else if (report === "sources")
    sql = `SELECT COALESCE(source.name,'Unspecified') AS source, count(lead.id)::int AS leads, count(lead.id) FILTER (WHERE lead.record_status='converted')::int AS converted, COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status='won'),0)::numeric AS won_revenue FROM tenant.crm_leads lead LEFT JOIN tenant.crm_lead_sources source ON source.id=lead.source_id LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.lead_id=lead.id AND opportunity.organization_id=lead.organization_id WHERE lead.organization_id=$1 ${dateClause("lead.created_at")} AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead", "owner_user_id")} GROUP BY source.name ORDER BY leads DESC`;
  else if (report === "activities")
    sql = `SELECT activity.activity_type, count(*)::int AS total, count(*) FILTER (WHERE activity.status='completed')::int AS completed, count(*) FILTER (WHERE ${taskOverdueSql("activity")})::int AS overdue FROM tenant.crm_activities activity WHERE activity.organization_id=$1 ${dateClause("activity.created_at")} AND ${companyVisible("activity")} AND ${branchVisible("activity")} AND ${ownerVisible("activity", "assigned_to")} GROUP BY activity.activity_type ORDER BY total DESC`;
  else if (report === "forecast")
    // F025 Stage A2 §11 — added best_case/commit category breakdown
    // columns (the dossier's own named "categories"/"per-category
    // breakdown" item) alongside the existing per-owner pipeline/
    // weighted/won totals, rather than a second query/report key —
    // forecast_category is the same governed field crm_opportunities and
    // crm_forecast_submissions both already use, not a new concept.
    sql = `SELECT opportunity.owner_user_id, COALESCE(user_account.full_name,'Unassigned') AS owner, COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status='open'),0)::numeric AS pipeline, COALESCE(sum(opportunity.expected_revenue) FILTER (WHERE opportunity.status='open'),0)::numeric AS weighted, COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status='won'),0)::numeric AS won, COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status='open' AND opportunity.forecast_category='best_case'),0)::numeric AS best_case, COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status='open' AND opportunity.forecast_category='commit'),0)::numeric AS commit_amount FROM tenant.crm_opportunities opportunity LEFT JOIN public.users user_account ON user_account.id=opportunity.owner_user_id WHERE opportunity.organization_id=$1 ${dateClause("opportunity.created_at")} AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} AND ${ownerVisibleForForecast("opportunity", "owner_user_id")} GROUP BY opportunity.owner_user_id, user_account.full_name ORDER BY weighted DESC`;
  else if (report === "campaigns")
    sql = `SELECT campaign.name, campaign.status, campaign.budget, campaign.actual_cost, count(member.id)::int AS members, count(member.id) FILTER (WHERE member.member_status IN ('responded','attended','converted'))::int AS responses, count(member.id) FILTER (WHERE member.member_status='converted')::int AS conversions FROM tenant.crm_campaigns campaign LEFT JOIN tenant.crm_campaign_members member ON member.campaign_id=campaign.id AND member.organization_id=campaign.organization_id WHERE campaign.organization_id=$1 ${dateClause("campaign.created_at")} AND ${companyVisible("campaign")} GROUP BY campaign.id ORDER BY campaign.created_at DESC`;
  else if (report === "revenue-operations")
    sql = `WITH opportunity_rollup AS (
      SELECT opportunity.owner_user_id,
        COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'open'),0)::numeric AS pipeline,
        COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'open' AND opportunity.forecast_category = 'best_case'),0)::numeric AS best_case,
        COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'open' AND opportunity.forecast_category = 'committed'),0)::numeric AS committed,
        COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'won'),0)::numeric AS won,
        count(*) FILTER (WHERE opportunity.status = 'won')::int AS won_deals,
        count(*) FILTER (WHERE opportunity.status = 'lost')::int AS lost_deals,
        avg(EXTRACT(epoch FROM (COALESCE(opportunity.actual_close_date::timestamptz, now()) - opportunity.created_at)) / 86400.0) FILTER (WHERE opportunity.status IN ('won','lost')) AS average_sales_cycle_days
      FROM tenant.crm_opportunities opportunity
      WHERE opportunity.organization_id = $1 ${dateClause("opportunity.created_at")}
        AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")}
        AND ${ownerVisible("opportunity", "owner_user_id")}
      GROUP BY opportunity.owner_user_id
    ), quota_rollup AS (
      SELECT quota.user_id,
        COALESCE(sum(quota.target_amount),0)::numeric AS quota
      FROM tenant.crm_quota_plans quota
      WHERE quota.organization_id = $1
        AND quota.status IN ('active','closed')
        AND ${companyVisible("quota")}
        AND ($5::date IS NULL OR quota.period_end >= $5::date)
        AND ($6::date IS NULL OR quota.period_start <= $6::date)
        AND ($7::boolean OR quota.user_id IS NULL OR quota.user_id = $8)
      GROUP BY quota.user_id
    )
    SELECT COALESCE(user_account.full_name,'Unassigned') AS owner,
      COALESCE(quota_rollup.quota,0)::numeric AS quota,
      COALESCE(opportunity_rollup.pipeline,0)::numeric AS pipeline,
      COALESCE(opportunity_rollup.best_case,0)::numeric AS best_case,
      COALESCE(opportunity_rollup.committed,0)::numeric AS committed,
      COALESCE(opportunity_rollup.won,0)::numeric AS won,
      CASE WHEN COALESCE(quota_rollup.quota,0) > 0 THEN round(COALESCE(opportunity_rollup.pipeline,0) / quota_rollup.quota, 2) ELSE NULL END AS pipeline_coverage,
      CASE WHEN COALESCE(quota_rollup.quota,0) > 0 THEN round(COALESCE(opportunity_rollup.won,0) / quota_rollup.quota * 100, 2) ELSE NULL END AS quota_attainment_percent,
      CASE WHEN COALESCE(opportunity_rollup.won_deals,0) + COALESCE(opportunity_rollup.lost_deals,0) > 0 THEN round(opportunity_rollup.won_deals::numeric / (opportunity_rollup.won_deals + opportunity_rollup.lost_deals) * 100, 2) ELSE NULL END AS win_rate_percent,
      round(COALESCE(opportunity_rollup.average_sales_cycle_days,0)::numeric, 2) AS average_sales_cycle_days
    FROM opportunity_rollup
    FULL OUTER JOIN quota_rollup
      ON COALESCE(quota_rollup.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(opportunity_rollup.owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LEFT JOIN public.users user_account ON user_account.id = COALESCE(opportunity_rollup.owner_user_id, quota_rollup.user_id)
    ORDER BY won DESC, pipeline DESC`;
  else if (report === "account-health")
    sql = `SELECT party.display_name AS account, plan.account_tier, plan.lifecycle_stage, plan.health_status, plan.health_score, plan.annual_revenue, plan.potential_revenue, plan.renewal_date, plan.next_review_at FROM tenant.crm_account_plans plan JOIN tenant.business_parties party ON party.id = plan.party_id AND party.organization_id = plan.organization_id WHERE plan.organization_id = $1 AND plan.status = 'active' AND ${companyVisible("plan")} ORDER BY CASE plan.health_status WHEN 'critical' THEN 1 WHEN 'at_risk' THEN 2 WHEN 'watch' THEN 3 WHEN 'healthy' THEN 4 ELSE 5 END, plan.next_review_at NULLS LAST`;
  else if (report === "privacy")
    sql = `SELECT request.request_type, request.status, count(*)::int AS requests, count(*) FILTER (WHERE request.due_at < now() AND request.status NOT IN ('completed','rejected','cancelled'))::int AS overdue FROM tenant.crm_privacy_requests request WHERE request.organization_id = $1 ${dateClause("request.created_at")} AND ${companyVisible("request")} GROUP BY request.request_type, request.status ORDER BY request.request_type, request.status`;
  else if (report === "pipeline-intelligence")
    sql = `SELECT inspection.health_status, count(*)::int AS opportunities, round(avg(inspection.health_score),2) AS average_health_score, round(avg(inspection.stage_age_days),2) AS average_stage_age_days, round(avg(inspection.days_since_activity),2) AS average_days_since_activity, count(*) FILTER (WHERE inspection.close_date_slip_days > 0)::int AS slipped_close_dates FROM tenant.crm_pipeline_inspections inspection WHERE inspection.organization_id = $1 ${dateClause("inspection.inspected_at")} AND ${companyVisible("inspection")} GROUP BY inspection.health_status ORDER BY CASE inspection.health_status WHEN 'critical' THEN 1 WHEN 'at_risk' THEN 2 WHEN 'watch' THEN 3 ELSE 4 END`;
  else if (report === "engagement-intelligence")
    sql = `SELECT conversation.channel, count(DISTINCT conversation.id)::int AS conversations, count(insight.id)::int AS insights, count(insight.id) FILTER (WHERE insight.insight_type = 'risk')::int AS risks, count(insight.id) FILTER (WHERE insight.insight_type = 'next_action')::int AS next_actions, count(insight.id) FILTER (WHERE insight.review_status = 'pending')::int AS pending_review FROM tenant.crm_conversations conversation LEFT JOIN tenant.crm_conversation_insights insight ON insight.organization_id = conversation.organization_id AND insight.conversation_id = conversation.id WHERE conversation.organization_id = $1 ${dateClause("conversation.started_at")} AND ${companyVisible("conversation")} GROUP BY conversation.channel ORDER BY conversations DESC`;
  else if (report === "relationship-coverage")
    sql = `SELECT committee.status, count(DISTINCT committee.id)::int AS committees, round(avg(committee.coverage_score),2) AS average_coverage_score, count(member.id)::int AS members, count(member.id) FILTER (WHERE member.member_role = 'economic_buyer')::int AS economic_buyers, count(member.id) FILTER (WHERE member.member_role = 'champion')::int AS champions, count(member.id) FILTER (WHERE member.sentiment IN ('detractor','strong_detractor'))::int AS detractors FROM tenant.crm_buying_committees committee LEFT JOIN tenant.crm_buying_committee_members member ON member.organization_id = committee.organization_id AND member.committee_id = committee.id AND member.status = 'active' WHERE committee.organization_id = $1 ${dateClause("committee.created_at")} AND ${companyVisible("committee")} GROUP BY committee.status ORDER BY committees DESC`;
  else if (report === "partner-pipeline")
    sql = `SELECT partner.partner_type, partner.tier, count(deal.id)::int AS registered_deals, COALESCE(sum(deal.expected_value),0)::numeric AS expected_value, count(deal.id) FILTER (WHERE deal.status = 'won')::int AS won_deals, count(deal.id) FILTER (WHERE deal.status IN ('submitted','approved','active'))::int AS active_deals FROM tenant.crm_partner_accounts partner LEFT JOIN tenant.crm_partner_deals deal ON deal.organization_id = partner.organization_id AND deal.partner_account_id = partner.id ${dateClause("deal.registered_at")} WHERE partner.organization_id = $1 AND partner.status = 'active' AND ${companyVisible("partner")} GROUP BY partner.partner_type, partner.tier ORDER BY expected_value DESC`;
  else if (report === "ai-governance")
    sql = `SELECT prediction.prediction_type, prediction.model_provider, prediction.model_name, count(*)::int AS predictions, round(avg(prediction.score),4) AS average_score, count(feedback.id)::int AS feedback_events, count(feedback.id) FILTER (WHERE feedback.outcome IN ('accepted','correct'))::int AS positive_feedback, count(feedback.id) FILTER (WHERE feedback.outcome IN ('rejected','incorrect','not_actionable'))::int AS negative_feedback FROM tenant.crm_ai_predictions prediction LEFT JOIN tenant.crm_ai_feedback feedback ON feedback.organization_id = prediction.organization_id AND feedback.prediction_id = prediction.id WHERE prediction.organization_id = $1 ${dateClause("prediction.generated_at")} AND ${companyVisible("prediction")} GROUP BY prediction.prediction_type, prediction.model_provider, prediction.model_name ORDER BY predictions DESC`;
  else throw new CrmError(404, "Unknown CRM report.");
  // All 8 elements of `parameters` are bound on every call regardless of
  // report type, but only report branches that call ownerVisible() ($7/$8)
  // reference $7/$8 in their own SQL — Postgres infers the required bind
  // count from the highest $n it finds in the final query text, so a report
  // branch that never touches $7/$8 would deterministically fail with
  // "bind message supplies 8 parameters, but prepared statement "" requires
  // 6" (reproduced live: account-health/privacy/pipeline-intelligence/
  // engagement-intelligence/relationship-coverage/partner-pipeline/
  // ai-governance/campaigns all hit this on every single call against a
  // real database — no fake-DB-client unit test caught it since none
  // enforce real Postgres bind-count validation). Referencing $7/$8 here
  // unconditionally guarantees every report's final query always
  // references all 8 placeholders, matching what's always bound.
  const scopeParametersCte = `crm_scope_parameters AS (
    SELECT $1::uuid AS organization_id,
      $2::uuid AS active_company_id,
      $3::uuid AS active_branch_id,
      $4::boolean AS allow_all_companies,
      $5::date AS date_from,
      $6::date AS date_to,
      $7::boolean AS can_view_all_records,
      $8::uuid AS active_user_id
  )`;
  sql = /^\s*WITH\s+/i.test(sql)
    ? sql.replace(/^\s*WITH\s+/i, `WITH ${scopeParametersCte}, `)
    : `WITH ${scopeParametersCte} ${sql}`;

  const result = await client.query(sql, parameters);
  return { report, rows: result.rows.map(camelizeRow), filters: { from, to } };
}
