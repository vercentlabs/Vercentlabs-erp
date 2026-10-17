// Projects — Assignees, the reads: who may be given a task (with what they already carry here and overall), the team's workload, who held a
// task before, and what a team member still owns before they leave. Everything is read from the tasks, the project team and the task
// history. Workload figures are counts and the estimates people entered — never a claim about anyone's real availability.
import { PROJECT, has, isoDay, projectError, text, userNames, uuid } from "../project-core.js";
import { orgDay } from "../project-milestone-read.js";
import { projectTaskScope, taskScope } from "../project-task-read.js";
import { ASSIGNMENT_REASONS, NEEDS_OWNER_SQL, OPEN_TASK_STATUSES_SQL } from "./assignee-rules.js";

const err = (status, code, message, details) => projectError(status, code, message, details);
const OPEN = OPEN_TASK_STATUSES_SQL;

// Each person's open work in one project (or across every project the caller sees, when projectId is null), by user id.
async function loadFor(client, c, userIds, projectId = null) {
  if (!userIds.length) return new Map();
  const today = await orgDay(client, c);
  const rows = (await client.query(
    `SELECT task.assignee_user_id AS user_id,
            count(*) FILTER (WHERE task.status IN ${OPEN})::int AS open,
            count(*) FILTER (WHERE task.status = 'IN_PROGRESS')::int AS in_progress,
            count(*) FILTER (WHERE task.status IN ${OPEN} AND task.due_date < $3::date)::int AS overdue,
            count(*) FILTER (WHERE task.status IN ${OPEN} AND task.due_date BETWEEN $3::date AND $3::date + 6)::int AS due_this_week,
            count(*) FILTER (WHERE task.status IN ${OPEN} AND task.priority IN ('HIGH', 'URGENT'))::int AS high_priority,
            count(*) FILTER (WHERE task.status IN ${OPEN} AND task.estimate_minutes IS NOT NULL)::int AS estimated,
            COALESCE(sum(task.estimate_minutes) FILTER (WHERE task.status IN ${OPEN}), 0)::int AS estimate_minutes,
            count(DISTINCT task.project_id) FILTER (WHERE task.status IN ${OPEN})::int AS projects
       FROM tenant.project_tasks task JOIN tenant.projects project ON project.id = task.project_id
      WHERE task.organization_id = $1 AND task.assignee_user_id = ANY($2::uuid[]) AND task.archived_at IS NULL AND project.deleted_at IS NULL
        ${projectId ? "AND task.project_id = $4" : ""}
      GROUP BY task.assignee_user_id`, projectId ? [c.organizationId, userIds, today, projectId] : [c.organizationId, userIds, today])).rows;
  return new Map(rows.map((row) => [row.user_id, row]));
}
const figures = (row) => ({
  open: row?.open ?? 0, inProgress: row?.in_progress ?? 0, overdue: row?.overdue ?? 0, dueThisWeek: row?.due_this_week ?? 0, highPriority: row?.high_priority ?? 0,
  // Only tasks with an estimate count toward it; how many open tasks have one is said beside it (a missing estimate is not zero hours).
  estimateMinutes: row?.estimate_minutes ?? 0, estimatedTasks: row?.estimated ?? 0, projects: row?.projects ?? 0,
});

// The people who may be given this project's tasks: its manager and its contributing members, active in the company — with what they carry
// here and overall. search: by name or email.
export async function getEligibleProjectAssignees(client, c, projectId, { search = "" } = {}) {
  const { project } = await projectTaskScope(client, c, projectId);
  const term = text(search, 100).toLowerCase();
  const rows = (await client.query(
    `SELECT person.id, COALESCE(NULLIF(person.full_name, ''), person.email) AS name, person.email, person.status,
            CASE WHEN person.id = $3 THEN 'MANAGER' ELSE member.role END AS role
       FROM public.users person
       LEFT JOIN tenant.project_members member ON member.organization_id = $1 AND member.project_id = $2 AND member.user_id = person.id AND member.left_at IS NULL
      WHERE (person.id = $3 OR member.role IN ('MANAGER', 'MEMBER'))
        AND EXISTS (SELECT 1 FROM public.organization_memberships membership WHERE membership.organization_id = $1 AND membership.user_id = person.id AND membership.status = 'active')
        AND person.status = 'active' ${term ? "AND (lower(person.full_name) LIKE $4 OR lower(person.email) LIKE $4)" : ""}
      ORDER BY person.full_name`,
    term ? [c.organizationId, project.id, project.manager_user_id, `%${term.replace(/[\\%_]/g, "\\$&")}%`] : [c.organizationId, project.id, project.manager_user_id])).rows;
  const here = await loadFor(client, c, rows.map((row) => row.id), project.id);
  const everywhere = await loadFor(client, c, rows.map((row) => row.id));
  return rows.map((row) => ({ userId: row.id, name: row.name, email: row.email, role: row.role, roleLabel: row.role === "MANAGER" ? "Project Manager" : "Project Member",
    project: figures(here.get(row.id)), overall: figures(everywhere.get(row.id)) }));
}

// The team's workload on this project, and the work of anyone who still holds open tasks here without being able to do them (inactive,
// or no longer on the team) — the exception queue's people.
export async function getProjectTeamWorkload(client, c, projectId) {
  const { project } = await projectTaskScope(client, c, projectId);
  const team = await getEligibleProjectAssignees(client, c, project.id);
  const stranded = (await client.query(
    `SELECT DISTINCT task.assignee_user_id AS id FROM tenant.project_tasks task LEFT JOIN public.users assignee ON assignee.id = task.assignee_user_id
       JOIN tenant.projects project ON project.id = task.project_id
      WHERE task.organization_id = $1 AND task.project_id = $2 AND task.status IN ${OPEN} AND task.archived_at IS NULL AND ${NEEDS_OWNER_SQL}`,
    [c.organizationId, project.id])).rows.map((row) => row.id);
  const names = await userNames(client, stranded);
  const load = await loadFor(client, c, stranded, project.id);
  const unestimated = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND status IN ${OPEN}
     AND archived_at IS NULL AND estimate_minutes IS NULL`, [c.organizationId, project.id])).rows[0].n);
  return {
    projectId: project.id, projectCode: project.project_code,
    members: team.map(({ userId, name, role, roleLabel, project: here, overall }) => ({ userId, name, role, roleLabel, ...here, overallOpen: overall.open, overallProjects: overall.projects })),
    needsOwner: stranded.map((id) => ({ userId: id, name: names.get(id) ?? "Former user", ...figures(load.get(id)) })),
    unestimatedOpenTasks: unestimated,
    note: "Counts of open tasks and the estimates people entered — not verified availability.",
  };
}

// Who held the task, from whom, by whom, when and why (the creation is the first assignment).
export async function getTaskAssignmentHistory(client, c, taskId) {
  const { task } = await taskScope(client, c, taskId);
  const rows = (await client.query(`SELECT * FROM tenant.project_task_events WHERE organization_id = $1 AND task_id = $2 AND action IN ('CREATED', 'REASSIGNED', 'ASSIGNEE_LEFT')
     ORDER BY occurred_at`, [c.organizationId, task.id])).rows;
  const names = await userNames(client, rows.flatMap((row) => [row.actor_user_id, row.details?.from, row.details?.to, row.details?.assigneeUserId]));
  return rows.map((row) => ({
    id: row.id, action: row.action, at: row.occurred_at, by: names.get(row.actor_user_id) ?? "System",
    from: row.action === "REASSIGNED" ? names.get(row.details?.from) ?? null : null,
    to: row.action === "CREATED" ? names.get(row.details?.assigneeUserId) ?? null : row.action === "REASSIGNED" ? names.get(row.details?.to) ?? null : null,
    reasonCode: row.details?.reasonCode ?? null, reason: row.details?.reasonCode ? ASSIGNMENT_REASONS[row.details.reasonCode] ?? null : null,
    reasonText: row.details?.reasonText ?? row.details?.note ?? row.details?.reason ?? null, summary: row.summary,
  }));
}

// What a team member still carries on the project before they leave: open tasks, tasks they review, blockers they own, milestones they own,
// and the time and expenses recorded under their name (which stay theirs).
export async function getMemberAssignmentImpact(client, c, projectId, memberId) {
  const { project, access } = await projectTaskScope(client, c, projectId);
  if (!access.can.members && !has(c, PROJECT.taskAssign)) throw err(403, "TASK_PERMISSION_DENIED");
  const member = (await client.query(`SELECT * FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND id = $3`, [c.organizationId, project.id, uuid(memberId, "Member")])).rows[0];
  if (!member) throw err(404, "TASK_NOT_FOUND", "That member is not on the project.");
  const userId = member.user_id;
  const rows = async (sql) => (await client.query(sql, [c.organizationId, project.id, userId])).rows;
  const tasks = await rows(`SELECT id, task_code, title, status, due_date FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND assignee_user_id = $3 AND status IN ${OPEN} ORDER BY due_date`);
  const reviews = await rows(`SELECT id, task_code, title, status FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND reviewer_user_id = $3 AND status IN ${OPEN}`);
  const blockers = await rows(`SELECT blocker.id, task.task_code, blocker.description FROM tenant.project_task_blockers blocker JOIN tenant.project_tasks task ON task.id = blocker.task_id
     WHERE blocker.organization_id = $1 AND task.project_id = $2 AND blocker.owner_user_id = $3 AND blocker.status = 'ACTIVE'`);
  const milestones = await rows(`SELECT id, milestone_code, name, status FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2 AND owner_user_id = $3
     AND status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED')`);
  const day = (value) => (value ? isoDay(value) : null);
  return {
    memberId: member.id, userId, leftAt: member.left_at,
    openTasks: tasks.map((row) => ({ id: row.id, code: row.task_code, title: row.title, status: row.status, dueDate: day(row.due_date) })),
    reviews: reviews.map((row) => ({ id: row.id, code: row.task_code, title: row.title, status: row.status })),
    blockers: blockers.map((row) => ({ id: row.id, taskCode: row.task_code, description: row.description })),
    milestones: milestones.map((row) => ({ id: row.id, code: row.milestone_code, name: row.name, status: row.status })),
    clear: !tasks.length && !reviews.length && !blockers.length && !milestones.length,
    note: "Time entries and expenses recorded by this person stay theirs; reassigning their work never moves them.",
  };
}
