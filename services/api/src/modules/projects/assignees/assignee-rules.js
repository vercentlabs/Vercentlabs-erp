// Projects — Assignees, the rules: who may be given a task (the project's manager or an active contributing member who can use Projects),
// why a task changes hands, and which open tasks need a new owner. The current assignee is the task's own assignee_user_id; there is no second,
// separately edited assignment record.
import { eligibleUsers, projectError, uuid } from "../project-core.js";

const err = (status, code, message, details) => projectError(status, code, message, details);

export const OPEN_TASK_STATUSES_SQL = `('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW')`;

// Why a task is reassigned. "Other" needs words of its own.
export const ASSIGNMENT_REASONS = Object.freeze({
  WORKLOAD_BALANCING: "Balancing the workload", UNAVAILABLE: "The assignee is unavailable", LEFT_PROJECT: "The assignee left the project",
  SKILLS: "Better suited to someone else", PRIORITY_CHANGE: "Priorities changed", OTHER: "Other",
});

// An open task needs a new owner when its assignee is inactive, or is no longer the manager or a contributing member of the project
// (an offboarding, or a removal kept by exception). Aliases: task, assignee (public.users), project.
export const NEEDS_OWNER_SQL = `(assignee.status IS DISTINCT FROM 'active' OR (task.assignee_user_id <> project.manager_user_id AND NOT EXISTS (SELECT 1 FROM tenant.project_members member
  WHERE member.project_id = task.project_id AND member.user_id = task.assignee_user_id AND member.left_at IS NULL AND member.role IN ('MANAGER', 'MEMBER'))))`;

// The person a task (or its review) may go to, checked on the server for every create, edit, reassignment and bulk change. The answer says
// what is wrong: not found, not active (or cannot use Projects), not on the team, or only a viewer.
export async function projectContributor(client, c, project, userId, { label = "Assignee", code = "TASK_ASSIGNEE_INVALID" } = {}) {
  const field = label === "Reviewer" ? "reviewerUserId" : "assigneeUserId";
  let id;
  try { id = uuid(userId, label); } catch { throw err(400, code, undefined, { field }); }
  if (!(await eligibleUsers(client, c, [id])).has(id)) {
    const known = (await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2`, [c.organizationId, id])).rows[0];
    throw err(400, code, known ? "This team member is not active, or cannot use Projects." : "This team member could not be found.", { field, reason: known ? "inactive" : "not_found" });
  }
  if (project.manager_user_id !== id) {
    const member = (await client.query(`SELECT role FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND user_id = $3 AND left_at IS NULL`,
      [c.organizationId, project.id, id])).rows[0];
    if (!member || !["MANAGER", "MEMBER"].includes(member.role))
      throw err(400, code, member ? "A viewer cannot be given tasks: make them a Project Member first." : "Add this person to the Project Team before assigning the Task.", { field, reason: "not_member" });
  }
  return id;
}
