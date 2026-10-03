// The lead dashboard and the "CRM Leads by Status" report. Both count only
// the leads the caller can see, using the same scope as the lead list, so a
// figure and the list behind it always agree.
import { leadScopeSql, requireLeadPermission } from "./access.js";
import { LEAD_DISQUALIFICATION_REASONS, LEAD_PERMISSIONS, LEAD_QUALIFICATION_STATUSES, LEAD_STAGES, LEAD_STATUSES } from "./constants.js";
import { QUALIFICATION_STATUS_SQL } from "./records.js";
import { isUuid } from "./validation.js";

const PENDING_FOLLOW_UP = `SELECT min(activity.due_at) AS due_at FROM tenant.crm_activities activity
   WHERE activity.organization_id = lead.organization_id AND activity.entity_type = 'lead' AND activity.entity_id = lead.id
     AND activity.activity_type = 'follow_up' AND activity.status IN ('planned', 'in_progress', 'overdue')`;

function periodBounds(input = {}) {
  const today = new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(input.from ?? "")) ? input.from : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(input.to ?? "")) ? input.to : today.toISOString().slice(0, 10);
  return { from, to };
}

export async function getLeadDashboard(client, context, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const { from, to } = periodBounds(input);
  const values = [context.organizationId, from, to];
  const scope = leadScopeSql(context, values, "lead");
  const visible = `FROM tenant.crm_leads lead LEFT JOIN LATERAL (${PENDING_FOLLOW_UP}) follow_up ON true
     LEFT JOIN tenant.crm_lead_qualifications qualification ON qualification.organization_id = lead.organization_id AND qualification.lead_id = lead.id
     WHERE lead.organization_id = $1 AND lead.archived_at IS NULL${scope}`;

  const totals = (await client.query(
    `SELECT count(*) FILTER (WHERE lead.status = 'open')::int AS open,
            count(*) FILTER (WHERE lead.status = 'open' AND lead.stage = 'new')::int AS new,
            count(*) FILTER (WHERE lead.status = 'open' AND lead.owner_user_id IS NULL)::int AS unassigned,
            count(*) FILTER (WHERE lead.assigned_at >= current_date)::int AS assigned_today,
            count(*) FILTER (WHERE lead.status = 'open' AND lead.owner_user_id IS NOT NULL AND lead.first_activity_at IS NULL)::int AS no_activity,
            count(*) FILTER (WHERE lead.created_at >= $2::date AND lead.created_at < $3::date + interval '1 day')::int AS created_in_period,
            count(*) FILTER (WHERE follow_up.due_at >= current_date AND follow_up.due_at < current_date + interval '1 day')::int AS follow_ups_due_today,
            count(*) FILTER (WHERE follow_up.due_at < now())::int AS overdue_follow_ups,
            count(*) FILTER (WHERE lead.status = 'qualified')::int AS qualified,
            count(*) FILTER (WHERE ${QUALIFICATION_STATUS_SQL.not_started})::int AS awaiting_qualification,
            count(*) FILTER (WHERE ${QUALIFICATION_STATUS_SQL.in_progress})::int AS in_qualification,
            count(*) FILTER (WHERE lead.status IN ('qualified', 'converted'))::int AS qualified_total,
            -- from the day the lead arrived to the day it was qualified
            round((avg(EXTRACT(epoch FROM lead.qualified_at - lead.created_at)) FILTER (WHERE lead.qualified_at IS NOT NULL) / 86400)::numeric, 1)::float8 AS avg_days_to_qualify,
            count(*) FILTER (WHERE lead.status = 'disqualified')::int AS disqualified,
            count(*) FILTER (WHERE lead.status = 'converted')::int AS converted
       ${visible}`,
    values,
  )).rows[0];

  const grouped = async (expression, joins = "") => (await client.query(
    `SELECT ${expression} AS key, count(*)::int AS total
       FROM tenant.crm_leads lead ${joins}
      WHERE lead.organization_id = $1 AND lead.archived_at IS NULL AND $2::date IS NOT NULL AND $3::date IS NOT NULL${scope}
      GROUP BY 1 ORDER BY total DESC, 1`,
    values,
  )).rows;

  const byStatus = await grouped("lead.status");
  const byStage = await grouped("lead.stage");
  const bySource = await grouped("COALESCE(source.name, 'No source')", "LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = lead.organization_id AND source.id = lead.source_id");
  const byOwner = await grouped("COALESCE(owner.full_name, 'Unassigned')", "LEFT JOIN public.users owner ON owner.id = lead.owner_user_id");
  const qualifiedBy = async (expression, joins) => (await client.query(
    `SELECT ${expression} AS key, count(*)::int AS total
       FROM tenant.crm_leads lead ${joins}
      WHERE lead.organization_id = $1 AND lead.archived_at IS NULL AND lead.status IN ('qualified', 'converted') AND $2::date IS NOT NULL AND $3::date IS NOT NULL${scope}
      GROUP BY 1 ORDER BY total DESC, 1 LIMIT 15`,
    values,
  )).rows.map((row) => ({ label: row.key, total: row.total }));
  const qualifiedByOwner = await qualifiedBy("COALESCE(owner.full_name, 'Unassigned')", "LEFT JOIN public.users owner ON owner.id = lead.owner_user_id");
  const qualifiedBySource = await qualifiedBy("COALESCE(source.name, 'No source')", "LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = lead.organization_id AND source.id = lead.source_id");
  const decided = totals.qualified_total + totals.disqualified;
  const byTeam = await grouped("COALESCE(team.name, 'No team')", "LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = lead.organization_id AND team.id = lead.team_id");
  // Leads still being worked, per salesperson, with what is slipping.
  const workload = (await client.query(
    `SELECT COALESCE(owner.full_name, 'Unassigned') AS name, lead.owner_user_id,
            count(*)::int AS open_leads,
            count(*) FILTER (WHERE follow_up.due_at < now())::int AS overdue_follow_ups,
            count(*) FILTER (WHERE lead.owner_user_id IS NOT NULL AND lead.first_activity_at IS NULL)::int AS no_activity
       FROM tenant.crm_leads lead
       LEFT JOIN public.users owner ON owner.id = lead.owner_user_id
       LEFT JOIN LATERAL (${PENDING_FOLLOW_UP}) follow_up ON true
      WHERE lead.organization_id = $1 AND lead.archived_at IS NULL AND lead.status IN ('open', 'qualified') AND $2::date IS NOT NULL AND $3::date IS NOT NULL${scope}
      GROUP BY 1, 2 ORDER BY open_leads DESC, 1 LIMIT 25`,
    values,
  )).rows;
  const count = (rows, key) => rows.find((row) => row.key === key)?.total ?? 0;

  return {
    period: { from, to },
    totals: {
      open: totals.open,
      new: totals.new,
      unassigned: totals.unassigned,
      assignedToday: totals.assigned_today,
      noActivity: totals.no_activity,
      createdInPeriod: totals.created_in_period,
      followUpsDueToday: totals.follow_ups_due_today,
      overdueFollowUps: totals.overdue_follow_ups,
      qualified: totals.qualified,
      disqualified: totals.disqualified,
      awaitingQualification: totals.awaiting_qualification,
      inQualification: totals.in_qualification,
      qualifiedTotal: totals.qualified_total,
      // qualified ÷ (qualified + disqualified), as a percentage
      qualificationRate: decided ? Math.round((totals.qualified_total / decided) * 1000) / 10 : 0,
      averageDaysToQualify: totals.avg_days_to_qualify ?? null,
      converted: totals.converted,
    },
    byStatus: LEAD_STATUSES.map((status) => ({ key: status.code, label: status.label, total: count(byStatus, status.code) })),
    byStage: LEAD_STAGES.map((stage) => ({ key: stage.code, label: stage.label, total: count(byStage, stage.code) })),
    bySource: bySource.map((row) => ({ label: row.key, total: row.total })),
    byOwner: byOwner.slice(0, 15).map((row) => ({ label: row.key, total: row.total })),
    qualifiedByOwner,
    qualifiedBySource,
    byTeam: byTeam.slice(0, 15).map((row) => ({ label: row.key, total: row.total })),
    workload: workload.map((row) => ({ userId: row.owner_user_id, name: row.name, openLeads: row.open_leads, overdueFollowUps: row.overdue_follow_ups, noActivity: row.no_activity })),
  };
}

const REPORT_GROUPS = Object.freeze({
  status: { expression: "lead.status", label: "Status" },
  stage: { expression: "lead.stage", label: "Stage" },
  owner: { expression: "COALESCE(owner.full_name, 'Unassigned')", label: "Owner" },
  team: { expression: "COALESCE(team.name, 'No team')", label: "Team" },
  qualification: {
    expression: `CASE WHEN ${QUALIFICATION_STATUS_SQL.disqualified} THEN 'disqualified' WHEN ${QUALIFICATION_STATUS_SQL.qualified} THEN 'qualified' WHEN ${QUALIFICATION_STATUS_SQL.in_progress} THEN 'in_progress' ELSE 'not_started' END`,
    label: "Qualification",
  },
  disqualificationReason: { expression: "COALESCE(lead.disqualification_reason, 'not_disqualified')", label: "Disqualification reason" },
  source: { expression: "COALESCE(source.name, 'No source')", label: "Source" },
  assignedMonth: { expression: "COALESCE(to_char(date_trunc('month', lead.assigned_at), 'YYYY-MM'), 'Not assigned')", label: "Assigned month" },
  month: { expression: "to_char(date_trunc('month', lead.created_at), 'YYYY-MM')", label: "Created month" },
});

// CRM Leads by Status. Group by status, stage, owner, team, source, created
// month or assigned month; filter by owner, team, source, created date,
// assignment date, status, stage and whether the lead was converted.
export async function getLeadsByStatusReport(client, context, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const groupBy = REPORT_GROUPS[input.groupBy] ? input.groupBy : "status";
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["lead.organization_id = $1", "lead.archived_at IS NULL"];
  if (isUuid(input.ownerId)) where.push(`lead.owner_user_id = ${bind(input.ownerId)}`);
  if (input.ownerId === "unassigned") where.push("lead.owner_user_id IS NULL");
  if (isUuid(input.sourceId)) where.push(`lead.source_id = ${bind(input.sourceId)}`);
  if (QUALIFICATION_STATUS_SQL[input.qualificationStatus]) where.push(QUALIFICATION_STATUS_SQL[input.qualificationStatus]);
  if (LEAD_DISQUALIFICATION_REASONS.some((reason) => reason.code === input.disqualificationReason)) where.push(`lead.disqualification_reason = ${bind(input.disqualificationReason)}`);
  if (String(input.productInterest ?? "").trim())
    where.push(`lower(COALESCE(lead.product_interest, '')) LIKE ${bind(`%${String(input.productInterest).trim().toLowerCase().replace(/[\\%_]/g, "\\  if (isUuid(input.teamId)) where.push(")}%`)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.qualifiedFrom ?? ""))) where.push(`lead.qualified_at >= ${bind(input.qualifiedFrom)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.qualifiedTo ?? ""))) where.push(`lead.qualified_at < ${bind(input.qualifiedTo)}::date + interval '1 day'`);
  if (isUuid(input.teamId)) where.push(`lead.team_id = ${bind(input.teamId)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.assignedFrom ?? ""))) where.push(`lead.assigned_at >= ${bind(input.assignedFrom)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.assignedTo ?? ""))) where.push(`lead.assigned_at < ${bind(input.assignedTo)}::date + interval '1 day'`);
  if (LEAD_STATUSES.some((status) => status.code === input.status)) where.push(`lead.status = ${bind(input.status)}`);
  if (LEAD_STAGES.some((stage) => stage.code === input.stage)) where.push(`lead.stage = ${bind(input.stage)}`);
  if (input.converted === "yes") where.push("lead.status = 'converted'");
  if (input.converted === "no") where.push("lead.status <> 'converted'");
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.createdFrom ?? ""))) where.push(`lead.created_at >= ${bind(input.createdFrom)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.createdTo ?? ""))) where.push(`lead.created_at < ${bind(input.createdTo)}::date + interval '1 day'`);

  const { rows } = await client.query(
    `SELECT ${REPORT_GROUPS[groupBy].expression} AS group_key,
            count(*)::int AS total,
            count(*) FILTER (WHERE lead.status = 'open')::int AS open,
            count(*) FILTER (WHERE lead.status = 'qualified')::int AS qualified,
            count(*) FILTER (WHERE lead.status = 'disqualified')::int AS disqualified,
            count(*) FILTER (WHERE lead.status = 'converted')::int AS converted,
            COALESCE(sum(lead.estimated_value), 0)::float8 AS estimated_value
       FROM tenant.crm_leads lead
       LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = lead.organization_id AND source.id = lead.source_id
       LEFT JOIN public.users owner ON owner.id = lead.owner_user_id
       LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = lead.organization_id AND team.id = lead.team_id
       LEFT JOIN tenant.crm_lead_qualifications qualification ON qualification.organization_id = lead.organization_id AND qualification.lead_id = lead.id
      WHERE ${where.join(" AND ")}${leadScopeSql(context, values, "lead")}
      GROUP BY 1 ORDER BY ${groupBy === "month" || groupBy === "assignedMonth" ? "1 DESC" : "total DESC, 1"}`,
    values,
  );
  const labels = new Map([
    ...LEAD_STATUSES, ...LEAD_STAGES, ...LEAD_QUALIFICATION_STATUSES, ...LEAD_DISQUALIFICATION_REASONS, { code: "not_disqualified", label: "Not disqualified" },
  ].map((entry) => [entry.code, entry.label]));
  const reportRows = rows.map((row) => ({
    group: ["status", "stage", "qualification", "disqualificationReason"].includes(groupBy) ? labels.get(row.group_key) ?? row.group_key : row.group_key,
    total: row.total,
    open: row.open,
    qualified: row.qualified,
    disqualified: row.disqualified,
    converted: row.converted,
    conversionRate: row.total ? Math.round((row.converted / row.total) * 1000) / 10 : 0,
    estimatedValue: row.estimated_value,
  }));
  return {
    groupBy,
    groupLabel: REPORT_GROUPS[groupBy].label,
    rows: reportRows,
    totals: reportRows.reduce((sum, row) => ({
      total: sum.total + row.total, open: sum.open + row.open, qualified: sum.qualified + row.qualified,
      disqualified: sum.disqualified + row.disqualified, converted: sum.converted + row.converted, estimatedValue: sum.estimatedValue + row.estimatedValue,
    }), { total: 0, open: 0, qualified: 0, disqualified: 0, converted: 0, estimatedValue: 0 }),
  };
}
