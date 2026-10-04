// CRM Home: what needs the caller's attention today. An operational
// workspace, not a BI dashboard: a few counts over the records the caller can
// see, each opening the list behind it, the caller's own work, the open
// pipeline by stage, and the latest activity.
import { leadScopeSql, leadCan } from "../leads/access.js";
import { LEAD_PERMISSIONS, LEAD_STALE_DAYS } from "../leads/constants.js";
import { opportunityCan, opportunityScopeSql } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS, OPPORTUNITY_STALE_DAYS } from "../opportunities/constants.js";
import { getFollowUpSummary } from "../follow-ups/records.js";
import { followUpCan } from "../follow-ups/access.js";
import { FOLLOW_UP_PERMISSIONS } from "../follow-ups/constants.js";
import { getTaskSummary } from "../tasks/records.js";
import { taskCan } from "../tasks/access.js";
import { TASK_PERMISSIONS } from "../tasks/constants.js";

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const CLOSING_SOON_DAYS = 14;

export async function getCrmHome(client, context) {
  const sees = {
    leads: leadCan(context, LEAD_PERMISSIONS.view),
    opportunities: opportunityCan(context, OPPORTUNITY_PERMISSIONS.view),
    tasks: taskCan(context, TASK_PERMISSIONS.view),
    followUps: followUpCan(context, FOLLOW_UP_PERMISSIONS.view),
  };

  let leads = null;
  if (sees.leads) {
    const values = [context.organizationId];
    const scope = leadScopeSql(context, values, "lead");
    leads = (await client.query(
      `SELECT count(*) FILTER (WHERE lead.status = 'open')::int AS open,
              count(*) FILTER (WHERE lead.status = 'open' AND lead.owner_user_id IS NULL)::int AS unassigned,
              count(*) FILTER (WHERE lead.status = 'open' AND lead.owner_user_id IS NOT NULL AND lead.first_activity_at IS NULL)::int AS no_activity
         FROM tenant.crm_leads lead
        WHERE lead.organization_id = $1 AND lead.archived_at IS NULL${scope}`,
      values,
    )).rows[0];
  }

  let opportunities = null;
  let stages = [];
  if (sees.opportunities) {
    const values = [context.organizationId];
    const scope = opportunityScopeSql(context, values, "opportunity");
    const open = `opportunity.organization_id = $1 AND opportunity.status = 'open' AND opportunity.archived_at IS NULL${scope}`;
    opportunities = (await client.query(
      `SELECT count(*)::int AS open, COALESCE(sum(opportunity.amount), 0)::float8 AS value,
              COALESCE(sum(opportunity.amount * opportunity.probability / 100), 0)::float8 AS weighted,
              count(*) FILTER (WHERE COALESCE(opportunity.last_activity_at, opportunity.created_at) < now() - interval '${OPPORTUNITY_STALE_DAYS} days')::int AS stale,
              count(*) FILTER (WHERE opportunity.expected_close_date BETWEEN current_date AND current_date + ${CLOSING_SOON_DAYS})::int AS closing_soon,
              count(*) FILTER (WHERE opportunity.expected_close_date < current_date)::int AS overdue
         FROM tenant.crm_opportunities opportunity WHERE ${open}`,
      values,
    )).rows[0];
    stages = (await client.query(
      `SELECT stage.id, stage.name, stage.sequence, count(opportunity.id)::int AS total, COALESCE(sum(opportunity.amount), 0)::float8 AS value
         FROM tenant.crm_pipeline_stages stage
         JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id = stage.organization_id AND pipeline.id = stage.pipeline_id AND pipeline.status = 'active' AND pipeline.is_default
         LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.stage_id = stage.id AND ${open}
        WHERE stage.organization_id = $1 AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost
        GROUP BY stage.id, stage.name, stage.sequence ORDER BY stage.sequence`,
      values,
    )).rows;
  }

  const tasks = sees.tasks ? await getTaskSummary(client, context) : null;
  const followUps = sees.followUps ? await getFollowUpSummary(client, context) : null;

  // The latest things that happened on leads and opportunities the caller can see.
  const recent = [];
  if (sees.leads) {
    const values = [context.organizationId];
    const scope = leadScopeSql(context, values, "lead");
    recent.push(...(await client.query(
      `SELECT history.id, 'lead' AS record_type, lead.id AS record_id, COALESCE(lead.full_name, lead.company_name, lead.code) AS record_name, history.summary,
              history.created_at, actor.full_name AS actor_name
         FROM tenant.crm_lead_history history
         JOIN tenant.crm_leads lead ON lead.organization_id = history.organization_id AND lead.id = history.lead_id
         LEFT JOIN public.users actor ON actor.id = history.actor_user_id
        WHERE history.organization_id = $1 AND history.created_at >= now() - interval '30 days'${scope}
        ORDER BY history.created_at DESC LIMIT 10`,
      values,
    )).rows);
  }
  if (sees.opportunities) {
    const values = [context.organizationId];
    const scope = opportunityScopeSql(context, values, "opportunity");
    recent.push(...(await client.query(
      `SELECT history.id, 'opportunity' AS record_type, opportunity.id AS record_id, opportunity.name AS record_name, history.summary,
              history.created_at, actor.full_name AS actor_name
         FROM tenant.crm_opportunity_history history
         JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = history.organization_id AND opportunity.id = history.opportunity_id
         LEFT JOIN public.users actor ON actor.id = history.actor_user_id
        WHERE history.organization_id = $1 AND history.created_at >= now() - interval '30 days'${scope}
        ORDER BY history.created_at DESC LIMIT 10`,
      values,
    )).rows);
  }
  recent.sort((left, right) => new Date(right.created_at) - new Date(left.created_at));

  const currency = (await client.query(`SELECT code FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code LIMIT 1`, [context.organizationId])).rows[0];

  return {
    sees,
    baseCurrency: String(currency?.code ?? "INR").trim(),
    totals: {
      openLeads: leads?.open ?? null,
      openOpportunities: opportunities?.open ?? null,
      pipelineValue: opportunities ? money(opportunities.value) : null,
      weightedPipelineValue: opportunities ? money(opportunities.weighted) : null,
      overdueFollowUps: followUps?.overdue ?? null,
    },
    myWork: {
      tasksDueToday: tasks?.dueToday ?? null,
      overdueTasks: tasks?.overdue ?? null,
      followUpsToday: followUps?.dueToday ?? null,
      overdueFollowUps: followUps?.overdue ?? null,
    },
    pipeline: stages.map((row) => ({ stageId: row.id, name: row.name, total: row.total, value: money(row.value) })),
    needsAttention: {
      unassignedLeads: leads?.unassigned ?? null,
      leadsWithNoActivity: leads?.no_activity ?? null,
      staleOpportunities: opportunities?.stale ?? null,
      opportunitiesClosingSoon: opportunities?.closing_soon ?? null,
      overdueOpportunities: opportunities?.overdue ?? null,
      leadStaleDays: LEAD_STALE_DAYS,
      opportunityStaleDays: OPPORTUNITY_STALE_DAYS,
      closingSoonDays: CLOSING_SOON_DAYS,
    },
    recentActivity: recent.slice(0, 10).map((row) => ({
      id: row.id, recordType: row.record_type, recordId: row.record_id, recordName: row.record_name, summary: row.summary,
      at: row.created_at, actorName: row.actor_name ?? null,
    })),
  };
}
