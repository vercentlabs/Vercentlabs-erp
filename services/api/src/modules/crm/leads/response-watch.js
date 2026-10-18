// Response times and escalation (CRM plan 3.5), run by the worker for each organization on every tick:
//
//   first response   a new lead nobody has answered — no call, email, meeting or message logged by us, no stage moved — within the
//                    first-response time: its owner is told, once;
//   escalation       still untouched after the escalation time: the owner's manager is told, once;
//   overdue work     a task or follow-up still overdue that long past its due time: the assignee's manager is told, once; and every
//                    overdue follow-up tells its assignee once (tasks already do);
//   re-run           every so often, unassigned open leads go through the assignment rules again (capacity and pauses respected).
//
// "Our response" excludes what the customer did (an inbound email, a repeat enquiry: crm_activities.is_inbound). The manager is the
// manager of the lead's team, else of a team the person belongs to, else the organization's creator. Each notice is stamped in the same
// statement that claims its row (FOR UPDATE SKIP LOCKED), so a re-run or an overlapping tick never notifies twice.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { applyLeadAssignment } from "./assignment.js";
import { evaluateLeadAssignment, getLeadAssignmentSettings } from "./assignment-rules.js";
import { LEAD_PERMISSIONS } from "./constants.js";

const BATCH = 200;
const leadName = (row) => [row.first_name, row.last_name].filter(Boolean).join(" ") || row.company_name || row.code;

// Leads still waiting for our first response. `$1` organization, `$2` hours.
const UNTOUCHED = `lead.organization_id = $1 AND lead.status IN ('open', 'qualified') AND lead.archived_at IS NULL AND lead.converted_at IS NULL
  AND lead.owner_user_id IS NOT NULL AND COALESCE(lead.assigned_at, lead.created_at) <= now() - make_interval(hours => $2)
  AND COALESCE(lead.stage_changed_at, lead.created_at) <= lead.created_at + interval '1 minute'
  AND NOT EXISTS (SELECT 1 FROM tenant.crm_activities done WHERE done.organization_id = lead.organization_id AND done.entity_type = 'lead' AND done.entity_id = lead.id
                   AND done.status = 'completed' AND NOT done.is_inbound AND done.activity_type IN ('call', 'email', 'meeting', 'whatsapp', 'sms', 'follow_up', 'other'))
  AND NOT EXISTS (SELECT 1 FROM tenant.crm_email_messages sent WHERE sent.organization_id = lead.organization_id AND sent.entity_type = 'lead' AND sent.entity_id = lead.id
                   AND sent.direction = 'outbound')`;

// The manager of `userExpr` (and the record's own team `teamExpr`, when it has one).
export const MANAGER = (teamExpr, userExpr) => `COALESCE(
  (SELECT team.manager_user_id FROM tenant.crm_sales_teams team WHERE team.organization_id = $1 AND team.id = ${teamExpr} AND team.status = 'active'
     AND team.manager_user_id IS DISTINCT FROM ${userExpr}),
  (SELECT team.manager_user_id FROM tenant.crm_sales_team_members member JOIN tenant.crm_sales_teams team ON team.organization_id = member.organization_id AND team.id = member.team_id
    WHERE member.organization_id = $1 AND member.user_id = ${userExpr} AND member.status = 'active' AND team.status = 'active'
      AND team.manager_user_id IS NOT NULL AND team.manager_user_id <> ${userExpr} ORDER BY team.created_at LIMIT 1),
  (SELECT organization.created_by FROM public.organizations organization WHERE organization.id = $1 AND organization.created_by IS DISTINCT FROM ${userExpr}))`;

const hoursText = (hours) => (hours % 24 === 0 ? `${hours / 24} ${hours === 24 ? "day" : "days"}` : `${hours} ${hours === 1 ? "hour" : "hours"}`);

async function firstResponseAlerts(client, organizationId, hours) {
  const { rows } = await client.query(
    `UPDATE tenant.crm_leads SET response_alerted_at = now()
      WHERE id IN (SELECT lead.id FROM tenant.crm_leads lead WHERE ${UNTOUCHED} AND lead.response_alerted_at IS NULL ORDER BY lead.created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING id, code, first_name, last_name, company_name, owner_user_id`, [organizationId, hours]);
  for (const lead of rows)
    await createNotification(client, {
      organizationId, userId: lead.owner_user_id, category: "crm_lead_response_due", title: `${leadName(lead)} is waiting for you`,
      message: `${lead.code} has had no call, email or meeting for ${hoursText(hours)}. A quick first contact keeps the lead warm.`,
      href: `/crm/leads/${lead.id}`, entityType: "crm.lead", entityId: lead.id,
    });
  return rows.length;
}

async function responseEscalations(client, organizationId, hours) {
  const { rows } = await client.query(
    `WITH claimed AS (
       UPDATE tenant.crm_leads SET response_escalated_at = now()
        WHERE id IN (SELECT lead.id FROM tenant.crm_leads lead WHERE ${UNTOUCHED} AND lead.response_escalated_at IS NULL ORDER BY lead.created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, code, first_name, last_name, company_name, owner_user_id, team_id)
     SELECT claimed.*, owner.full_name AS owner_name, ${MANAGER("claimed.team_id", "claimed.owner_user_id")} AS manager_id
       FROM claimed LEFT JOIN users owner ON owner.id = claimed.owner_user_id`, [organizationId, hours]);
  for (const lead of rows) {
    if (!lead.manager_id) continue;
    await createNotification(client, {
      organizationId, userId: lead.manager_id, category: "crm_lead_response_escalation", title: `Untouched lead: ${leadName(lead)}`,
      message: `${lead.code}, owned by ${lead.owner_name ?? "a team member"}, has had no first contact for ${hoursText(hours)}.`,
      href: `/crm/leads/${lead.id}`, entityType: "crm.lead", entityId: lead.id,
    });
  }
  return rows.length;
}

// Overdue follow-ups tell their assignee once (overdue tasks already do, in crm.tasks.notify_overdue).
async function followUpOverdueNotices(client, organizationId) {
  const { rows } = await client.query(
    `UPDATE tenant.crm_activities SET overdue_notified_at = now()
      WHERE id IN (SELECT id FROM tenant.crm_activities WHERE organization_id = $1 AND activity_type = 'follow_up' AND status IN ('planned', 'in_progress', 'overdue')
                     AND due_at < now() AND overdue_notified_at IS NULL AND assigned_to IS NOT NULL ORDER BY due_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING id, subject, follow_up_number, assigned_to`, [organizationId]);
  for (const item of rows)
    await createNotification(client, {
      organizationId, userId: item.assigned_to, category: "crm_follow_up_overdue", title: "Follow-up overdue",
      message: `${item.follow_up_number ? `${item.follow_up_number} · ` : ""}${item.subject} is past its time.`,
      href: `/crm/follow-ups/${item.id}`, entityType: "crm_activity", entityId: item.id,
    });
  return rows.length;
}

async function overdueEscalations(client, organizationId, hours) {
  const { rows } = await client.query(
    `WITH claimed AS (
       UPDATE tenant.crm_activities SET overdue_escalated_at = now()
        WHERE id IN (SELECT id FROM tenant.crm_activities WHERE organization_id = $1 AND activity_type IN ('task', 'follow_up') AND status IN ('planned', 'in_progress', 'overdue')
                       AND due_at < now() - make_interval(hours => $2) AND overdue_escalated_at IS NULL AND assigned_to IS NOT NULL ORDER BY due_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, activity_type, subject, task_number, follow_up_number, assigned_to, team_id)
     SELECT claimed.*, assignee.full_name AS assignee_name, ${MANAGER("claimed.team_id", "claimed.assigned_to")} AS manager_id
       FROM claimed LEFT JOIN users assignee ON assignee.id = claimed.assigned_to`, [organizationId, hours]);
  for (const item of rows) {
    if (!item.manager_id) continue;
    const task = item.activity_type === "task";
    await createNotification(client, {
      organizationId, userId: item.manager_id, category: task ? "crm_task_escalation" : "crm_follow_up_escalation",
      title: `${task ? "Task" : "Follow-up"} overdue: ${item.assignee_name ?? "a team member"}`,
      message: `${(task ? item.task_number : item.follow_up_number) ? `${task ? item.task_number : item.follow_up_number} · ` : ""}${item.subject} is still not done, ${hoursText(hours)} after it was due.`,
      href: task ? `/crm/tasks/${item.id}` : `/crm/follow-ups/${item.id}`, entityType: "crm_activity", entityId: item.id,
    });
  }
  return rows.length;
}

// Unassigned open leads through the rules again, at most every `hours`.
async function rerunUnassigned(client, organizationId, hours) {
  const due = (await client.query(
    `UPDATE tenant.crm_lead_assignment_settings SET last_rerun_at = now()
      WHERE organization_id = $1 AND (last_rerun_at IS NULL OR last_rerun_at <= now() - make_interval(hours => $2)) RETURNING organization_id`, [organizationId, hours])).rows[0];
  if (!due) return { routed: 0, checked: 0 };
  const actor = (await client.query("SELECT created_by FROM public.organizations WHERE id = $1", [organizationId])).rows[0]?.created_by ?? null;
  const context = {
    organizationId, userId: actor, roleSlugs: [],
    permissions: [LEAD_PERMISSIONS.view, LEAD_PERMISSIONS.viewAll, LEAD_PERMISSIONS.assign, LEAD_PERMISSIONS.reassign, "crm.records.view_all"],
  };
  const { toLead } = await import("./records.js");
  const { rows } = await client.query(
    `SELECT lead.* FROM tenant.crm_leads lead
      WHERE lead.organization_id = $1 AND lead.owner_user_id IS NULL AND lead.status IN ('open', 'qualified') AND lead.archived_at IS NULL AND lead.merged_into_lead_id IS NULL
      ORDER BY lead.created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`, [organizationId]);
  let routed = 0;
  for (const lead of rows) {
    const target = await evaluateLeadAssignment(client, context, toLead(lead));
    if (!target.ownerUserId) continue;
    const changed = await applyLeadAssignment(client, context, lead, { ownerUserId: target.ownerUserId, teamId: target.teamId ?? lead.team_id },
      { method: target.method, rule: target.rule, reason: "Assignment rules run again on schedule" });
    if (changed) routed += 1;
  }
  return { routed, checked: rows.length };
}

export async function runLeadResponseWatch(client, organizationId) {
  const settings = await getLeadAssignmentSettings(client, { organizationId });
  const result = { alerted: 0, escalated: 0, followUpsOverdue: 0, workEscalated: 0, rerun: null };
  if (settings.firstResponseHours) result.alerted = await firstResponseAlerts(client, organizationId, settings.firstResponseHours);
  if (settings.responseEscalationHours) result.escalated = await responseEscalations(client, organizationId, settings.responseEscalationHours);
  result.followUpsOverdue = await followUpOverdueNotices(client, organizationId);
  if (settings.overdueEscalationHours) result.workEscalated = await overdueEscalations(client, organizationId, settings.overdueEscalationHours);
  if (settings.rerunUnassignedHours) result.rerun = await rerunUnassigned(client, organizationId, settings.rerunUnassignedHours);
  // Deals over their stage's time limit (CRM plan 5.1) are watched on the same tick.
  const { runOpportunityStageWatch } = await import("../opportunities/stage-watch.js");
  Object.assign(result, await runOpportunityStageWatch(client, organizationId));
  return result;
}
