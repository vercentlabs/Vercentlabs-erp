// Lead ownership: assign, reassign, assign to me, unassign, bulk assignment,
// transferring a user's leads, the assignment history and the workload view.
//
// Every change of owner or team goes through applyLeadAssignment, which
// records who changed what and how (one append-only history row), notifies
// the people involved and, by default, moves the previous owner's open
// tasks and follow-ups on the lead to the new owner. Completed activities
// keep their original owner, the creator never changes and the stage is
// untouched.
//
// Permissions: giving an unassigned lead its first owner needs
// crm.leads.assign; moving an owned lead needs crm.leads.reassign; taking a
// lead yourself needs crm.leads.assign_self (and the organization must allow
// it); many at once needs crm.leads.bulk_assign; handing a lead to someone
// outside the teams you manage needs crm.leads.assign_across_teams (view-all
// holders may already do so).
import { createNotification } from "../../../core/platform/notifications/index.js";
import { assertCrmOwnerAssignable, managedTeamMemberIds } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { canViewAllLeadRecords, leadCan, leadScopeSql, requireLeadPermission } from "./access.js";
import { LEAD_PERMISSIONS, leadAssignmentMethodLabel } from "./constants.js";
import { recordLeadHistory } from "./history.js";
import { requireUuid } from "./validation.js";
import { transferOpenFollowUps } from "../follow-ups/lifecycle.js";

const BULK_LIMIT = 200;
const OPEN_STATUSES = "('open', 'qualified')";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();
const leadName = (lead) => lead.full_name || lead.company_name || lead.code;

// ------------------------------------------------------------------ people and teams

// SQL true when the user can work in CRM: an active role that grants a CRM
// permission, or the organization owner role.
const CRM_ACCESS_SQL = (userExpr, organizationExpr) => `EXISTS (
  SELECT 1 FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
    LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
   WHERE assignment.organization_id = ${organizationExpr} AND assignment.user_id = ${userExpr} AND assignment.status = 'active'
     AND (role.slug = 'organization_owner' OR grant_row.permission_key LIKE 'crm.%'))`;

// SQL true when the user is an active member (or the manager) of the team.
export const ACTIVE_TEAM_MEMBER_SQL = (userExpr, teamExpr, organizationExpr) => `(
  EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member WHERE member.organization_id = ${organizationExpr} AND member.team_id = ${teamExpr}
           AND member.user_id = ${userExpr} AND member.status = 'active' AND member.effective_from <= current_date
           AND (member.effective_to IS NULL OR member.effective_to >= current_date))
  OR EXISTS (SELECT 1 FROM tenant.crm_sales_teams manager_team WHERE manager_team.organization_id = ${organizationExpr} AND manager_team.id = ${teamExpr}
           AND manager_team.manager_user_id = ${userExpr}))`;

// An owner must be an active member of the organization with CRM access and,
// when the lead also goes to a team, a member of that team.
export async function assertEligibleLeadAssignee(client, context, userId, { teamId = null } = {}) {
  const { rows } = await client.query(
    `SELECT app_user.id, app_user.full_name, ${CRM_ACCESS_SQL("app_user.id", "$1")} AS has_crm,
            ($3::uuid IS NULL OR ${ACTIVE_TEAM_MEMBER_SQL("app_user.id", "$3::uuid", "$1")}) AS in_team
       FROM organization_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id AND app_user.status = 'active'
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`,
    [context.organizationId, requireUuid(userId, "Owner"), teamId],
  );
  const user = rows[0];
  if (!user) throw new CrmError(409, "Choose an active member of your organization.", "CRM_LEAD_ASSIGNEE_INVALID");
  if (!user.has_crm) throw new CrmError(409, `${user.full_name} does not have access to CRM.`, "CRM_LEAD_ASSIGNEE_NO_ACCESS");
  if (!user.in_team) throw new CrmError(409, `${user.full_name} is not a member of the chosen team.`, "CRM_LEAD_ASSIGNEE_NOT_IN_TEAM");
  return user;
}

export async function assertActiveTeam(client, context, teamId) {
  const { rows } = await client.query(`SELECT id, name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, requireUuid(teamId, "Team")]);
  if (!rows[0]) throw new CrmError(409, "Choose an active sales team.", "CRM_LEAD_TEAM_INVALID");
  return rows[0];
}

// People (with CRM access) and active teams, with each team's members, for the pickers.
export async function listLeadAssignmentOptions(client, context) {
  const users = await client.query(
    `SELECT app_user.id, app_user.full_name AS name, app_user.email
       FROM organization_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id AND app_user.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active' AND ${CRM_ACCESS_SQL("app_user.id", "$1")}
      ORDER BY lower(app_user.full_name)`,
    [context.organizationId],
  );
  const teams = await client.query(
    `SELECT team.id, team.name, team.manager_user_id,
            COALESCE((SELECT array_agg(member.user_id) FROM tenant.crm_sales_team_members member
                       WHERE member.organization_id = team.organization_id AND member.team_id = team.id AND member.status = 'active'
                         AND member.effective_from <= current_date AND (member.effective_to IS NULL OR member.effective_to >= current_date)), '{}') AS member_ids
       FROM tenant.crm_sales_teams team WHERE team.organization_id = $1 AND team.status = 'active' ORDER BY lower(team.name)`,
    [context.organizationId],
  );
  return {
    users: users.rows,
    teams: teams.rows.map((row) => ({ id: row.id, name: row.name, managerUserId: row.manager_user_id, memberIds: [...new Set([...row.member_ids, ...(row.manager_user_id ? [row.manager_user_id] : [])])] })),
  };
}

// ------------------------------------------------------------------ applying a change

async function sourceName(client, context, sourceId) {
  if (!sourceId) return null;
  return (await client.query(`SELECT name FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2`, [context.organizationId, sourceId])).rows[0]?.name ?? null;
}

async function notifyAssignment(client, context, lead, { previousOwnerId, newOwnerId }) {
  const href = `/crm/leads/${lead.id}`;
  const source = await sourceName(client, context, lead.source_id);
  const details = [lead.company_name && lead.full_name ? lead.company_name : null, source ? `Source: ${source}` : null, `Priority: ${lead.priority}`].filter(Boolean).join(" · ");
  if (newOwnerId && newOwnerId !== context.userId)
    await createNotification(client, {
      organizationId: context.organizationId,
      userId: newOwnerId,
      category: previousOwnerId ? "crm_lead_reassigned" : "crm_assignment",
      title: previousOwnerId ? "Lead reassigned to you" : "Lead assigned to you",
      message: `${leadName(lead)} (${lead.code}). ${details}`,
      href,
      entityType: "lead",
      entityId: lead.id,
    });
  if (previousOwnerId && previousOwnerId !== newOwnerId && previousOwnerId !== context.userId)
    await createNotification(client, {
      organizationId: context.organizationId,
      userId: previousOwnerId,
      category: "crm_lead_reassigned",
      title: "Lead removed from you",
      message: `${leadName(lead)} (${lead.code}) was moved to another owner.`,
      href,
      entityType: "lead",
      entityId: lead.id,
    });
}

// Applies an ownership change to a lead row already locked (or just created)
// by the caller. `target` holds only the keys being changed: { ownerUserId?, teamId? }.
// options:
//   method               how the lead got its owner (see LEAD_ASSIGNMENT_METHODS)
//   rule                 { id, name } of the rule that routed it
//   reason               optional free text
//   notify               false for bulk (one summary instead) and conversions
//   moveOpenActivities   the previous owner's open tasks and follow-ups go to the new owner (default true)
//   requestKey           a retried request with the same key changes nothing twice
// Returns true when something changed.
export async function applyLeadAssignment(client, context, lead, target, {
  method = "manual", rule = null, reason = null, notify = true, moveOpenActivities = true, requestKey = null,
} = {}) {
  const ownerChanging = has(target, "ownerUserId") && (target.ownerUserId || null) !== (lead.owner_user_id || null);
  const teamChanging = has(target, "teamId") && (target.teamId || null) !== (lead.team_id || null);
  if (!ownerChanging && !teamChanging) return false;
  if (requestKey) {
    const seen = await client.query(`SELECT 1 FROM tenant.crm_lead_assignment_history WHERE organization_id = $1 AND lead_id = $2 AND request_key = $3`,
      [context.organizationId, lead.id, requestKey]);
    if (seen.rows[0]) return false;
  }

  const teamId = teamChanging ? target.teamId || null : lead.team_id;
  const newTeam = teamChanging && teamId ? await assertActiveTeam(client, context, teamId) : null;
  // An owner given together with a team must belong to that team.
  const newOwner = ownerChanging && target.ownerUserId
    ? await assertEligibleLeadAssignee(client, context, target.ownerUserId, { teamId: teamChanging ? teamId : null }) : null;
  const ownerUserId = ownerChanging ? newOwner?.id ?? null : lead.owner_user_id;
  const cleanReason = text(reason).slice(0, 500) || null;

  await client.query(
    `UPDATE tenant.crm_leads SET owner_user_id = $3, team_id = $4,
            assigned_at = CASE WHEN $5 THEN (CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END) ELSE assigned_at END,
            assigned_by = $6, assignment_method = $7, assignment_rule_id = $8, updated_by = $6
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, ownerUserId, teamId, ownerChanging, context.userId ?? null, method, rule?.id ?? null],
  );
  await client.query(
    `INSERT INTO tenant.crm_lead_assignment_history (organization_id, lead_id, previous_owner_id, new_owner_id, previous_team_id, new_team_id,
                                                     assignment_method, assignment_rule_id, assignment_rule_name, reason, assigned_by, request_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [context.organizationId, lead.id, lead.owner_user_id, ownerUserId, lead.team_id, teamId, method, rule?.id ?? null, rule?.name ?? null,
      cleanReason, context.userId ?? null, requestKey],
  );

  const how = rule ? `${leadAssignmentMethodLabel(method)}: ${rule.name}` : leadAssignmentMethodLabel(method);
  if (ownerChanging) {
    const previous = lead.owner_user_id
      ? (await client.query(`SELECT full_name FROM users WHERE id = $1`, [lead.owner_user_id])).rows[0]?.full_name ?? "Unknown" : "Unassigned";
    await recordLeadHistory(client, context, lead.id, "owner_changed", `Owner: ${previous} → ${newOwner?.full_name ?? "Unassigned"} (${how})`, {
      from: lead.owner_user_id, to: ownerUserId, method, ruleId: rule?.id ?? null, reason: cleanReason,
    });
    // Open work the previous owner had on this lead follows the lead; tasks
    // given to someone else (a demo for a colleague) and completed work stay.
    if (moveOpenActivities && lead.owner_user_id && ownerUserId)
      await transferOpenFollowUps(client, context, { entityType: "lead", entityId: lead.id, fromUserId: lead.owner_user_id, toUserId: ownerUserId });
    if (moveOpenActivities && lead.owner_user_id && ownerUserId)
      await client.query(
        `UPDATE tenant.crm_activities SET assigned_to = $4, updated_by = $5
          WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2 AND assigned_to = $3
            AND activity_type = 'task' AND status IN ('planned', 'in_progress', 'overdue')`,
        [context.organizationId, lead.id, lead.owner_user_id, ownerUserId, context.userId ?? null],
      );
    if (notify) await notifyAssignment(client, context, lead, { previousOwnerId: lead.owner_user_id, newOwnerId: ownerUserId });
    await queueOutboxEvent(client, context, "crm.leads.assigned", "leads", lead.id, { previousOwnerUserId: lead.owner_user_id, ownerUserId, method });
  }
  if (teamChanging) {
    const previous = lead.team_id
      ? (await client.query(`SELECT name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2`, [context.organizationId, lead.team_id])).rows[0]?.name ?? "Unknown"
      : "No team";
    await recordLeadHistory(client, context, lead.id, "team_changed", `Team: ${previous} → ${newTeam?.name ?? "No team"} (${how})`, {
      from: lead.team_id, to: teamId, method, ruleId: rule?.id ?? null, reason: cleanReason,
    });
  }
  return true;
}

export async function lockVisibleLead(client, context, leadId) {
  const values = [context.organizationId, requireUuid(leadId, "Lead")];
  const { rows } = await client.query(
    `SELECT lead.* FROM tenant.crm_leads lead
      WHERE lead.organization_id = $1 AND lead.id = $2 AND lead.archived_at IS NULL${leadScopeSql(context, values, "lead")}
      FOR UPDATE OF lead`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
  return rows[0];
}

function assertAssignable(lead, expectedUpdatedAt) {
  if (lead.status === "converted")
    throw new CrmError(409, "A converted lead cannot be reassigned. Reassign its account, contact or opportunity instead.", "CRM_LEAD_CONVERTED");
  // Two people assigning the same lead at once: the second sees a conflict instead of silently overwriting.
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== new Date(lead.updated_at).getTime())
    throw new CrmError(409, "This lead was changed by someone else. Reload it and try again.", "CRM_STALE_WRITE");
}

// Who the caller may hand a lead to: themselves, members of teams they
// manage, or anyone with assign-across-teams or view-all.
async function assertCallerMayAssignTo(client, context, ownerUserId) {
  if (!ownerUserId || leadCan(context, LEAD_PERMISSIONS.assignAcrossTeams)) return;
  await assertCrmOwnerAssignable(client, context, ownerUserId, "You can only assign leads to yourself or to members of a team you manage.", { resource: "leads" });
}

// ------------------------------------------------------------------ assign / reassign / self / unassign

// input: { ownerUserId?: uuid | null, teamId?: uuid | null, reason?, expectedUpdatedAt?,
//          moveOpenActivities? (default true), requestKey? }
// An absent key is left unchanged; ownerUserId null returns the lead to the unassigned queue.
export async function assignLead(client, context, leadId, input = {}, { method = "manual", notify = true } = {}) {
  if (!has(input, "ownerUserId") && !has(input, "teamId")) throw new CrmError(400, "Choose an owner or a team.", "CRM_LEAD_VALIDATION");
  const lead = await lockVisibleLead(client, context, leadId);
  assertAssignable(lead, input.expectedUpdatedAt);
  const target = {};
  if (has(input, "ownerUserId")) target.ownerUserId = input.ownerUserId || null;
  if (has(input, "teamId")) target.teamId = input.teamId || null;
  const ownerChanging = has(target, "ownerUserId") && target.ownerUserId !== lead.owner_user_id;
  const teamChanging = has(target, "teamId") && target.teamId !== lead.team_id;
  if (!ownerChanging && !teamChanging) return { changed: false };

  // First owner / team of an unassigned lead is "assign"; moving an existing owner or team is "reassign".
  const moving = (ownerChanging && lead.owner_user_id) || (teamChanging && lead.team_id);
  requireLeadPermission(context, moving ? LEAD_PERMISSIONS.reassign : LEAD_PERMISSIONS.assign,
    moving ? "You do not have permission to reassign leads." : "You do not have permission to assign leads.");
  if (ownerChanging) await assertCallerMayAssignTo(client, context, target.ownerUserId);
  const changed = await applyLeadAssignment(client, context, lead, target, {
    method, reason: input.reason, notify, moveOpenActivities: input.moveOpenActivities !== false, requestKey: text(input.requestKey) || null,
  });
  return { changed, previousOwnerUserId: lead.owner_user_id, ownerUserId: has(target, "ownerUserId") ? target.ownerUserId : lead.owner_user_id };
}

export const reassignLead = assignLead;

// Gives the lead to a team (optionally with an owner from it).
export async function assignLeadToTeam(client, context, leadId, input = {}) {
  return assignLead(client, context, leadId, { ...input, teamId: input.teamId ?? null });
}

// "Assign to me" on an unassigned lead, where the organization allows it.
export async function assignLeadToSelf(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.assignSelf, "You do not have permission to assign leads to yourself.");
  const { getLeadAssignmentSettings } = await import("./assignment-rules.js");
  const settings = await getLeadAssignmentSettings(client, context);
  if (!settings.allowSelfAssignment) throw new CrmError(403, "Your organization does not allow taking leads yourself. Ask a manager to assign it.", "CRM_LEAD_SELF_ASSIGNMENT_DISABLED");
  const lead = await lockVisibleLead(client, context, leadId);
  assertAssignable(lead, input.expectedUpdatedAt);
  if (lead.owner_user_id === context.userId) return { changed: false };
  if (lead.owner_user_id) throw new CrmError(409, "This lead already has an owner. Ask a manager to reassign it.", "CRM_LEAD_ALREADY_OWNED");
  // A lead queued for a team can only be taken by a member of that team.
  const changed = await applyLeadAssignment(client, context, lead, { ownerUserId: context.userId }, {
    method: "self", reason: input.reason, requestKey: text(input.requestKey) || null,
  });
  return { changed };
}

// Back to the unassigned queue; the team is kept.
export async function unassignLead(client, context, leadId, input = {}) {
  return assignLead(client, context, leadId, { ...input, ownerUserId: null });
}

// Assigns many leads in one request. Each lead succeeds or fails on its own;
// every new owner gets one summary notification instead of one per lead.
export async function bulkAssignLeads(client, context, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.bulkAssign, "You do not have permission to assign leads in bulk.");
  const leadIds = [...new Set(Array.isArray(input.leadIds) ? input.leadIds : [])];
  if (!leadIds.length) throw new CrmError(400, "Select at least one lead.", "CRM_LEAD_VALIDATION");
  if (leadIds.length > BULK_LIMIT) throw new CrmError(400, `Select up to ${BULK_LIMIT} leads at a time.`, "CRM_LEAD_BULK_LIMIT");
  const { leadIds: _ids, requestKey, ...assignment } = input;
  const results = [];
  const received = new Map();
  for (const leadId of leadIds) {
    await client.query("SAVEPOINT lead_bulk_assign");
    try {
      const outcome = await assignLead(client, context, leadId, { ...assignment, requestKey: requestKey ? `${requestKey}:${leadId}` : null }, { method: "bulk", notify: false });
      await client.query("RELEASE SAVEPOINT lead_bulk_assign");
      results.push({ leadId, ok: true, changed: outcome.changed });
      if (outcome.changed && outcome.ownerUserId && outcome.ownerUserId !== outcome.previousOwnerUserId)
        received.set(outcome.ownerUserId, (received.get(outcome.ownerUserId) ?? 0) + 1);
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT lead_bulk_assign");
      if (!(error instanceof CrmError)) throw error;
      results.push({ leadId, ok: false, message: error.message });
    }
  }
  for (const [userId, count] of received)
    if (userId !== context.userId)
      await createNotification(client, {
        organizationId: context.organizationId,
        userId,
        category: "crm_assignment",
        title: count === 1 ? "A lead was assigned to you" : `${count} leads were assigned to you`,
        message: "Open My Leads to see them.",
        href: "/crm/leads?view=mine",
        entityType: "lead",
        entityId: null,
      });
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}

// ------------------------------------------------------------------ users who leave

// The leads a user still owns that need someone (open or qualified, not archived).
export async function countUserActiveLeads(client, context, userId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const { rows } = await client.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'qualified')::int AS qualified
       FROM tenant.crm_leads WHERE organization_id = $1 AND owner_user_id = $2 AND archived_at IS NULL AND status IN ${OPEN_STATUSES}`,
    [context.organizationId, requireUuid(userId, "User")],
  );
  return rows[0];
}

// Moves every active lead of one user (who is leaving, or overloaded) to
// another user or team, or back through the assignment rules.
// input: { fromUserId, toUserId?, teamId?, useRules?: boolean, reason? }
export async function transferUserLeads(client, context, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.manageAssignmentRules, "You do not have permission to transfer leads between users.");
  const fromUserId = requireUuid(input.fromUserId, "User");
  const useRules = input.useRules === true;
  const toUserId = useRules ? null : input.toUserId || null;
  const teamId = useRules ? null : input.teamId || null;
  if (!useRules && !toUserId && !teamId) throw new CrmError(400, "Choose who receives the leads, or run the assignment rules.", "CRM_LEAD_VALIDATION");
  if (toUserId === fromUserId) throw new CrmError(400, "Choose a different user.", "CRM_LEAD_VALIDATION");
  if (toUserId) await assertEligibleLeadAssignee(client, context, toUserId, { teamId });
  if (teamId) await assertActiveTeam(client, context, teamId);
  const { evaluateLeadAssignment } = await import("./assignment-rules.js");
  const { toLead } = await import("./records.js");
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_leads WHERE organization_id = $1 AND owner_user_id = $2 AND archived_at IS NULL AND status IN ${OPEN_STATUSES}
      ORDER BY created_at FOR UPDATE`,
    [context.organizationId, fromUserId],
  );
  const reason = text(input.reason) || "Transfer of a user's leads";
  let moved = 0;
  let unassigned = 0;
  const received = new Map();
  for (const lead of rows) {
    let target = { ownerUserId: toUserId, ...(teamId ? { teamId } : {}) };
    let method = "transfer";
    let rule = null;
    if (useRules) {
      const routed = await evaluateLeadAssignment(client, context, toLead(lead), { excludeUserId: fromUserId });
      target = { ownerUserId: routed.ownerUserId ?? null, teamId: routed.teamId ?? lead.team_id };
      method = routed.method ?? "transfer";
      rule = routed.rule;
    }
    await applyLeadAssignment(client, context, lead, target, { method, rule, reason, notify: false });
    if (target.ownerUserId) {
      moved += 1;
      received.set(target.ownerUserId, (received.get(target.ownerUserId) ?? 0) + 1);
    } else unassigned += 1;
  }
  for (const [userId, count] of received)
    if (userId !== context.userId)
      await createNotification(client, {
        organizationId: context.organizationId,
        userId,
        category: "crm_assignment",
        title: `${count} ${count === 1 ? "lead was" : "leads were"} transferred to you`,
        message: reason,
        href: "/crm/leads?view=mine",
        entityType: "lead",
        entityId: null,
      });
  return { total: rows.length, moved, unassigned };
}

// ------------------------------------------------------------------ history and workload

export async function listLeadAssignmentHistory(client, context, leadId) {
  const { getLead } = await import("./records.js");
  const lead = await getLead(client, context, leadId);
  const { rows } = await client.query(
    `SELECT history.*, previous_owner.full_name AS previous_owner_name, new_owner.full_name AS new_owner_name,
            previous_team.name AS previous_team_name, new_team.name AS new_team_name, actor.full_name AS assigned_by_name
       FROM tenant.crm_lead_assignment_history history
       LEFT JOIN public.users previous_owner ON previous_owner.id = history.previous_owner_id
       LEFT JOIN public.users new_owner ON new_owner.id = history.new_owner_id
       LEFT JOIN tenant.crm_sales_teams previous_team ON previous_team.organization_id = history.organization_id AND previous_team.id = history.previous_team_id
       LEFT JOIN tenant.crm_sales_teams new_team ON new_team.organization_id = history.organization_id AND new_team.id = history.new_team_id
       LEFT JOIN public.users actor ON actor.id = history.assigned_by
      WHERE history.organization_id = $1 AND history.lead_id = $2
      ORDER BY history.assigned_at DESC, history.id DESC`,
    [context.organizationId, lead.id],
  );
  return rows.map((row) => ({
    id: row.id,
    assignedAt: row.assigned_at,
    method: row.assignment_method,
    methodLabel: leadAssignmentMethodLabel(row.assignment_method),
    ruleId: row.assignment_rule_id,
    ruleName: row.assignment_rule_name,
    previousOwnerName: row.previous_owner_name,
    newOwnerName: row.new_owner_name,
    previousTeamName: row.previous_team_name,
    newTeamName: row.new_team_name,
    ownerChanged: (row.previous_owner_id || null) !== (row.new_owner_id || null),
    teamChanged: (row.previous_team_id || null) !== (row.new_team_id || null),
    reason: row.reason,
    assignedByName: row.assigned_by_name,
  }));
}

// Open leads per salesperson, to assign by hand sensibly. Shows everyone for
// view-all callers, otherwise the caller and the people in teams they manage.
export async function getLeadAssignmentWorkload(client, context) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const everyone = canViewAllLeadRecords(context);
  const visible = everyone ? null : [context.userId, ...(await managedTeamMemberIds(client, context))];
  const { rows } = await client.query(
    `SELECT app_user.id, app_user.full_name AS name,
            count(lead.id) FILTER (WHERE lead.status = 'open')::int AS open_leads,
            count(lead.id) FILTER (WHERE lead.status = 'qualified')::int AS qualified_leads,
            count(lead.id) FILTER (WHERE lead.assigned_at >= current_date)::int AS assigned_today,
            count(lead.id) FILTER (WHERE lead.first_activity_at IS NULL AND lead.assigned_at < now() - interval '2 days')::int AS no_activity,
            count(lead.id) FILTER (WHERE follow_up.overdue)::int AS overdue_follow_ups
       FROM organization_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id AND app_user.status = 'active'
       LEFT JOIN tenant.crm_leads lead ON lead.organization_id = membership.organization_id AND lead.owner_user_id = app_user.id
             AND lead.archived_at IS NULL AND lead.status IN ${OPEN_STATUSES}
       LEFT JOIN LATERAL (
         SELECT bool_or(activity.due_at < now()) AS overdue FROM tenant.crm_activities activity
          WHERE activity.organization_id = lead.organization_id AND activity.entity_type = 'lead' AND activity.entity_id = lead.id
            AND activity.activity_type IN ('task', 'follow_up') AND activity.status IN ('planned', 'in_progress', 'overdue')) follow_up ON true
      WHERE membership.organization_id = $1 AND membership.status = 'active' AND ${CRM_ACCESS_SQL("app_user.id", "$1")}
        AND ($2::uuid[] IS NULL OR app_user.id = ANY ($2::uuid[]))
      GROUP BY app_user.id, app_user.full_name
      ORDER BY open_leads DESC, lower(app_user.full_name)`,
    [context.organizationId, visible],
  );
  return rows.map((row) => ({
    userId: row.id, name: row.name, openLeads: row.open_leads, qualifiedLeads: row.qualified_leads, assignedToday: row.assigned_today,
    noActivity: row.no_activity, overdueFollowUps: row.overdue_follow_ups,
  }));
}
