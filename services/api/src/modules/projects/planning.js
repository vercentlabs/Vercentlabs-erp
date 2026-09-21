// Planning and delivery (F197-F201, F203, F205-F207, F228): the cycle-safe WBS, tasks and sub-tasks,
// dependencies, milestones, critical-path scheduling, the Gantt / Kanban / calendar views over the same task
// state, progress roll-up, and approved baselines that freeze the plan the current one is compared to.
import {
  addDays, addWorkingDays, asDate, dateOrNull, dateRequired, diffDays, has, isBroad, isMember, iso, loadProject, loadSettings, need, needAny, nextNumber, nonNegative, oneOf, positive, ProjectError,
  qx, recordEvent, requiredText, textOrNull, today, uuid, uuidOrNull, assertOpen, workingDaysBetween,
} from "./common.js";

const STATUSES = ["todo", "in_progress", "blocked", "review", "done", "cancelled"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const MAX_DEPTH = 8;
const TRANSITIONS = {
  todo: ["in_progress", "blocked", "cancelled", "done"],
  in_progress: ["todo", "blocked", "review", "done", "cancelled"],
  blocked: ["in_progress", "todo", "cancelled"],
  review: ["in_progress", "done", "cancelled"],
  done: ["in_progress"],
  cancelled: ["todo"],
};

const finishFromStart = (start, days) => addWorkingDays(start, Math.max(days, 1) - 1);
function startFromFinish(finish, days) {
  let d = finish;
  while (asDate(d).getUTCDay() === 0 || asDate(d).getUTCDay() === 6) d = addDays(d, -1);
  let left = Math.max(days, 1) - 1;
  while (left > 0) { d = addDays(d, -1); if (![0, 6].includes(asDate(d).getUTCDay())) left -= 1; }
  return d;
}

// ------------------------------------------------------------------ helpers
async function loadTasks(client, c, projectId) {
  return (await qx(client, `SELECT t.*,u.full_name AS assignee_name FROM tenant.project_tasks t LEFT JOIN public.users u ON u.id=t.assignee_user_id WHERE t.organization_id=$1 AND t.project_id=$2 ORDER BY t.sort_order,t.created_at`, [c.organizationId, projectId])).rows;
}
async function loadDeps(client, c, projectId) {
  return (await client.query(`SELECT predecessor_task_id,successor_task_id,dependency_type,lag_days FROM tenant.project_task_dependencies WHERE organization_id=$1 AND project_id=$2`, [c.organizationId, projectId])).rows;
}
async function loadTask(client, c, taskId, { lock = false } = {}) {
  const t = (await qx(client, `SELECT * FROM tenant.project_tasks WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(taskId, "Task")])).rows[0];
  if (!t) throw new ProjectError(404, "Task was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, t.project_id, { lock });
  return { task: t, project: p };
}

const depthOf = (tasks, id) => { let d = 0; let cur = tasks.find((t) => t.id === id); while (cur?.parent_task_id) { d += 1; cur = tasks.find((t) => t.id === cur.parent_task_id); if (d > 50) break; } return d; };
const descendantsOf = (tasks, id) => { const out = new Set(); const walk = (p) => { for (const t of tasks) if (t.parent_task_id === p && !out.has(t.id)) { out.add(t.id); walk(t.id); } }; walk(id); return out; };

// WBS codes follow the tree: 1, 1.1, 1.2, 2 ... ordered by sort_order.
export async function renumberWbs(client, c, projectId) {
  const tasks = await loadTasks(client, c, projectId);
  const kids = new Map();
  for (const t of tasks) { const k = t.parent_task_id || "root"; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(t); }
  const walk = async (parent, prefix) => {
    const list = kids.get(parent) || [];
    for (let i = 0; i < list.length; i += 1) {
      const code = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      await client.query(`UPDATE tenant.project_tasks SET wbs_code=$2,sort_order=$3 WHERE id=$1 AND (wbs_code IS DISTINCT FROM $2 OR sort_order<>$3)`, [list[i].id, code, i + 1]);
      await walk(list[i].id, code);
    }
  };
  await walk("root", "");
}

// Roll progress up: a summary task follows its children (weighted by estimate), the project follows its top-level tasks.
export async function recalculateProgress(client, c, projectId) {
  const tasks = await loadTasks(client, c, projectId);
  const kids = new Map();
  for (const t of tasks) if (t.parent_task_id) { if (!kids.has(t.parent_task_id)) kids.set(t.parent_task_id, []); kids.get(t.parent_task_id).push(t); }
  const calc = new Map();
  const weight = (t) => (Number(t.estimated_hours) > 0 ? Number(t.estimated_hours) : 1);
  const value = (t) => {
    if (calc.has(t.id)) return calc.get(t.id);
    const ch = (kids.get(t.id) || []).filter((k) => k.status !== "cancelled");
    let pct;
    if (t.status === "cancelled") pct = null;
    else if (!ch.length) pct = t.status === "done" ? 100 : Number(t.percent_complete);
    else {
      let num = 0; let den = 0;
      for (const k of ch) { const kv = value(k); if (kv === null) continue; const w = weightTree(k); num += kv * w; den += w; }
      pct = den ? num / den : 0;
    }
    calc.set(t.id, pct);
    return pct;
  };
  const weightTree = (t) => { const ch = kids.get(t.id) || []; return ch.length ? ch.reduce((s, k) => s + weightTree(k), 0) : weight(t); };
  let num = 0; let den = 0;
  for (const t of tasks.filter((x) => !x.parent_task_id && x.status !== "cancelled")) { const v = value(t); if (v === null) continue; const w = weightTree(t); num += v * w; den += w; }
  for (const t of tasks) {
    const v = calc.get(t.id);
    if (v !== undefined && v !== null && kids.get(t.id)?.length) await client.query(`UPDATE tenant.project_tasks SET percent_complete=$2 WHERE id=$1`, [t.id, String(Math.round(v * 10000) / 10000)]);
  }
  const project = den ? Math.round((num / den) * 10000) / 10000 : 0;
  await client.query(`UPDATE tenant.projects SET percent_complete=LEAST(100,$2::numeric),updated_at=now() WHERE id=$1 AND status<>'completed'`, [projectId, String(project)]);
  return project;
}

// ------------------------------------------------------------------ tasks (F199, F200, F203)
export async function listProjectTasks(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (filters.projectId) add("t.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.status && filters.status !== "all") add("t.status=?", oneOf(filters.status, STATUSES, "Status"));
  if (filters.assigneeId) add("t.assignee_user_id=?", uuid(filters.assigneeId, "Assignee"));
  if (filters.mine === true || filters.mine === "true") add("t.assignee_user_id=?", c.userId);
  if (filters.milestoneId) add("t.milestone_id=?", uuid(filters.milestoneId, "Milestone"));
  if (filters.priority) add("t.priority=?", oneOf(filters.priority, PRIORITIES, "Priority"));
  if (filters.overdue === true || filters.overdue === "true") where.push("t.status NOT IN ('done','cancelled') AND t.planned_end_date<current_date");
  if (filters.search) add("(t.task_number ILIKE ? OR t.name ILIKE ? OR t.wbs_code ILIKE ?)", `%${String(filters.search).slice(0, 100)}%`);
  if (!isBroad(c)) add("(p.project_manager_id=? OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=? AND m.active=true))", c.userId);
  const res = await qx(client,
    `SELECT t.*,p.project_number,p.name AS project_name,u.full_name AS assignee_name,ms.name AS milestone_name,
       (SELECT count(*)::int FROM tenant.project_tasks ch WHERE ch.parent_task_id=t.id) AS child_count,
       COALESCE((SELECT sum(e.hours) FROM tenant.project_time_entries e WHERE e.task_id=t.id AND e.status='approved'),0)::float AS actual_hours
     FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
     LEFT JOIN public.users u ON u.id=t.assignee_user_id LEFT JOIN tenant.project_milestones ms ON ms.id=t.milestone_id
     WHERE t.organization_id=$1 AND p.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY p.project_number,t.sort_order,t.created_at LIMIT 800`, values);
  return res.rows;
}

export async function getProjectTask(client, c, taskId) {
  need(c, "projects.view");
  const { task, project } = await loadTask(client, c, taskId);
  const deps = await client.query(`SELECT d.*,pt.task_number AS predecessor_number,pt.name AS predecessor_name,st.task_number AS successor_number,st.name AS successor_name FROM tenant.project_task_dependencies d JOIN tenant.project_tasks pt ON pt.id=d.predecessor_task_id JOIN tenant.project_tasks st ON st.id=d.successor_task_id WHERE d.organization_id=$1 AND (d.predecessor_task_id=$2 OR d.successor_task_id=$2)`, [c.organizationId, task.id]);
  const children = await qx(client, `SELECT id,task_number,name,status,percent_complete,wbs_code FROM tenant.project_tasks WHERE organization_id=$1 AND parent_task_id=$2 ORDER BY sort_order`, [c.organizationId, task.id]);
  const comments = await qx(client, `SELECT cm.*,u.full_name AS author_name FROM tenant.project_comments cm LEFT JOIN public.users u ON u.id=cm.author_user_id WHERE cm.organization_id=$1 AND cm.entity_type='task' AND cm.entity_id=$2 AND cm.deleted_at IS NULL ORDER BY cm.created_at`, [c.organizationId, task.id]);
  return { task, project: { id: project.id, project_number: project.project_number, name: project.name, status: project.status }, dependencies: deps.rows, children: children.rows, comments: comments.rows };
}

async function requireAssignee(client, c, projectId, userId) {
  if (!userId) return;
  if (!(await isMember(client, c, projectId, userId))) throw new ProjectError(409, "A task can only be assigned to someone on the project team.", "PROJECT_ASSIGNEE_INVALID");
}

export async function createProjectTaskRecord(client, c, projectId, input) {
  need(c, "projects.tasks.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  assertOpen(p, "add tasks");
  const tasks = await loadTasks(client, c, p.id);
  const parentId = uuidOrNull(input.parentTaskId, "Parent task");
  let parent = null;
  if (parentId) {
    parent = tasks.find((t) => t.id === parentId);
    if (!parent) throw new ProjectError(409, "The parent task is not in this project.", "PROJECT_REFERENCE_INVALID");
    if (["done", "cancelled"].includes(parent.status)) throw new ProjectError(409, "A finished or cancelled task cannot get new sub-tasks; reopen it first.", "PROJECT_STATE_INVALID");
    if (depthOf(tasks, parentId) + 1 >= MAX_DEPTH) throw new ProjectError(409, `The WBS cannot go deeper than ${MAX_DEPTH} levels.`, "PROJECT_WBS_TOO_DEEP");
  }
  const milestoneId = uuidOrNull(input.milestoneId, "Milestone");
  if (milestoneId) {
    const m = await client.query(`SELECT status FROM tenant.project_milestones WHERE id=$1 AND project_id=$2`, [milestoneId, p.id]);
    if (!m.rows[0]) throw new ProjectError(409, "The milestone is not in this project.", "PROJECT_REFERENCE_INVALID");
    if (["completed", "cancelled"].includes(m.rows[0].status)) throw new ProjectError(409, "Work cannot be added to a completed or cancelled milestone.", "PROJECT_STATE_INVALID");
  }
  const assignee = uuidOrNull(input.assigneeUserId, "Assignee");
  await requireAssignee(client, c, p.id, assignee);
  const start = dateOrNull(input.plannedStartDate, "Planned start");
  let end = dateOrNull(input.plannedEndDate, "Planned end");
  const duration = input.durationDays === undefined || input.durationDays === "" ? null : Math.round(nonNegative(input.durationDays, "Duration"));
  if (start && !end && duration !== null) end = finishFromStart(start, duration);
  if (start && end && end < start) throw new ProjectError(400, "The planned end cannot be before the start.", "PROJECT_DATE_INVALID");
  const billable = p.project_type === "internal" ? false : input.billable === true;
  const number = await nextNumber(client, c, `project_task:${p.id}`, "TASK");
  const siblings = tasks.filter((t) => (t.parent_task_id || null) === parentId).length;
  const res = await qx(client,
    `INSERT INTO tenant.project_tasks(organization_id,project_id,milestone_id,parent_task_id,task_number,name,description,status,priority,assignee_user_id,planned_start_date,planned_end_date,estimated_hours,billable,created_by,duration_days,sort_order,percent_complete)
     VALUES($1,$2,$3,$4,$5,$6,$7,'todo',$8,$9,$10,$11,$12,$13,$14,$15,$16,0) RETURNING *`,
    [c.organizationId, p.id, milestoneId, parentId, number, requiredText(input.name, "Name", 300), textOrNull(input.description, 3000), oneOf(input.priority || "normal", PRIORITIES, "Priority"), assignee, start, end, String(nonNegative(input.estimatedHours, "Estimated hours")), billable, c.userId, duration, siblings + 1]);
  await renumberWbs(client, c, p.id);
  await recalculateProgress(client, c, p.id);
  await recordEvent(client, c, "task", res.rows[0].id, "project.task.created", { projectId: p.id });
  return (await qx(client, `SELECT * FROM tenant.project_tasks WHERE id=$1`, [res.rows[0].id])).rows[0];
}

export async function updateProjectTaskRecord(client, c, taskId, input) {
  need(c, "projects.tasks.manage");
  const { task, project } = await loadTask(client, c, taskId, { lock: true });
  assertOpen(project, "edit tasks");
  const tasks = await loadTasks(client, c, project.id);
  const sets = [];
  const vals = [task.id];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (input.name !== undefined) set("name", requiredText(input.name, "Name", 300));
  if (input.description !== undefined) set("description", textOrNull(input.description, 3000));
  if (input.priority !== undefined) set("priority", oneOf(input.priority, PRIORITIES, "Priority"));
  if (input.estimatedHours !== undefined) set("estimated_hours", String(nonNegative(input.estimatedHours, "Estimated hours")));
  if (input.billable !== undefined) set("billable", project.project_type === "internal" ? false : Boolean(input.billable));
  if (input.milestoneId !== undefined) {
    const m = uuidOrNull(input.milestoneId, "Milestone");
    if (m) {
      const row = await client.query(`SELECT status FROM tenant.project_milestones WHERE id=$1 AND project_id=$2`, [m, project.id]);
      if (!row.rows[0]) throw new ProjectError(409, "The milestone is not in this project.", "PROJECT_REFERENCE_INVALID");
      if (["completed", "cancelled"].includes(row.rows[0].status)) throw new ProjectError(409, "Work cannot be moved into a completed or cancelled milestone.", "PROJECT_STATE_INVALID");
    }
    set("milestone_id", m);
  }
  if (input.assigneeUserId !== undefined) {
    const a = uuidOrNull(input.assigneeUserId, "Assignee");
    await requireAssignee(client, c, project.id, a);
    set("assignee_user_id", a);
  }
  let reparent = false;
  if (input.parentTaskId !== undefined) {
    const parentId = uuidOrNull(input.parentTaskId, "Parent task");
    if (parentId) {
      if (parentId === task.id || descendantsOf(tasks, task.id).has(parentId)) throw new ProjectError(400, "A task cannot be moved under itself or one of its own sub-tasks.", "PROJECT_WBS_CYCLE");
      if (!tasks.find((t) => t.id === parentId)) throw new ProjectError(409, "The parent task is not in this project.", "PROJECT_REFERENCE_INVALID");
      const subtreeHeight = Math.max(0, ...[...descendantsOf(tasks, task.id)].map((d) => depthOf(tasks, d) - depthOf(tasks, task.id)));
      if (depthOf(tasks, parentId) + 1 + subtreeHeight >= MAX_DEPTH) throw new ProjectError(409, `The WBS cannot go deeper than ${MAX_DEPTH} levels.`, "PROJECT_WBS_TOO_DEEP");
    }
    set("parent_task_id", parentId);
    reparent = true;
  }
  const start = input.plannedStartDate !== undefined ? dateOrNull(input.plannedStartDate, "Planned start") : task.planned_start_date;
  let end = input.plannedEndDate !== undefined ? dateOrNull(input.plannedEndDate, "Planned end") : task.planned_end_date;
  const duration = input.durationDays !== undefined ? (input.durationDays === "" || input.durationDays === null ? null : Math.round(nonNegative(input.durationDays, "Duration"))) : task.duration_days;
  if (input.durationDays !== undefined && start && input.plannedEndDate === undefined && duration !== null) end = finishFromStart(start, duration);
  if (start && end && end < start) throw new ProjectError(400, "The planned end cannot be before the start.", "PROJECT_DATE_INVALID");
  if (input.plannedStartDate !== undefined) set("planned_start_date", start);
  if (input.plannedStartDate !== undefined || input.plannedEndDate !== undefined || input.durationDays !== undefined) set("planned_end_date", end);
  if (input.durationDays !== undefined) set("duration_days", duration);
  if (!sets.length) return task;
  const res = await qx(client, `UPDATE tenant.project_tasks SET ${sets.join(",")},updated_at=now(),updated_by=$${vals.length + 1} WHERE id=$1 RETURNING *`, [...vals, c.userId]);
  if (reparent) await renumberWbs(client, c, project.id);
  await recalculateProgress(client, c, project.id);
  await recordEvent(client, c, "task", task.id, "project.task.updated", { fields: sets.length });
  return res.rows[0];
}

// Status change: the Kanban move, the task form and the assignee's own update all go through here.
export async function changeTaskStatus(client, c, taskId, input) {
  const { task, project } = await loadTask(client, c, taskId, { lock: true });
  const own = task.assignee_user_id === c.userId;
  if (!own) need(c, "projects.tasks.manage");
  else if (!has(c, "projects.tasks.manage") && !has(c, "projects.view")) need(c, "projects.tasks.manage");
  assertOpen(project, "change task status");
  const to = oneOf(input.status, STATUSES, "Status");
  if (to === task.status) return task;
  if (!TRANSITIONS[task.status].includes(to)) throw new ProjectError(409, `A ${task.status.replace("_", " ")} task cannot move to ${to.replace("_", " ")}.`, "PROJECT_STATE_INVALID");
  const tasks = await loadTasks(client, c, project.id);
  const kids = tasks.filter((t) => t.parent_task_id === task.id);
  if (to === "blocked" && !textOrNull(input.reason, 500)) throw new ProjectError(400, "Say why the task is blocked.", "PROJECT_FIELD_REQUIRED");
  if (to === "in_progress" && !kids.length) {
    const deps = (await loadDeps(client, c, project.id)).filter((d) => d.successor_task_id === task.id && ["finish_to_start", "finish_to_finish"].includes(d.dependency_type) && d.dependency_type === "finish_to_start");
    const open = deps.filter((d) => !["done", "cancelled"].includes(tasks.find((t) => t.id === d.predecessor_task_id)?.status));
    if (open.length && input.overrideDependencies !== true) throw new ProjectError(409, `${open.length} predecessor task(s) must finish before this one starts.`, "PROJECT_DEPENDENCY_OPEN");
    if (input.overrideDependencies === true) need(c, "projects.manage");
  }
  if (to === "done" && kids.some((k) => !["done", "cancelled"].includes(k.status))) throw new ProjectError(409, "Finish or cancel the sub-tasks first.", "PROJECT_CHILDREN_OPEN");
  if (to === "in_progress" && task.parent_task_id) {
    const parent = tasks.find((t) => t.id === task.parent_task_id);
    if (parent && ["done", "cancelled"].includes(parent.status)) throw new ProjectError(409, "The parent task is finished; reopen it first.", "PROJECT_STATE_INVALID");
  }
  const res = await qx(client,
    `UPDATE tenant.project_tasks SET status=$2,blocked_reason=CASE WHEN $2='blocked' THEN $3 ELSE NULL END,
       actual_start_at=CASE WHEN $2='in_progress' THEN COALESCE(actual_start_at,now()) ELSE actual_start_at END,
       actual_end_at=CASE WHEN $2='done' THEN now() WHEN $4='done' THEN NULL ELSE actual_end_at END,
       completed_at=CASE WHEN $2='done' THEN now() WHEN $4='done' THEN NULL ELSE completed_at END,
       percent_complete=CASE WHEN $2='done' THEN 100 WHEN $4='done' THEN LEAST(percent_complete,99) ELSE percent_complete END,updated_at=now(),updated_by=$5 WHERE id=$1 RETURNING *`,
    [task.id, to, textOrNull(input.reason, 500), task.status, c.userId]);
  if (task.parent_task_id && to === "in_progress") await client.query(`UPDATE tenant.project_tasks SET status='in_progress',actual_start_at=COALESCE(actual_start_at,now()) WHERE id=$1 AND status='todo'`, [task.parent_task_id]);
  await recalculateProgress(client, c, project.id);
  await recordEvent(client, c, "task", task.id, "project.task.status", { from: task.status, to });
  return res.rows[0];
}

export async function setTaskProgress(client, c, taskId, percent) {
  const { task, project } = await loadTask(client, c, taskId, { lock: true });
  if (task.assignee_user_id !== c.userId) need(c, "projects.tasks.manage");
  assertOpen(project, "update progress");
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ProjectError(400, "Progress must be between 0 and 100.", "PROJECT_NUMBER_INVALID");
  const kids = (await client.query(`SELECT count(*)::int AS n FROM tenant.project_tasks WHERE parent_task_id=$1`, [task.id])).rows[0].n;
  if (kids) throw new ProjectError(409, "A summary task's progress comes from its sub-tasks.", "PROJECT_STATE_INVALID");
  if (["done", "cancelled"].includes(task.status)) throw new ProjectError(409, "A finished or cancelled task's progress is fixed.", "PROJECT_STATE_INVALID");
  const res = await qx(client, `UPDATE tenant.project_tasks SET percent_complete=$2,status=CASE WHEN status='todo' AND $2::numeric>0 THEN 'in_progress' ELSE status END,actual_start_at=CASE WHEN $2::numeric>0 THEN COALESCE(actual_start_at,now()) ELSE actual_start_at END,updated_at=now() WHERE id=$1 RETURNING *`, [task.id, String(n)]);
  await recalculateProgress(client, c, project.id);
  return res.rows[0];
}

export async function deleteProjectTask(client, c, taskId) {
  need(c, "projects.tasks.manage");
  const { task, project } = await loadTask(client, c, taskId, { lock: true });
  assertOpen(project, "delete tasks");
  const used = await client.query(`SELECT (SELECT count(*) FROM tenant.project_time_entries WHERE task_id=$1)+(SELECT count(*) FROM tenant.project_expenses WHERE task_id=$1)+(SELECT count(*) FROM tenant.project_materials WHERE task_id=$1)+(SELECT count(*) FROM tenant.project_tasks WHERE parent_task_id=$1) AS n`, [task.id]);
  if (Number(used.rows[0].n) > 0) throw new ProjectError(409, "A task with sub-tasks, time, expenses or materials cannot be deleted; cancel it instead.", "PROJECT_TASK_IN_USE");
  await client.query(`DELETE FROM tenant.project_tasks WHERE id=$1`, [task.id]);
  await renumberWbs(client, c, project.id);
  await recalculateProgress(client, c, project.id);
  await recordEvent(client, c, "project", project.id, "project.task.deleted", { taskNumber: task.task_number });
  return { ok: true };
}

// ------------------------------------------------------------------ dependencies (F201)
export async function addTaskDependency(client, c, input) {
  need(c, "projects.tasks.manage");
  const pred = await loadTask(client, c, input.predecessorTaskId, { lock: true });
  const succ = await loadTask(client, c, input.successorTaskId, { lock: true });
  if (pred.task.project_id !== succ.task.project_id) throw new ProjectError(409, "Dependencies stay inside one project.", "PROJECT_REFERENCE_INVALID");
  assertOpen(pred.project, "change dependencies");
  if (pred.task.id === succ.task.id) throw new ProjectError(400, "A task cannot depend on itself.", "PROJECT_DEPENDENCY_CYCLE");
  const type = oneOf(input.dependencyType || "finish_to_start", ["finish_to_start", "start_to_start", "finish_to_finish", "start_to_finish"], "Dependency type");
  const lag = Math.round(Number(input.lagDays || 0));
  if (!Number.isFinite(lag) || Math.abs(lag) > 365) throw new ProjectError(400, "Lag must be between -365 and 365 days.", "PROJECT_NUMBER_INVALID");
  const tasks = await loadTasks(client, c, pred.task.project_id);
  if (descendantsOf(tasks, pred.task.id).has(succ.task.id) || descendantsOf(tasks, succ.task.id).has(pred.task.id)) throw new ProjectError(409, "A task cannot depend on its own parent or sub-task; the parent already spans its children.", "PROJECT_DEPENDENCY_HIERARCHY");
  const deps = await loadDeps(client, c, pred.task.project_id);
  if (deps.some((d) => d.predecessor_task_id === pred.task.id && d.successor_task_id === succ.task.id)) throw new ProjectError(409, "That dependency already exists.", "PROJECT_DUPLICATE");
  // a cycle exists if the predecessor is already reachable from the successor
  const next = new Map();
  for (const d of deps) { if (!next.has(d.predecessor_task_id)) next.set(d.predecessor_task_id, []); next.get(d.predecessor_task_id).push(d.successor_task_id); }
  const seen = new Set();
  const stack = [succ.task.id];
  while (stack.length) {
    const n = stack.pop();
    if (n === pred.task.id) throw new ProjectError(409, "That dependency would create a loop in the schedule.", "PROJECT_DEPENDENCY_CYCLE");
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of next.get(n) || []) stack.push(m);
  }
  await client.query(`INSERT INTO tenant.project_task_dependencies(organization_id,project_id,predecessor_task_id,successor_task_id,dependency_type,lag_days) VALUES($1,$2,$3,$4,$5,$6)`, [c.organizationId, pred.task.project_id, pred.task.id, succ.task.id, type, lag]);
  await recordEvent(client, c, "task", succ.task.id, "project.dependency.added", { predecessor: pred.task.task_number, type });
  return { predecessorTaskId: pred.task.id, successorTaskId: succ.task.id, dependencyType: type, lagDays: lag };
}

export async function removeTaskDependency(client, c, predecessorTaskId, successorTaskId) {
  need(c, "projects.tasks.manage");
  const { project } = await loadTask(client, c, successorTaskId, { lock: true });
  assertOpen(project, "change dependencies");
  const res = await client.query(`DELETE FROM tenant.project_task_dependencies WHERE organization_id=$1 AND predecessor_task_id=$2 AND successor_task_id=$3 RETURNING 1`, [c.organizationId, uuid(predecessorTaskId, "Predecessor"), uuid(successorTaskId, "Successor")]);
  if (!res.rows[0]) throw new ProjectError(404, "That dependency does not exist.", "PROJECT_NOT_FOUND");
  return { ok: true };
}

// ------------------------------------------------------------------ milestones (F198)
export async function listProjectMilestones(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  if (filters.projectId) { values.push(uuid(filters.projectId, "Project")); where.push(`m.project_id=$${values.length}`); }
  if (filters.status) { values.push(String(filters.status)); where.push(`m.status=$${values.length}`); }
  if (!isBroad(c)) { values.push(c.userId); where.push(`(p.project_manager_id=$${values.length} OR EXISTS (SELECT 1 FROM tenant.project_members mm WHERE mm.project_id=p.id AND mm.user_id=$${values.length} AND mm.active=true))`); }
  const res = await qx(client,
    `SELECT m.*,p.project_number,p.name AS project_name,
       (SELECT count(*)::int FROM tenant.project_tasks t WHERE t.milestone_id=m.id) AS task_count,
       (SELECT count(*)::int FROM tenant.project_tasks t WHERE t.milestone_id=m.id AND t.status NOT IN ('done','cancelled')) AS open_tasks
     FROM tenant.project_milestones m JOIN tenant.projects p ON p.id=m.project_id AND p.organization_id=m.organization_id
     WHERE m.organization_id=$1 AND p.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY p.project_number,m.sequence LIMIT 500`, values);
  return res.rows;
}

export async function saveProjectMilestone(client, c, projectId, input) {
  need(c, "projects.milestones.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  assertOpen(p, "change milestones");
  const id = uuidOrNull(input.id, "Milestone");
  const name = requiredText(input.name, "Name", 300);
  const date = dateOrNull(input.plannedDate, "Planned date");
  const trigger = input.billingTrigger === true;
  const amount = nonNegative(input.billingAmount, "Billing amount");
  if (trigger && p.project_type === "internal") throw new ProjectError(400, "An internal project has nothing to bill.", "PROJECT_TYPE_INVALID");
  if (trigger && amount <= 0) throw new ProjectError(400, "A billing milestone needs a billing amount.", "PROJECT_NUMBER_INVALID");
  if (trigger) {
    const others = (await client.query(`SELECT COALESCE(sum(billing_amount),0)::text AS s FROM tenant.project_milestones WHERE project_id=$1 AND billing_trigger=true AND status<>'cancelled' AND ($2::uuid IS NULL OR id<>$2)`, [p.id, id])).rows[0].s;
    if (Number(others) + amount > Number(p.contracted_revenue) + 0.0001) throw new ProjectError(409, "Milestone billing would exceed the contracted revenue.", "PROJECT_BILLING_EXCEEDS_CONTRACT");
  }
  const owner = uuidOrNull(input.ownerUserId, "Owner");
  if (owner) await requireAssignee(client, c, p.id, owner);
  if (id) {
    const cur = (await qx(client, `SELECT * FROM tenant.project_milestones WHERE id=$1 AND project_id=$2 FOR UPDATE`, [id, p.id])).rows[0];
    if (!cur) throw new ProjectError(404, "Milestone was not found.", "PROJECT_NOT_FOUND");
    if (["completed", "cancelled"].includes(cur.status)) throw new ProjectError(409, `A ${cur.status} milestone can no longer be edited.`, "PROJECT_STATE_INVALID");
    const billed = await client.query(`SELECT 1 FROM tenant.project_billing_milestones WHERE milestone_id=$1 AND status<>'cancelled'`, [id]);
    if (billed.rows[0] && (Number(cur.billing_amount) !== amount || cur.billing_trigger !== trigger)) throw new ProjectError(409, "This milestone already has a billing line; cancel that first.", "PROJECT_MILESTONE_BILLED");
    return (await qx(client, `UPDATE tenant.project_milestones SET name=$3,description=$4,planned_date=$5,billing_trigger=$6,billing_amount=$7,owner_user_id=$8,updated_at=now() WHERE id=$1 AND project_id=$2 RETURNING *`, [id, p.id, name, textOrNull(input.description, 2000), date, trigger, String(amount), owner])).rows[0];
  }
  const seq = (await client.query(`SELECT COALESCE(max(sequence),0)+1 AS n FROM tenant.project_milestones WHERE project_id=$1`, [p.id])).rows[0].n;
  const res = await qx(client, `INSERT INTO tenant.project_milestones(organization_id,project_id,sequence,name,description,planned_date,billing_trigger,billing_amount,owner_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [c.organizationId, p.id, seq, name, textOrNull(input.description, 2000), date, trigger, String(amount), owner]);
  await recordEvent(client, c, "milestone", res.rows[0].id, "project.milestone.created", { projectId: p.id });
  return res.rows[0];
}

export async function setMilestoneStatus(client, c, milestoneId, action, input = {}) {
  need(c, "projects.milestones.manage");
  const m = (await qx(client, `SELECT * FROM tenant.project_milestones WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(milestoneId, "Milestone")])).rows[0];
  if (!m) throw new ProjectError(404, "Milestone was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, m.project_id, { lock: true });
  assertOpen(p, "change milestones");
  if (action === "complete") {
    if (["completed", "cancelled"].includes(m.status)) throw new ProjectError(409, `The milestone is already ${m.status}.`, "PROJECT_STATE_INVALID");
    const open = await client.query(`SELECT count(*)::int AS n FROM tenant.project_tasks WHERE milestone_id=$1 AND status NOT IN ('done','cancelled')`, [m.id]);
    if (open.rows[0].n > 0) throw new ProjectError(409, `${open.rows[0].n} task(s) in this milestone are not finished.`, "PROJECT_MILESTONE_OPEN_WORK");
    return (await qx(client, `UPDATE tenant.project_milestones SET status='completed',completed_date=$2,updated_at=now() WHERE id=$1 RETURNING *`, [m.id, dateOrNull(input.completedDate, "Completed date") || today()])).rows[0];
  }
  if (action === "reopen") {
    if (m.status !== "completed") throw new ProjectError(409, "Only a completed milestone can be reopened.", "PROJECT_STATE_INVALID");
    const billed = await client.query(`SELECT 1 FROM tenant.project_billing_milestones WHERE milestone_id=$1 AND status IN ('ready','requested','invoiced')`, [m.id]);
    if (billed.rows[0]) throw new ProjectError(409, "This milestone has a billing line; cancel it before reopening.", "PROJECT_MILESTONE_BILLED");
    return (await qx(client, `UPDATE tenant.project_milestones SET status='in_progress',completed_date=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [m.id])).rows[0];
  }
  if (action === "cancel") {
    if (["completed", "cancelled"].includes(m.status)) throw new ProjectError(409, `The milestone is already ${m.status}.`, "PROJECT_STATE_INVALID");
    requiredText(input.reason, "Reason", 500);
    const billed = await client.query(`SELECT 1 FROM tenant.project_billing_milestones WHERE milestone_id=$1 AND status<>'cancelled'`, [m.id]);
    if (billed.rows[0]) throw new ProjectError(409, "Cancel the milestone's billing line first.", "PROJECT_MILESTONE_BILLED");
    await client.query(`UPDATE tenant.project_tasks SET milestone_id=NULL WHERE milestone_id=$1`, [m.id]);
    return (await qx(client, `UPDATE tenant.project_milestones SET status='cancelled',updated_at=now() WHERE id=$1 RETURNING *`, [m.id])).rows[0];
  }
  throw new ProjectError(400, "Unsupported milestone action.", "PROJECT_VALUE_INVALID");
}

// ------------------------------------------------------------------ scheduling (F197, F205)
// Pure critical-path maths over leaf tasks. Exported for direct testing.
export function computeSchedule({ tasks, deps, projectStart }) {
  const dur = (t) => Math.max(t.duration_days ?? (t.planned_start_date && t.planned_end_date ? workingDaysBetween(t.planned_start_date, t.planned_end_date) : 1), 1);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const preds = new Map(tasks.map((t) => [t.id, []]));
  const succs = new Map(tasks.map((t) => [t.id, []]));
  for (const d of deps) if (byId.has(d.predecessor_task_id) && byId.has(d.successor_task_id)) { preds.get(d.successor_task_id).push(d); succs.get(d.predecessor_task_id).push(d); }
  const order = [];
  const indeg = new Map(tasks.map((t) => [t.id, preds.get(t.id).length]));
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const d of succs.get(id)) { indeg.set(d.successor_task_id, indeg.get(d.successor_task_id) - 1); if (indeg.get(d.successor_task_id) === 0) queue.push(d.successor_task_id); }
  }
  if (order.length !== tasks.length) throw new ProjectError(409, "The schedule contains a dependency loop.", "PROJECT_DEPENDENCY_CYCLE");
  const es = new Map(); const ef = new Map();
  for (const id of order) {
    const t = byId.get(id);
    const d = dur(t);
    let start = addWorkingDays(projectStart, 0);
    let finishMin = null;
    for (const dep of preds.get(id)) {
      const pf = ef.get(dep.predecessor_task_id); const ps = es.get(dep.predecessor_task_id);
      const lag = Number(dep.lag_days || 0);
      if (dep.dependency_type === "finish_to_start") { const s = addWorkingDays(pf, 1 + lag); if (s > start) start = s; }
      else if (dep.dependency_type === "start_to_start") { const s = lag >= 0 ? addWorkingDays(ps, lag) : startFromFinish(addDays(ps, lag), 1); if (s > start) start = s; }
      else if (dep.dependency_type === "finish_to_finish") { const f = lag >= 0 ? addWorkingDays(pf, lag) : addDays(pf, lag); if (!finishMin || f > finishMin) finishMin = f; }
      else if (dep.dependency_type === "start_to_finish") { const f = lag >= 0 ? addWorkingDays(ps, lag) : addDays(ps, lag); if (!finishMin || f > finishMin) finishMin = f; }
    }
    let finish = finishFromStart(start, d);
    if (finishMin && finishMin > finish) { finish = finishMin; start = startFromFinish(finish, d); }
    es.set(id, start); ef.set(id, finish);
  }
  const projectEnd = [...ef.values()].reduce((a, b) => (b > a ? b : a), projectStart);
  const ls = new Map(); const lf = new Map();
  for (const id of [...order].reverse()) {
    const t = byId.get(id);
    const d = dur(t);
    let latestFinish = projectEnd;
    for (const dep of succs.get(id)) {
      const ss = ls.get(dep.successor_task_id); const sf = lf.get(dep.successor_task_id);
      const lag = Number(dep.lag_days || 0);
      let bound = null;
      if (dep.dependency_type === "finish_to_start") bound = startFromFinish(addDays(ss, -1 - lag), 1);
      else if (dep.dependency_type === "finish_to_finish") bound = addDays(sf, -lag);
      if (bound && bound < latestFinish) latestFinish = bound;
    }
    lf.set(id, latestFinish);
    ls.set(id, startFromFinish(latestFinish, d));
  }
  const rows = order.map((id) => {
    const t = byId.get(id);
    const floatDays = Math.max(0, workingDaysBetween(es.get(id), ls.get(id)) - 1);
    return { taskId: id, taskNumber: t.task_number, name: t.name, start: es.get(id), finish: ef.get(id), lateStart: ls.get(id), lateFinish: lf.get(id), floatDays, critical: floatDays === 0, durationDays: dur(t) };
  });
  return { rows, projectEnd, criticalPath: rows.filter((r) => r.critical).map((r) => r.taskNumber) };
}

export async function scheduleProject(client, c, projectId, input = {}) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId, { lock: input.apply === true });
  const all = await loadTasks(client, c, p.id);
  const parents = new Set(all.filter((t) => t.parent_task_id).map((t) => t.parent_task_id));
  const leaves = all.filter((t) => !parents.has(t.id) && t.status !== "cancelled");
  const deps = await loadDeps(client, c, p.id);
  const start = dateOrNull(input.startDate, "Start") || p.planned_start_date || today();
  const result = computeSchedule({ tasks: leaves, deps, projectStart: start });
  let applied = 0;
  if (input.apply === true) {
    need(c, "projects.tasks.manage");
    assertOpen(p, "reschedule");
    for (const r of result.rows) {
      const t = leaves.find((x) => x.id === r.taskId);
      if (t.status === "done") continue;
      await client.query(`UPDATE tenant.project_tasks SET planned_start_date=$2,planned_end_date=$3,duration_days=COALESCE(duration_days,$4),updated_at=now() WHERE id=$1`, [t.id, r.start, r.finish, r.durationDays]);
      applied += 1;
    }
    // summary tasks span their children
    for (const t of all.filter((x) => parents.has(x.id))) {
      const span = await qx(client, `WITH RECURSIVE d AS (SELECT id FROM tenant.project_tasks WHERE parent_task_id=$1 UNION ALL SELECT c.id FROM tenant.project_tasks c JOIN d ON c.parent_task_id=d.id) SELECT min(planned_start_date) AS s,max(planned_end_date) AS e FROM tenant.project_tasks WHERE id IN (SELECT id FROM d)`, [t.id]);
      await client.query(`UPDATE tenant.project_tasks SET planned_start_date=$2,planned_end_date=$3 WHERE id=$1`, [t.id, span.rows[0].s, span.rows[0].e]);
    }
    if (result.rows.length) await client.query(`UPDATE tenant.projects SET planned_start_date=COALESCE(planned_start_date,$2),planned_end_date=$3,updated_at=now() WHERE id=$1`, [p.id, start, result.projectEnd]);
    await recordEvent(client, c, "project", p.id, "project.rescheduled", { tasks: applied, end: result.projectEnd });
  }
  return { ...result, applied };
}

export async function getScheduleConflicts(client, c, projectId) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  const tasks = await loadTasks(client, c, p.id);
  const deps = await loadDeps(client, c, p.id);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const conflicts = [];
  for (const d of deps) {
    const a = byId.get(d.predecessor_task_id); const b = byId.get(d.successor_task_id);
    if (!a || !b || !a.planned_end_date || !b.planned_start_date) continue;
    if (d.dependency_type === "finish_to_start" && b.planned_start_date <= a.planned_end_date) conflicts.push({ type: "dependency", message: `${b.task_number} starts on or before ${a.task_number} finishes`, predecessor: a.task_number, successor: b.task_number });
  }
  for (const t of tasks) if (t.planned_end_date && p.planned_end_date && t.planned_end_date > p.planned_end_date && t.status !== "cancelled") conflicts.push({ type: "beyond_project_end", message: `${t.task_number} ends after the project's planned end`, task: t.task_number });
  return { conflicts };
}

export async function getProjectWbs(client, c, projectId) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  const tasks = await qx(client, `SELECT t.*,u.full_name AS assignee_name,COALESCE((SELECT sum(e.hours) FROM tenant.project_time_entries e WHERE e.task_id=t.id AND e.status='approved'),0)::float AS actual_hours FROM tenant.project_tasks t LEFT JOIN public.users u ON u.id=t.assignee_user_id WHERE t.organization_id=$1 AND t.project_id=$2 ORDER BY t.sort_order,t.created_at`, [c.organizationId, p.id]);
  const all = tasks.rows;
  const kids = new Map();
  for (const t of all) { const k = t.parent_task_id || "root"; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(t); }
  const build = (parent, depth) => (kids.get(parent) || []).map((t) => ({ ...t, depth, children: build(t.id, depth + 1) }));
  const roll = (node) => { if (!node.children.length) return { hours: Number(node.estimated_hours), actual: Number(node.actual_hours) }; const r = node.children.map(roll); node.rollup_hours = r.reduce((s, x) => s + x.hours, 0); node.rollup_actual = r.reduce((s, x) => s + x.actual, 0); return { hours: node.rollup_hours, actual: node.rollup_actual }; };
  const tree = build("root", 0);
  tree.forEach(roll);
  return { project: { id: p.id, project_number: p.project_number, name: p.name, percent_complete: p.percent_complete }, tree, taskCount: all.length };
}

// ------------------------------------------------------------------ views over the same tasks (F205-F207)
export async function getGanttData(client, c, projectId) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  const tasks = await loadTasks(client, c, p.id);
  const deps = await loadDeps(client, c, p.id);
  const ms = await qx(client, `SELECT * FROM tenant.project_milestones WHERE organization_id=$1 AND project_id=$2 ORDER BY sequence`, [c.organizationId, p.id]);
  let critical = new Set();
  try {
    const parents = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id));
    const leaves = tasks.filter((t) => !parents.has(t.id) && t.status !== "cancelled");
    if (leaves.length) critical = new Set(computeSchedule({ tasks: leaves, deps, projectStart: p.planned_start_date || today() }).rows.filter((r) => r.critical).map((r) => r.taskId));
  } catch { critical = new Set(); }
  return {
    project: { id: p.id, project_number: p.project_number, name: p.name, start: p.planned_start_date, end: p.planned_end_date, percent_complete: p.percent_complete },
    today: today(),
    tasks: tasks.map((t) => ({ id: t.id, wbs: t.wbs_code, number: t.task_number, name: t.name, parentId: t.parent_task_id, start: t.planned_start_date, end: t.planned_end_date, baselineStart: t.baseline_start, baselineEnd: t.baseline_end, progress: Number(t.percent_complete), status: t.status, assignee: t.assignee_name, critical: critical.has(t.id) })),
    dependencies: deps.map((d) => ({ from: d.predecessor_task_id, to: d.successor_task_id, type: d.dependency_type, lag: d.lag_days })),
    milestones: ms.rows.map((m) => ({ id: m.id, name: m.name, date: m.planned_date, baselineDate: m.baseline_date, status: m.status })),
  };
}

export async function getKanbanBoard(client, c, projectId, filters = {}) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  const values = [c.organizationId, p.id];
  let where = "";
  if (filters.assigneeId) { values.push(uuid(filters.assigneeId, "Assignee")); where += ` AND t.assignee_user_id=$${values.length}`; }
  if (filters.mine === true || filters.mine === "true") { values.push(c.userId); where += ` AND t.assignee_user_id=$${values.length}`; }
  const res = await qx(client, `SELECT t.id,t.task_number,t.name,t.status,t.priority,t.percent_complete,t.planned_end_date,t.assignee_user_id,u.full_name AS assignee_name,t.blocked_reason,(SELECT count(*)::int FROM tenant.project_tasks ch WHERE ch.parent_task_id=t.id) AS child_count FROM tenant.project_tasks t LEFT JOIN public.users u ON u.id=t.assignee_user_id WHERE t.organization_id=$1 AND t.project_id=$2${where} ORDER BY t.sort_order,t.created_at`, values);
  const order = { urgent: 0, high: 1, normal: 2, low: 3 };
  const columns = STATUSES.map((status) => ({ status, tasks: res.rows.filter((t) => t.status === status && !t.child_count).sort((a, b) => order[a.priority] - order[b.priority]) }));
  return { project: { id: p.id, project_number: p.project_number, name: p.name }, columns };
}

export async function getProjectCalendar(client, c, filters = {}) {
  need(c, "projects.view");
  const from = dateOrNull(filters.from, "From") || today();
  const to = dateOrNull(filters.to, "To") || addDays(from, 30);
  if (to < from) throw new ProjectError(400, "The end cannot be before the start.", "PROJECT_DATE_INVALID");
  const values = [c.organizationId, c.companyId, from, to];
  let scope = "";
  if (filters.projectId) { values.push(uuid(filters.projectId, "Project")); scope += ` AND p.id=$${values.length}`; }
  if (!isBroad(c)) { values.push(c.userId); scope += ` AND (p.project_manager_id=$${values.length} OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=$${values.length} AND m.active=true))`; }
  const tasks = await qx(client, `SELECT t.id,t.task_number,t.name,t.planned_start_date AS start,t.planned_end_date AS "end",t.status,p.project_number,u.full_name AS assignee_name FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id LEFT JOIN public.users u ON u.id=t.assignee_user_id WHERE t.organization_id=$1 AND p.company_id=$2 AND t.status<>'cancelled' AND COALESCE(t.planned_start_date,t.planned_end_date)<=$4::date AND COALESCE(t.planned_end_date,t.planned_start_date)>=$3::date${scope}`, values);
  const milestones = await qx(client, `SELECT m.id,m.name,m.planned_date AS date,m.status,p.project_number FROM tenant.project_milestones m JOIN tenant.projects p ON p.id=m.project_id WHERE m.organization_id=$1 AND p.company_id=$2 AND m.planned_date BETWEEN $3::date AND $4::date${scope}`, values);
  const away = await qx(client, `SELECT e.user_id,u.full_name,l.start_date AS start,l.end_date AS "end" FROM tenant.hr_leave_requests l JOIN tenant.hr_employees e ON e.id=l.employee_id JOIN public.users u ON u.id=e.user_id WHERE l.organization_id=$1 AND l.company_id=$2 AND l.status='approved' AND l.start_date<=$4::date AND l.end_date>=$3::date AND e.user_id IN (SELECT m.user_id FROM tenant.project_members m JOIN tenant.projects p ON p.id=m.project_id WHERE m.active=true${scope})`, values);
  return { from, to, tasks: tasks.rows, milestones: milestones.rows, away: away.rows };
}

// ------------------------------------------------------------------ progress (F228)
export async function getProjectProgress(client, c, projectId) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  const tasks = await loadTasks(client, c, p.id);
  const parents = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id));
  const leaves = tasks.filter((t) => !parents.has(t.id) && t.status !== "cancelled");
  const by = {};
  for (const t of tasks) by[t.status] = (by[t.status] || 0) + 1;
  const hours = (await client.query(`SELECT COALESCE(sum(hours),0)::float AS h FROM tenant.project_time_entries WHERE project_id=$1 AND status='approved'`, [p.id])).rows[0].h;
  const estimated = leaves.reduce((s, t) => s + Number(t.estimated_hours), 0);
  const overdue = leaves.filter((t) => !["done", "cancelled"].includes(t.status) && t.planned_end_date && t.planned_end_date < today()).length;
  let plannedPercent = null;
  if (p.planned_start_date && p.planned_end_date && p.planned_end_date >= p.planned_start_date) {
    const total = diffDays(p.planned_start_date, p.planned_end_date) + 1;
    const elapsed = Math.min(total, Math.max(0, diffDays(p.planned_start_date, today()) + 1));
    plannedPercent = Math.round((elapsed / total) * 1000) / 10;
  }
  const actual = Number(p.percent_complete);
  const reports = await qx(client, `SELECT * FROM tenant.project_status_reports WHERE organization_id=$1 AND project_id=$2 ORDER BY report_date DESC,created_at DESC LIMIT 12`, [c.organizationId, p.id]);
  return { project: { id: p.id, project_number: p.project_number, name: p.name, status: p.status, health: p.health }, percentComplete: actual, plannedPercent, scheduleVariancePoints: plannedPercent === null ? null : Math.round((actual - plannedPercent) * 10) / 10, tasksByStatus: by, overdueTasks: overdue, estimatedHours: estimated, actualHours: hours, reports: reports.rows };
}

export async function saveStatusReport(client, c, projectId, input) {
  need(c, "projects.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  const health = oneOf(input.health, ["on_track", "at_risk", "off_track"], "Health");
  const res = await qx(client, `INSERT INTO tenant.project_status_reports(organization_id,company_id,project_id,report_date,health,percent_complete,summary,accomplishments,next_steps,blockers,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId, c.companyId, p.id, dateOrNull(input.reportDate, "Report date") || today(), health, p.percent_complete, requiredText(input.summary, "Summary", 3000), textOrNull(input.accomplishments, 3000), textOrNull(input.nextSteps, 3000), textOrNull(input.blockers, 3000), c.userId]);
  await client.query(`UPDATE tenant.projects SET health=$2,updated_at=now() WHERE id=$1`, [p.id, health]);
  await recordEvent(client, c, "project", p.id, "project.status_report", { health });
  return res.rows[0];
}

// ------------------------------------------------------------------ baselines
export async function listProjectBaselines(client, c, projectId) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  const res = await qx(client, `SELECT id,version,status,reason,created_by,approved_by,approved_at,created_at,jsonb_array_length(snapshot->'tasks') AS task_count FROM tenant.project_baselines WHERE organization_id=$1 AND project_id=$2 ORDER BY version DESC`, [c.organizationId, p.id]);
  return res.rows;
}

export async function createProjectBaseline(client, c, projectId, input = {}) {
  need(c, "projects.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  assertOpen(p, "baseline the plan");
  const tasks = await loadTasks(client, c, p.id);
  if (!tasks.length) throw new ProjectError(409, "There is nothing to baseline; add tasks first.", "PROJECT_BASELINE_EMPTY");
  const pending = await client.query(`SELECT 1 FROM tenant.project_baselines WHERE project_id=$1 AND status='pending_approval'`, [p.id]);
  if (pending.rows[0]) throw new ProjectError(409, "A baseline is already awaiting approval.", "PROJECT_BASELINE_PENDING");
  const ms = (await qx(client, `SELECT id,name,planned_date FROM tenant.project_milestones WHERE project_id=$1 AND status<>'cancelled'`, [p.id])).rows;
  const version = Number((await client.query(`SELECT COALESCE(max(version),0)+1 AS v FROM tenant.project_baselines WHERE project_id=$1`, [p.id])).rows[0].v);
  const snapshot = { project: { start: p.planned_start_date, end: p.planned_end_date, budget: p.approved_budget, revenue: p.contracted_revenue }, tasks: tasks.map((t) => ({ id: t.id, wbs: t.wbs_code, name: t.name, start: t.planned_start_date, end: t.planned_end_date, hours: t.estimated_hours })), milestones: ms };
  const settings = await loadSettings(client, c);
  const row = (await qx(client, `INSERT INTO tenant.project_baselines(organization_id,company_id,project_id,version,status,snapshot,reason,created_by) VALUES($1,$2,$3,$4,'pending_approval',$5::jsonb,$6,$7) RETURNING id,version,status,reason,created_at`, [c.organizationId, c.companyId, p.id, version, JSON.stringify(snapshot), textOrNull(input.reason, 500), c.userId])).rows[0];
  if (!settings.require_baseline_approval) return applyBaseline(client, c, p.id, row.id);
  await recordEvent(client, c, "project", p.id, "project.baseline_requested", { version });
  return row;
}

async function applyBaseline(client, c, projectId, baselineId) {
  const b = (await qx(client, `SELECT * FROM tenant.project_baselines WHERE id=$1`, [baselineId])).rows[0];
  await client.query(`UPDATE tenant.project_baselines SET status='superseded' WHERE project_id=$1 AND status='approved'`, [projectId]);
  for (const t of b.snapshot.tasks) await client.query(`UPDATE tenant.project_tasks SET baseline_start=$2,baseline_end=$3,baseline_hours=$4 WHERE id=$1`, [t.id, t.start, t.end, t.hours]);
  for (const m of b.snapshot.milestones) await client.query(`UPDATE tenant.project_milestones SET baseline_date=$2 WHERE id=$1`, [m.id, m.planned_date]);
  await client.query(`UPDATE tenant.projects SET baseline_version=$2,updated_at=now() WHERE id=$1`, [projectId, b.version]);
  const res = await qx(client, `UPDATE tenant.project_baselines SET status='approved',approved_by=COALESCE(approved_by,$2),approved_at=COALESCE(approved_at,now()) WHERE id=$1 RETURNING id,version,status,approved_by,approved_at`, [b.id, c.userId]);
  await recordEvent(client, c, "project", projectId, "project.baseline_approved", { version: b.version });
  return res.rows[0];
}

export async function approveProjectBaseline(client, c, baselineId) {
  need(c, "projects.approve");
  const b = (await qx(client, `SELECT * FROM tenant.project_baselines WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(baselineId, "Baseline")])).rows[0];
  if (!b) throw new ProjectError(404, "Baseline was not found.", "PROJECT_NOT_FOUND");
  if (b.status !== "pending_approval") throw new ProjectError(409, "Only a pending baseline can be approved.", "PROJECT_STATE_INVALID");
  const p = await loadProject(client, c, b.project_id, { lock: true });
  assertOpen(p, "approve a baseline");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && b.created_by === c.userId) throw new ProjectError(409, "The person who proposed a baseline cannot approve it.", "SELF_APPROVAL_BLOCKED");
  return applyBaseline(client, c, p.id, b.id);
}

export async function rejectProjectBaseline(client, c, baselineId, reason) {
  need(c, "projects.approve");
  const res = await qx(client, `UPDATE tenant.project_baselines SET status='rejected',approved_by=$4,approved_at=now(),reason=COALESCE(reason||' | ','')||$5 WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='pending_approval' RETURNING id,version,status`, [c.organizationId, c.companyId, uuid(baselineId, "Baseline"), c.userId, `Rejected: ${requiredText(reason, "Reason", 500)}`]);
  if (!res.rows[0]) throw new ProjectError(409, "Only a pending baseline can be rejected.", "PROJECT_STATE_INVALID");
  return res.rows[0];
}

export async function getScheduleVariance(client, c, projectId) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  if (!p.baseline_version) throw new ProjectError(409, "This project has no approved baseline yet.", "PROJECT_NO_BASELINE");
  const rows = await qx(client, `SELECT task_number,name,wbs_code,planned_start_date,planned_end_date,baseline_start,baseline_end,estimated_hours,baseline_hours,status FROM tenant.project_tasks WHERE organization_id=$1 AND project_id=$2 AND baseline_end IS NOT NULL ORDER BY sort_order`, [c.organizationId, p.id]);
  const out = rows.rows.map((t) => ({ ...t, startVarianceDays: t.planned_start_date && t.baseline_start ? diffDays(t.baseline_start, t.planned_start_date) : null, finishVarianceDays: t.planned_end_date && t.baseline_end ? diffDays(t.baseline_end, t.planned_end_date) : null, hoursVariance: t.baseline_hours === null ? null : Number(t.estimated_hours) - Number(t.baseline_hours) }));
  return { baselineVersion: p.baseline_version, rows: out, slipped: out.filter((r) => (r.finishVarianceDays ?? 0) > 0).length };
}

// ------------------------------------------------------------------ templates -> project (F196)
export async function instantiateTemplate(client, c, project, template, startDate) {
  const items = template.items;
  const start = addWorkingDays(startDate, 0);
  const created = new Map();
  const taskItems = items.filter((i) => i.item_type === "task");
  const bySeq = new Map(items.map((i) => [i.sequence, i]));
  const depth = (i) => { let d = 0; let cur = i; while (cur.parent_sequence) { cur = bySeq.get(cur.parent_sequence); d += 1; } return d; };
  for (const item of [...taskItems].sort((a, b) => depth(a) - depth(b) || a.sequence - b.sequence)) {
    const from = addDays(start, item.offset_days);
    const s = addWorkingDays(from, 0);
    const parent = item.parent_sequence ? created.get(item.parent_sequence) : null;
    const number = await nextNumber(client, c, `project_task:${project.id}`, "TASK");
    const row = (await client.query(`INSERT INTO tenant.project_tasks(organization_id,project_id,parent_task_id,task_number,name,description,status,priority,planned_start_date,planned_end_date,estimated_hours,billable,created_by,duration_days,sort_order) VALUES($1,$2,$3,$4,$5,$6,'todo',$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [c.organizationId, project.id, parent, number, item.name, item.description, item.priority, s, finishFromStart(s, item.duration_days), item.estimated_hours, project.project_type === "internal" ? false : item.billable, c.userId, item.duration_days, item.sequence])).rows[0];
    created.set(item.sequence, row.id);
  }
  for (const item of taskItems) for (const pred of item.predecessor_sequences || []) {
    if (created.has(pred) && created.has(item.sequence)) await client.query(`INSERT INTO tenant.project_task_dependencies(organization_id,project_id,predecessor_task_id,successor_task_id,dependency_type,lag_days) VALUES($1,$2,$3,$4,'finish_to_start',0) ON CONFLICT DO NOTHING`, [c.organizationId, project.id, created.get(pred), created.get(item.sequence)]);
  }
  let seq = 0;
  for (const item of items.filter((i) => i.item_type === "milestone")) {
    seq += 1;
    const billing = Number(item.billing_percent) > 0 && project.project_type === "customer";
    const amount = billing ? String(Math.round(Number(project.contracted_revenue) * Number(item.billing_percent)) / 100) : "0";
    await client.query(`INSERT INTO tenant.project_milestones(organization_id,project_id,sequence,name,description,planned_date,billing_trigger,billing_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [c.organizationId, project.id, seq, item.name, item.description, addDays(start, item.offset_days), billing && Number(amount) > 0, amount]);
  }
  await renumberWbs(client, c, project.id);
  await recalculateProgress(client, c, project.id);
  const dates = await qx(client, `SELECT max(planned_end_date) AS e FROM tenant.project_tasks WHERE project_id=$1`, [project.id]);
  if (dates.rows[0].e) await client.query(`UPDATE tenant.projects SET planned_start_date=COALESCE(planned_start_date,$2),planned_end_date=COALESCE(planned_end_date,$3) WHERE id=$1`, [project.id, start, dates.rows[0].e]);
  return { tasks: created.size };
}

void needAny; void iso; void dateRequired; void positive;
