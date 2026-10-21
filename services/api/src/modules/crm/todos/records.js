// To-dos (CRM audit: "five overlapping next-action concepts"): a salesperson's tasks and follow-ups in one list — "Call Mr Sharma on
// Thursday" is a to-do with a type (Call, Visit, Meeting, WhatsApp, Email…), whichever table it lives in. Read only; each row opens its
// own task or follow-up page, and is completed there or through that page's own action. Each kind keeps its own visibility rule
// (tasks/access.js, follow-ups/access.js) and needs its own view permission.
import { CrmError } from "../data-management/errors.js";
import { orgDayStart } from "../data-management/org-date.js";
import { followUpCan, followUpScopeSql } from "../follow-ups/access.js";
import { FOLLOW_UP_PERMISSIONS } from "../follow-ups/constants.js";
import { taskCan, taskScopeSql } from "../tasks/access.js";
import { TASK_PERMISSIONS } from "../tasks/constants.js";

const OPEN = "('planned', 'in_progress', 'overdue')";
export const TODO_VIEWS = Object.freeze([
  { key: "mine", label: "My to-dos" }, { key: "overdue", label: "Overdue" }, { key: "today", label: "Due today" }, { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All open" },
]);

const RECORD_NAME = `CASE todo.entity_type
    WHEN 'lead' THEN (SELECT COALESCE(NULLIF(lead.full_name, ''), lead.company_name, lead.code) FROM tenant.crm_leads lead WHERE lead.organization_id = todo.organization_id AND lead.id = todo.entity_id)
    WHEN 'opportunity' THEN (SELECT deal.name FROM tenant.crm_opportunities deal WHERE deal.organization_id = todo.organization_id AND deal.id = todo.entity_id)
    WHEN 'party' THEN (SELECT party.display_name FROM tenant.business_parties party WHERE party.organization_id = todo.organization_id AND party.id = todo.entity_id)
    WHEN 'contact' THEN (SELECT btrim(person.first_name || ' ' || COALESCE(person.last_name, '')) FROM tenant.contacts person WHERE person.organization_id = todo.organization_id AND person.id = todo.entity_id)
  END`;
const RECORD_HREF = { lead: "/crm/leads/", opportunity: "/crm/opportunities/", party: "/crm/accounts/", contact: "/crm/contacts/" };

// filters: { view?, type? ("task" | a follow-up type code), search?, limit?, offset? }
export async function listTodos(client, context, filters = {}) {
  const tasks = taskCan(context, TASK_PERMISSIONS.view);
  const followUps = followUpCan(context, FOLLOW_UP_PERMISSIONS.view);
  if (!tasks && !followUps) throw new CrmError(403, "You do not have permission to view to-dos.", "PERMISSION_DENIED");
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const kinds = [
    ...(tasks ? [`(todo.activity_type = 'task'${taskScopeSql(context, values, "todo")})`] : []),
    ...(followUps ? [`(todo.activity_type = 'follow_up'${followUpScopeSql(context, values, "todo")})`] : []),
  ];
  const where = [`todo.organization_id = $1`, `todo.status IN ${OPEN}`, `(${kinds.join(" OR ")})`];
  // The organization's own day (its time zone), not the server's.
  const dayStart = orgDayStart("todo.organization_id");
  const view = TODO_VIEWS.some((entry) => entry.key === filters.view) ? filters.view : "mine";
  if (view === "mine") where.push(`todo.assigned_to = ${bind(context.userId)}`);
  if (view === "overdue") where.push(`todo.due_at < now()`);
  if (view === "today") where.push(`todo.due_at >= ${dayStart} AND todo.due_at < ${dayStart} + interval '1 day'`);
  if (view === "upcoming") where.push(`todo.due_at >= ${dayStart} + interval '1 day'`);
  if (filters.type === "task") where.push(`todo.activity_type = 'task'`);
  else if (filters.type) where.push(`todo.activity_type = 'follow_up' AND COALESCE(kind.code, todo.follow_up_type) = ${bind(String(filters.type))}`);
  const search = String(filters.search ?? "").trim().toLowerCase();
  if (search) where.push(`lower(todo.subject) LIKE ${bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`)}`);
  const from = `FROM tenant.crm_activities todo
    LEFT JOIN tenant.crm_activity_types kind ON kind.organization_id = todo.organization_id AND kind.id = todo.activity_type_id
    LEFT JOIN public.users assignee ON assignee.id = todo.assigned_to
   WHERE ${where.join(" AND ")}`;
  const total = (await client.query(`SELECT count(*)::int AS total ${from}`, values)).rows[0].total;
  const { rows } = await client.query(
    `SELECT todo.id, todo.activity_type, todo.subject, todo.due_at, todo.due_time_set, todo.priority, todo.status, todo.entity_type, todo.entity_id, todo.task_number, todo.follow_up_number,
            todo.updated_at, COALESCE(kind.name, initcap(replace(todo.follow_up_type, '_', ' '))) AS type_label, COALESCE(kind.code, todo.follow_up_type) AS type_code,
            assignee.full_name AS assignee_name, todo.assigned_to, (todo.due_at < now()) AS overdue, ${RECORD_NAME} AS record_name
       ${from} ORDER BY todo.due_at NULLS LAST, todo.created_at LIMIT ${limit} OFFSET ${offset}`, values);
  return {
    total, limit, offset, views: TODO_VIEWS,
    capabilities: { tasks, followUps, createTask: taskCan(context, TASK_PERMISSIONS.create), createFollowUp: followUpCan(context, FOLLOW_UP_PERMISSIONS.create) },
    todos: rows.map((row) => {
      const task = row.activity_type === "task";
      return {
        id: row.id, kind: task ? "task" : "follow_up", typeCode: task ? "task" : row.type_code, typeLabel: task ? "Task" : row.type_label ?? "Follow-up",
        number: task ? row.task_number : row.follow_up_number, subject: row.subject, dueAt: row.due_at, dueTimeSet: row.due_time_set, priority: row.priority,
        overdue: Boolean(row.overdue), assignedTo: row.assigned_to, assigneeName: row.assignee_name, updatedAt: row.updated_at,
        record: row.entity_id ? { type: row.entity_type, id: row.entity_id, name: row.record_name, href: RECORD_HREF[row.entity_type] ? `${RECORD_HREF[row.entity_type]}${row.entity_id}` : null } : null,
        href: task ? `/crm/tasks/${row.id}` : `/crm/follow-ups/${row.id}`,
      };
    }),
  };
}
