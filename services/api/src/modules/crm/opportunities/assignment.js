// Opportunity ownership: every deal has one owner and, optionally, a team.
//
// Changing the owner never changes the stage or the status, never deletes
// activities and never rewrites who did past work. The previous owner's open
// tasks and follow-ups on the deal can follow it to the new owner. Every
// change is one append-only row in the assignment history.
//
// Giving an unowned deal its first owner needs crm.opportunities.assign;
// moving an owned deal needs crm.opportunities.reassign.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { assertActiveTeam, assertEligibleLeadAssignee } from "../leads/assignment.js";
import { canViewAllOpportunities, requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { recordOpportunityHistory } from "./history.js";
import { assertNotStale, getOpportunity, lockOpportunity } from "./records.js";
import { runOpportunityBulkOperation } from "./stages.js";
import { transferOpenFollowUps } from "../follow-ups/lifecycle.js";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();

// input: { ownerUserId?: uuid | null, teamId?: uuid | null, reason?, expectedUpdatedAt?, moveOpenActivities? (default true) }
// An absent key is left unchanged. options.notify: false for bulk (one summary instead).
export async function assignOpportunity(client, context, opportunityId, input = {}, { notify = true } = {}) {
  if (!has(input, "ownerUserId") && !has(input, "teamId")) throw new CrmError(400, "Choose an owner or a team.", "CRM_OPPORTUNITY_VALIDATION");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.archived_at) throw new CrmError(409, "Restore this opportunity before reassigning it.", "CRM_OPPORTUNITY_ARCHIVED");
  assertNotStale(opportunity, input.expectedUpdatedAt);
  const ownerUserId = has(input, "ownerUserId") ? input.ownerUserId || null : opportunity.owner_user_id;
  const teamId = has(input, "teamId") ? input.teamId || null : opportunity.team_id;
  const ownerChanging = ownerUserId !== opportunity.owner_user_id;
  const teamChanging = teamId !== opportunity.team_id;
  if (!ownerChanging && !teamChanging) return { changed: false };

  const moving = (ownerChanging && opportunity.owner_user_id) || (teamChanging && opportunity.team_id);
  requireOpportunityPermission(context, moving ? OPPORTUNITY_PERMISSIONS.reassign : OPPORTUNITY_PERMISSIONS.assign,
    moving ? "You do not have permission to reassign opportunities." : "You do not have permission to assign opportunities.");
  const team = teamChanging && teamId ? await assertActiveTeam(client, context, teamId) : null;
  let owner = null;
  if (ownerChanging && ownerUserId) {
    // Outside the teams the caller manages needs the wider view.
    if (ownerUserId !== context.userId && !canViewAllOpportunities(context))
      await assertCrmOwnerAssignable(client, context, ownerUserId, "You can only assign opportunities to yourself or to members of a team you manage.", { resource: "opportunities" });
    owner = await assertEligibleLeadAssignee(client, context, ownerUserId, { teamId: teamChanging ? teamId : null });
  }
  const reason = text(input.reason).slice(0, 500) || null;

  await client.query(
    `UPDATE tenant.crm_opportunities SET owner_user_id = $3, team_id = $4, assigned_at = CASE WHEN $5 THEN now() ELSE assigned_at END,
            assigned_by = CASE WHEN $5 THEN $6 ELSE assigned_by END, updated_by = $6
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, opportunity.id, ownerUserId, teamId, ownerChanging, context.userId ?? null],
  );
  await client.query(
    `INSERT INTO tenant.crm_opportunity_assignment_history (organization_id, opportunity_id, previous_owner_id, new_owner_id, previous_team_id, new_team_id, reason, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [context.organizationId, opportunity.id, opportunity.owner_user_id, ownerUserId, opportunity.team_id, teamId, reason, context.userId ?? null],
  );
  if (ownerChanging) {
    await recordOpportunityHistory(client, context, opportunity.id, "owner_changed", `Owner: ${opportunity.owner_name ?? "Unassigned"} → ${owner?.full_name ?? "Unassigned"}`, {
      from: opportunity.owner_user_id, to: ownerUserId, reason,
    });
    // Open work the previous owner had on this deal follows the deal; completed work keeps its owner.
    if (input.moveOpenActivities !== false && opportunity.owner_user_id && ownerUserId)
      await transferOpenFollowUps(client, context, { entityType: "opportunity", entityId: opportunity.id, fromUserId: opportunity.owner_user_id, toUserId: ownerUserId });
    if (input.moveOpenActivities !== false && opportunity.owner_user_id && ownerUserId)
      await client.query(
        `UPDATE tenant.crm_activities SET assigned_to = $4, updated_by = $5
          WHERE organization_id = $1 AND entity_type = 'opportunity' AND entity_id = $2 AND assigned_to = $3
            AND activity_type = 'task' AND status IN ('planned', 'in_progress', 'overdue')`,
        [context.organizationId, opportunity.id, opportunity.owner_user_id, ownerUserId, context.userId ?? null],
      );
    if (notify && ownerUserId && ownerUserId !== context.userId)
      await createNotification(client, {
        organizationId: context.organizationId,
        userId: ownerUserId,
        category: "crm_opportunity_assignment",
        title: opportunity.owner_user_id ? "Opportunity reassigned to you" : "Opportunity assigned to you",
        message: `${opportunity.name} (${opportunity.code})${opportunity.account_name ? ` · ${opportunity.account_name}` : ""}`,
        href: `/crm/opportunities/${opportunity.id}`,
        entityType: "opportunity",
        entityId: opportunity.id,
      });
  }
  if (teamChanging)
    await recordOpportunityHistory(client, context, opportunity.id, "team_changed", `Team: ${opportunity.team_name ?? "No team"} → ${team?.name ?? "No team"}`, {
      from: opportunity.team_id, to: teamId, reason,
    });
  return { changed: true, previousOwnerUserId: opportunity.owner_user_id, ownerUserId };
}

export const reassignOpportunity = assignOpportunity;

// Assigns many opportunities in one request. Each succeeds or fails on its
// own; every new owner gets one summary notification.
export async function bulkAssignOpportunities(client, context, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.reassign, "You do not have permission to assign opportunities in bulk.");
  const { opportunityIds, ...assignment } = input;
  let received = 0;
  const result = await runOpportunityBulkOperation(client, opportunityIds, async (id) => {
    const outcome = await assignOpportunity(client, context, id, assignment, { notify: false });
    if (outcome.changed && outcome.ownerUserId && outcome.ownerUserId !== outcome.previousOwnerUserId) received += 1;
    return outcome;
  }, context);
  if (received && assignment.ownerUserId && assignment.ownerUserId !== context.userId)
    await createNotification(client, {
      organizationId: context.organizationId,
      userId: assignment.ownerUserId,
      category: "crm_opportunity_assignment",
      title: received === 1 ? "An opportunity was assigned to you" : `${received} opportunities were assigned to you`,
      message: "Open My Opportunities to see them.",
      href: "/crm/opportunities?view=mine",
      entityType: "opportunity",
      entityId: null,
    });
  return result;
}

export async function listOpportunityAssignmentHistory(client, context, opportunityId) {
  const opportunity = await getOpportunity(client, context, opportunityId);
  const { rows } = await client.query(
    `SELECT history.*, previous_owner.full_name AS previous_owner_name, new_owner.full_name AS new_owner_name,
            previous_team.name AS previous_team_name, new_team.name AS new_team_name, actor.full_name AS assigned_by_name
       FROM tenant.crm_opportunity_assignment_history history
       LEFT JOIN public.users previous_owner ON previous_owner.id = history.previous_owner_id
       LEFT JOIN public.users new_owner ON new_owner.id = history.new_owner_id
       LEFT JOIN tenant.crm_sales_teams previous_team ON previous_team.organization_id = history.organization_id AND previous_team.id = history.previous_team_id
       LEFT JOIN tenant.crm_sales_teams new_team ON new_team.organization_id = history.organization_id AND new_team.id = history.new_team_id
       LEFT JOIN public.users actor ON actor.id = history.assigned_by
      WHERE history.organization_id = $1 AND history.opportunity_id = $2
      ORDER BY history.assigned_at DESC, history.id DESC`,
    [context.organizationId, opportunity.id],
  );
  return rows.map((row) => ({
    id: row.id, assignedAt: row.assigned_at, previousOwnerName: row.previous_owner_name ?? null, newOwnerName: row.new_owner_name ?? null,
    previousTeamName: row.previous_team_name ?? null, newTeamName: row.new_team_name ?? null,
    ownerChanged: (row.previous_owner_id || null) !== (row.new_owner_id || null), teamChanged: (row.previous_team_id || null) !== (row.new_team_id || null),
    reason: row.reason, assignedByName: row.assigned_by_name ?? null,
  }));
}
