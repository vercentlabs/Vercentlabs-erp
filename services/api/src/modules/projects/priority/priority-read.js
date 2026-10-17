// Projects — Priority, the reads: what the work queues need from priority (the levels to filter by, the "Needs attention" order and the
// reasons shown beside each task), and the priority reports — open work by priority across projects, milestones and tasks; urgent and
// high-priority queues; work by priority per person and per project; what was completed at each level (the level it had when done, from
// its history); and every recorded change.
import { PROJECT, has, projectError, userNames, uuid, visibilitySql } from "../project-core.js";
import { listTaskQueue } from "../project-task-read.js";
import { PRIORITY_LABEL, PRIORITY_LEVELS, PRIORITY_RANK, prioritySortSql } from "./priority-rules.js";

const err = (status, code, message, details) => projectError(status, code, message, details);
const OPEN = `('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW')`;

// One or more levels from a filter ("URGENT,HIGH"); anything else is ignored.
export const priorityLevelsOf = (value) => String(value ?? "").toUpperCase().split(",").map((level) => level.trim()).filter((level) => PRIORITY_RANK[level]);

// Needs attention — fixed and explainable: overdue, then due within the reminder window, then the rest; within each, Urgent before High
// before Normal before Low; then blocked, in progress, in review, to do; then the earliest due date; the task code breaks ties. An Urgent task
// due next month never jumps an overdue one. todayRef / soonRef are bound parameters (the company's day, the reminder window in days).
export const attentionOrderSql = (todayRef, soonRef) => `CASE WHEN task.status IN ${OPEN} AND task.due_date < ${todayRef}::date THEN 0
    WHEN task.status IN ${OPEN} AND task.due_date <= ${todayRef}::date + ${soonRef}::int THEN 1 ELSE 2 END,
  ${prioritySortSql("task.priority")}, CASE task.status WHEN 'BLOCKED' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'IN_REVIEW' THEN 2 WHEN 'TO_DO' THEN 3 ELSE 4 END,
  task.due_date, task.task_code`;

// Why a task sits near the top, shown beside it (never a hidden score). row: a shaped task row (priority, overdue, dueIn, status).
export const attentionOf = (row, soon) => [
  ...(row.priority === "URGENT" ? ["Urgent"] : row.priority === "HIGH" ? ["High priority"] : []),
  ...(row.overdue ? ["Overdue"] : row.dueIn !== null && row.dueIn !== undefined && row.dueIn <= soon ? [row.dueIn === 0 ? "Due today" : "Due soon"] : []),
  ...(row.status === "BLOCKED" ? ["Blocked"] : []),
];

export const PRIORITY_REPORTS = Object.freeze(["distribution", "by-priority", "by-assignee", "by-project", "urgent-open", "high-priority-overdue", "blocked-urgent", "completed", "changes"]);

// filters: { projectId? }
export async function getPriorityReport(client, c, kind = "distribution", filters = {}) {
  if (!PRIORITY_REPORTS.includes(kind)) throw err(400, "TASK_INPUT_INVALID", "Unknown priority report.");
  if (!has(c, PROJECT.taskView)) throw err(403, "TASK_PERMISSION_DENIED");
  const queue = (view, extra) => listTaskQueue(client, c, { view, pageSize: 500, projectId: filters.projectId, sort: "attention", ...extra }).then((result) => result.rows);
  if (kind === "urgent-open") return queue("open", { priority: "URGENT" });
  if (kind === "high-priority-overdue") return queue("overdue", { priority: "URGENT,HIGH" });
  if (kind === "blocked-urgent") return queue("blocked", { priority: "URGENT" });

  const values = [c.organizationId, c.userId ?? null];
  const visible = `project.deleted_at IS NULL AND ${visibilitySql(c, "project", "$2")}`;
  const scope = filters.projectId ? (values.push(uuid(filters.projectId, "Project")), ` AND project.id = $${values.length}`) : "";
  const tz = `COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC')`;
  const tasks = `FROM tenant.project_tasks task JOIN tenant.projects project ON project.id = task.project_id WHERE task.organization_id = $1 AND task.archived_at IS NULL AND ${visible}${scope}`;
  const byLevel = (alias, condition = "TRUE") => PRIORITY_LEVELS.map((level) => `count(*) FILTER (WHERE ${condition} AND ${alias}.priority = '${level.code}')::int AS ${level.code.toLowerCase()}`).join(", ");
  const levelsOf = (row) => Object.fromEntries(PRIORITY_LEVELS.map((level) => [level.code, row?.[level.code.toLowerCase()] ?? 0]));
  const openTask = `task.status IN ${OPEN}`;

  if (kind === "distribution") {
    // Open work by priority: active projects, open milestones and open tasks, each counted by its own priority (never a parent's).
    const projects = (await client.query(`SELECT ${byLevel("project")} FROM tenant.projects project WHERE project.organization_id = $1 AND project.archived_at IS NULL
        AND project.status IN ('PLANNED', 'IN_PROGRESS', 'ON_HOLD') AND ${visible}${scope}`, values)).rows[0];
    const milestones = (await client.query(`SELECT ${byLevel("milestone")} FROM tenant.project_milestones milestone JOIN tenant.projects project ON project.id = milestone.project_id
        WHERE milestone.organization_id = $1 AND milestone.status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED') AND ${visible}${scope}`, values)).rows[0];
    const open = (await client.query(`SELECT ${byLevel("task")} ${tasks} AND ${openTask}`, values)).rows[0];
    return [{ entity: "PROJECT", label: "Projects", ...levelsOf(projects) }, { entity: "MILESTONE", label: "Milestones", ...levelsOf(milestones) }, { entity: "TASK", label: "Tasks", ...levelsOf(open) }];
  }
  if (kind === "by-priority") {
    const rows = (await client.query(`SELECT task.priority, count(*) FILTER (WHERE ${openTask})::int AS open, count(*) FILTER (WHERE task.status = 'DONE')::int AS done,
        count(*) FILTER (WHERE task.status = 'BLOCKED')::int AS blocked, count(*) FILTER (WHERE ${openTask} AND task.due_date < (now() AT TIME ZONE ${tz})::date)::int AS overdue
        ${tasks} GROUP BY task.priority`, values)).rows;
    return PRIORITY_LEVELS.map((level) => {
      const row = rows.find((entry) => entry.priority === level.code);
      return { priority: level.code, label: level.label, open: row?.open ?? 0, overdue: row?.overdue ?? 0, blocked: row?.blocked ?? 0, done: row?.done ?? 0 };
    });
  }
  if (kind === "by-assignee") {
    // Where the important work sits — a count of open tasks per level, not a measure of anyone's capacity.
    const rows = (await client.query(`SELECT task.assignee_user_id, ${byLevel("task", openTask)}, count(*) FILTER (WHERE ${openTask})::int AS open ${tasks} GROUP BY task.assignee_user_id`, values)).rows
      .filter((row) => row.open > 0);
    const names = await userNames(client, rows.map((row) => row.assignee_user_id));
    return rows.map((row) => ({ assigneeId: row.assignee_user_id, assignee: names.get(row.assignee_user_id) ?? "Unknown", open: row.open, ...levelsOf(row) }))
      .sort((a, b) => b.URGENT - a.URGENT || b.HIGH - a.HIGH || a.assignee.localeCompare(b.assignee));
  }
  if (kind === "by-project") {
    return (await client.query(`SELECT project.id, project.project_code, project.name, project.priority AS project_priority, ${byLevel("task", openTask)}, count(*) FILTER (WHERE ${openTask})::int AS open
        ${tasks} GROUP BY project.id, project.project_code, project.name, project.priority ORDER BY project.project_code`, values)).rows
      .filter((row) => row.open > 0).map((row) => ({ projectId: row.id, projectCode: row.project_code, projectName: row.name, projectPriority: row.project_priority, open: row.open, ...levelsOf(row) }));
  }
  if (kind === "completed") {
    // The priority each task had when it was completed (from its history), not what it is now.
    const rows = (await client.query(`SELECT COALESCE(
          (SELECT event.details->>'to' FROM tenant.project_task_events event WHERE event.task_id = task.id AND event.action = 'PRIORITY_CHANGED' AND event.occurred_at <= task.completed_at ORDER BY event.occurred_at DESC LIMIT 1),
          (SELECT event.details->>'from' FROM tenant.project_task_events event WHERE event.task_id = task.id AND event.action = 'PRIORITY_CHANGED' AND event.occurred_at > task.completed_at ORDER BY event.occurred_at LIMIT 1),
          task.priority) AS priority, count(*)::int AS n
        ${tasks} AND task.status = 'DONE' AND task.completed_at IS NOT NULL GROUP BY 1`, values)).rows;
    return PRIORITY_LEVELS.map((level) => ({ priority: level.code, label: level.label, completed: rows.find((row) => row.priority === level.code)?.n ?? 0 }));
  }
  // changes: every recorded priority change on projects, milestones and tasks the person can see — who, when, from, to, why.
  const eventScope = filters.projectId ? ` AND event.project_id = $${values.length}` : "";
  const rows = (await client.query(`SELECT * FROM (
      SELECT 'PROJECT' AS entity, event.project_id AS entity_id, project.project_code AS code, project.name, project.project_code, event.details, event.actor_user_id, event.occurred_at
        FROM tenant.project_events event JOIN tenant.projects project ON project.id = event.project_id WHERE event.organization_id = $1 AND event.action = 'PRIORITY_CHANGED' AND ${visible}${eventScope}
      UNION ALL
      SELECT 'MILESTONE', milestone.id, milestone.milestone_code, milestone.name, project.project_code, event.details, event.actor_user_id, event.occurred_at
        FROM tenant.project_milestone_events event JOIN tenant.project_milestones milestone ON milestone.id = event.milestone_id JOIN tenant.projects project ON project.id = event.project_id
       WHERE event.organization_id = $1 AND event.action = 'PRIORITY_CHANGED' AND ${visible}${eventScope}
      UNION ALL
      SELECT 'TASK', task.id, task.task_code, task.title, project.project_code, event.details, event.actor_user_id, event.occurred_at
        FROM tenant.project_task_events event JOIN tenant.project_tasks task ON task.id = event.task_id JOIN tenant.projects project ON project.id = event.project_id
       WHERE event.organization_id = $1 AND event.action = 'PRIORITY_CHANGED' AND ${visible}${eventScope}) changes ORDER BY occurred_at DESC LIMIT 500`, values)).rows;
  const names = await userNames(client, rows.map((row) => row.actor_user_id));
  return rows.map((row) => ({ entity: row.entity, entityId: row.entity_id, code: row.code, name: row.name, projectCode: row.project_code, from: row.details?.from ?? null,
    to: row.details?.to ?? null, fromLabel: PRIORITY_LABEL[row.details?.from] ?? null, toLabel: PRIORITY_LABEL[row.details?.to] ?? null, reason: row.details?.reason ?? null,
    actor: names.get(row.actor_user_id) ?? null, at: row.occurred_at }));
}
