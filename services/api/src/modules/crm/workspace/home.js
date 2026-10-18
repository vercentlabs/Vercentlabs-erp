// CRM Home: what needs the caller's attention today. An operational
// workspace, not a BI dashboard: a few counts over the records the caller can
// see, each opening the list behind it, the caller's own work, the open
// pipeline by stage, and the latest activity.
import { currencyDisclosure, dealRate, reportingCurrencyOf } from "../data-management/reporting-currency.js";
import { leadScopeSql, leadCan } from "../leads/access.js";
import { LEAD_PERMISSIONS, LEAD_STALE_DAYS } from "../leads/constants.js";
import { opportunityCan, opportunityScopeSql } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS, OPPORTUNITY_STALE_DAYS } from "../opportunities/constants.js";
import { getFollowUpSummary, listFollowUps } from "../follow-ups/records.js";
import { followUpCan } from "../follow-ups/access.js";
import { FOLLOW_UP_PERMISSIONS } from "../follow-ups/constants.js";
import { getTaskSummary, listTasks } from "../tasks/records.js";
import { taskCan } from "../tasks/access.js";
import { TASK_PERMISSIONS } from "../tasks/constants.js";
import { orgMonthStart, orgMonthStartAt, orgToday } from "../data-management/org-date.js";

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const CLOSING_SOON_DAYS = 14;
const WIN_RATE_DAYS = 90;
// This month and today as the organization sees them (dates for close dates, the instant for timestamps).
const MONTH = orgMonthStart("$1");
const MONTH_AT = orgMonthStartAt("$1");
const TODAY = orgToday("$1");

// Today's agenda: the caller's own overdue and due-today tasks and follow-ups, earliest first.
async function agendaOf(client, context, sees) {
  const items = new Map();
  const add = (entry) => { if (!items.has(entry.kind + entry.id)) items.set(entry.kind + entry.id, entry); };
  for (const view of ["overdue", "due_today"]) {
    if (sees.tasks)
      for (const task of (await listTasks(client, context, { view, limit: 8, sortBy: "dueAt" })).tasks)
        add({ kind: "task", id: task.id, title: task.title, relatedName: task.relatedName, relatedHref: task.relatedHref, dueAt: task.dueAt, dueTime: task.dueTime,
          isOverdue: task.isOverdue, priority: task.priority, type: null });
    if (sees.followUps)
      for (const followUp of (await listFollowUps(client, context, { view, limit: 8, sortBy: "scheduledAt" })).followUps)
        add({ kind: "follow_up", id: followUp.id, title: followUp.subject, relatedName: followUp.relatedName ?? followUp.contactName, relatedHref: followUp.relatedHref,
          dueAt: followUp.scheduledAt, dueTime: followUp.scheduledTime, isOverdue: followUp.isOverdue, priority: null, type: followUp.type });
  }
  return [...items.values()].sort((left, right) => new Date(left.dueAt) - new Date(right.dueAt));
}

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
              count(*) FILTER (WHERE lead.status = 'open' AND lead.owner_user_id IS NOT NULL AND lead.first_activity_at IS NULL)::int AS no_activity,
              count(*) FILTER (WHERE lead.created_at >= ${MONTH_AT})::int AS new_this_month,
              count(*) FILTER (WHERE lead.qualified_at >= ${MONTH_AT})::int AS qualified_this_month,
              count(*) FILTER (WHERE lead.converted_at >= ${MONTH_AT})::int AS converted_this_month
         FROM tenant.crm_leads lead
        WHERE lead.organization_id = $1 AND lead.archived_at IS NULL${scope}`,
      values,
    )).rows[0];
  }

  let opportunities = null;
  let stages = [];
  let outcomes = null;
  let closingSoon = [];
  if (sees.opportunities) {
    const values = [context.organizationId];
    const scope = opportunityScopeSql(context, values, "opportunity");
    const open = `opportunity.organization_id = $1 AND opportunity.status = 'open' AND opportunity.archived_at IS NULL${scope}`;
    opportunities = (await client.query(
      `SELECT count(*)::int AS open, COALESCE(sum(opportunity.amount * ${dealRate("opportunity")}), 0)::float8 AS value,
              COALESCE(sum(opportunity.amount * opportunity.probability / 100 * ${dealRate("opportunity")}), 0)::float8 AS weighted,
              count(*) FILTER (WHERE ${dealRate("opportunity")} IS NULL)::int AS unconverted_count,
              COALESCE(array_agg(DISTINCT opportunity.currency_code) FILTER (WHERE ${dealRate("opportunity")} IS NULL), '{}') AS unconverted_currencies,
              count(*) FILTER (WHERE COALESCE(opportunity.last_activity_at, opportunity.created_at) < now() - interval '${OPPORTUNITY_STALE_DAYS} days')::int AS stale,
              count(*) FILTER (WHERE opportunity.expected_close_date BETWEEN ${TODAY} AND ${TODAY} + ${CLOSING_SOON_DAYS})::int AS closing_soon,
              count(*) FILTER (WHERE opportunity.expected_close_date < ${TODAY})::int AS overdue
         FROM tenant.crm_opportunities opportunity WHERE ${open}`,
      values,
    )).rows[0];
    stages = (await client.query(
      `SELECT stage.id, stage.name, stage.sequence, count(opportunity.id)::int AS total, COALESCE(sum(opportunity.amount * ${dealRate("opportunity")}), 0)::float8 AS value
         FROM tenant.crm_pipeline_stages stage
         JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id = stage.organization_id AND pipeline.id = stage.pipeline_id AND pipeline.status = 'active' AND pipeline.is_default
         LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.stage_id = stage.id AND ${open}
        WHERE stage.organization_id = $1 AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost
        GROUP BY stage.id, stage.name, stage.sequence ORDER BY stage.sequence`,
      values,
    )).rows;
    // Won this month, and the win rate over deals closed in the last 90 days.
    const closed = `opportunity.organization_id = $1 AND opportunity.archived_at IS NULL${scope}`;
    outcomes = (await client.query(
      `SELECT count(*) FILTER (WHERE opportunity.status = 'won' AND opportunity.actual_close_date >= ${MONTH})::int AS won_this_month,
              COALESCE(sum(COALESCE(opportunity.won_amount, opportunity.amount) * ${dealRate("opportunity")}) FILTER (WHERE opportunity.status = 'won' AND opportunity.actual_close_date >= ${MONTH}), 0)::float8 AS won_value_this_month,
              count(*) FILTER (WHERE opportunity.status = 'won' AND opportunity.actual_close_date >= ${TODAY} - ${WIN_RATE_DAYS})::int AS won_recent,
              count(*) FILTER (WHERE opportunity.status = 'lost' AND opportunity.actual_close_date >= ${TODAY} - ${WIN_RATE_DAYS})::int AS lost_recent
         FROM tenant.crm_opportunities opportunity WHERE ${closed}`,
      values,
    )).rows[0];
    // The open deals due to close soonest (or already past their date).
    closingSoon = (await client.query(
      `SELECT opportunity.id, opportunity.code, opportunity.name, opportunity.amount::float8 AS amount, opportunity.currency_code, opportunity.probability::float8 AS probability,
              to_char(opportunity.expected_close_date, 'YYYY-MM-DD') AS expected_close_date, opportunity.expected_close_date < ${TODAY} AS overdue,
              stage.name AS stage_name, account.display_name AS account_name, owner.full_name AS owner_name
         FROM tenant.crm_opportunities opportunity
         LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = opportunity.organization_id AND stage.id = opportunity.stage_id
         LEFT JOIN tenant.business_parties account ON account.organization_id = opportunity.organization_id AND account.id = opportunity.party_id
         LEFT JOIN public.users owner ON owner.id = opportunity.owner_user_id
        WHERE ${open} AND opportunity.expected_close_date <= ${TODAY} + ${CLOSING_SOON_DAYS}
        ORDER BY opportunity.expected_close_date, opportunity.amount DESC NULLS LAST LIMIT 5`,
      values,
    )).rows;
  }

  const tasks = sees.tasks ? await getTaskSummary(client, context) : null;
  const followUps = sees.followUps ? await getFollowUpSummary(client, context) : null;
  const agenda = sees.tasks || sees.followUps ? await agendaOf(client, context, sees) : [];

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

  // Totals are in the organization's base currency (the one deals are converted into).
  const reportingCurrency = await reportingCurrencyOf(client, context.organizationId);

  return {
    sees,
    baseCurrency: String(reportingCurrency ?? "INR").trim(),
    currency: opportunities ? currencyDisclosure(reportingCurrency, opportunities) : null,
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
    leadFlow: leads ? { newThisMonth: leads.new_this_month, qualifiedThisMonth: leads.qualified_this_month, convertedThisMonth: leads.converted_this_month } : null,
    outcomes: outcomes ? {
      wonThisMonth: outcomes.won_this_month,
      wonValueThisMonth: money(outcomes.won_value_this_month),
      winRate: outcomes.won_recent + outcomes.lost_recent ? Math.round((outcomes.won_recent / (outcomes.won_recent + outcomes.lost_recent)) * 100) : null,
      winRateDays: WIN_RATE_DAYS,
    } : null,
    closingSoon: closingSoon.map((row) => ({
      id: row.id, code: row.code, name: row.name, amount: row.amount === null ? null : money(row.amount), currencyCode: row.currency_code ? String(row.currency_code).trim() : null, probability: row.probability,
      expectedCloseDate: row.expected_close_date, overdue: row.overdue, stageName: row.stage_name ?? null, accountName: row.account_name ?? null, ownerName: row.owner_name ?? null,
    })),
    agenda: agenda.slice(0, 8),
    agendaTotal: agenda.length,
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
