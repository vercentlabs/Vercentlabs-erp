import { createHash } from "node:crypto";

const TABLES = Object.freeze({
  projects: "projects",
  milestones: "project_milestones",
  tasks: "project_tasks",
  members: "project_members",
  "time-entries": "project_time_entries",
  expenses: "project_expenses",
  budgets: "project_budgets",
  "billing-milestones": "project_billing_milestones",
  "procurement-links": "project_procurement_links",
  profitability: "project_profitability_snapshots",
});

const PROJECT_CHILD_TABLES = new Set([
  "project_milestones",
  "project_tasks",
  "project_members",
]);

function requirePermission(context, permission) {
  if (
    !context.roleSlugs?.includes("organization_owner") &&
    !context.permissions?.includes(permission)
  ) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function table(resource) {
  const value = TABLES[resource];
  if (!value) throw new Error("Unsupported project resource.");
  return value;
}

async function event(
  client,
  context,
  aggregateType,
  aggregateId,
  eventType,
  payload = {},
) {
  await client.query(
    `INSERT INTO tenant.project_events
      (organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      context.organizationId,
      context.companyId,
      aggregateType,
      aggregateId,
      eventType,
      JSON.stringify(payload),
      context.userId,
    ],
  );
}

export async function getProjectsDashboard(client, context) {
  requirePermission(context, "projects.view");
  const projects = await client.query(
    `SELECT
       count(*)::int AS total_projects,
       count(*) FILTER (WHERE status='active')::int AS active_projects,
       count(*) FILTER (
         WHERE status IN ('planned','active')
           AND planned_end_date < current_date
       )::int AS overdue_projects,
       coalesce(sum(contracted_revenue),0)::text AS contracted_revenue,
       coalesce(sum(approved_budget),0)::text AS approved_budget
     FROM tenant.projects
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const work = await client.query(
    `SELECT
       count(*) FILTER (
         WHERE task.status NOT IN ('done','cancelled')
           AND task.planned_end_date < current_date
       )::int AS overdue_tasks,
       coalesce(sum(task.estimated_hours)
         FILTER (WHERE task.status NOT IN ('done','cancelled')),0)::text AS remaining_estimated_hours
     FROM tenant.project_tasks task
     JOIN tenant.projects project ON project.id=task.project_id
     WHERE task.organization_id=$1 AND project.company_id=$2`,
    [context.organizationId, context.companyId],
  );
  return { ...projects.rows[0], ...work.rows[0] };
}

export async function listProjectResource(
  client,
  context,
  resource,
  { limit = 100, offset = 0, projectId = null } = {},
) {
  requirePermission(context, "projects.view");
  const target = table(resource);
  const values = [context.organizationId, context.companyId];
  const childTable = PROJECT_CHILD_TABLES.has(target);
  const from = childTable
    ? `tenant.${target} record JOIN tenant.projects project ON project.id=record.project_id AND project.organization_id=record.organization_id`
    : `tenant.${target} record`;
  const companyFilter = childTable
    ? "project.company_id=$2"
    : "record.company_id=$2";
  let projectFilter = "";
  if (projectId && target !== "projects") {
    values.push(projectId);
    projectFilter = ` AND record.project_id=$${values.length}`;
  }
  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const rows = await client.query(
    `SELECT record.* FROM ${from}
     WHERE record.organization_id=$1 AND ${companyFilter}${projectFilter}
     ORDER BY record.created_at DESC NULLS LAST,record.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return rows.rows;
}

export async function createProject(client, context, input) {
  requirePermission(context, "projects.create");
  const snapshot = {
    name: input.name,
    customerId: input.customerId || null,
    billingMethod: input.billingMethod || "non_billable",
    plannedStartDate: input.plannedStartDate || null,
    plannedEndDate: input.plannedEndDate || null,
    approvedBudget: String(input.approvedBudget || 0),
    contractedRevenue: String(input.contractedRevenue || 0),
  };
  const number = input.projectNumber || `PRJ-${Date.now()}`;
  const result = await client.query(
    `INSERT INTO tenant.projects
      (organization_id,company_id,branch_id,project_number,name,description,
       customer_id,sales_order_id,contract_reference,project_manager_id,status,
       billing_method,currency_code,planned_start_date,planned_end_date,
       approved_budget,contracted_revenue,billable,content_hash,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.branchId || null,
      number,
      input.name,
      input.description || null,
      input.customerId || null,
      input.salesOrderId || null,
      input.contractReference || null,
      input.projectManagerId || context.userId,
      input.billingMethod || "non_billable",
      input.currencyCode || "INR",
      input.plannedStartDate || null,
      input.plannedEndDate || null,
      String(input.approvedBudget || 0),
      String(input.contractedRevenue || 0),
      Boolean(input.billable),
      hash(snapshot),
      context.userId,
    ],
  );
  await client.query(
    `INSERT INTO tenant.project_members
      (organization_id,project_id,user_id,role_name,allocation_percent,active)
     VALUES ($1,$2,$3,'Project Manager',100,true)
     ON CONFLICT (project_id,user_id) DO NOTHING`,
    [
      context.organizationId,
      result.rows[0].id,
      input.projectManagerId || context.userId,
    ],
  );
  await event(
    client,
    context,
    "project",
    result.rows[0].id,
    "project.created",
    snapshot,
  );
  return result.rows[0];
}

export async function createProjectTask(client, context, input) {
  requirePermission(context, "projects.tasks.manage");
  const result = await client.query(
    `INSERT INTO tenant.project_tasks
      (organization_id,project_id,milestone_id,parent_task_id,task_number,name,
       description,status,priority,assignee_user_id,planned_start_date,
       planned_end_date,estimated_hours,billable,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'todo',$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      context.organizationId,
      input.projectId,
      input.milestoneId || null,
      input.parentTaskId || null,
      input.taskNumber || `TASK-${Date.now()}`,
      input.name,
      input.description || null,
      input.priority || "normal",
      input.assigneeUserId || null,
      input.plannedStartDate || null,
      input.plannedEndDate || null,
      String(input.estimatedHours || 0),
      Boolean(input.billable),
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "task",
    result.rows[0].id,
    "project.task.created",
  );
  return result.rows[0];
}

export async function createTimeEntry(client, context, input) {
  requirePermission(context, "projects.time.enter");
  const result = await client.query(
    `INSERT INTO tenant.project_time_entries
      (organization_id,company_id,project_id,task_id,user_id,work_date,hours,
       description,billable,cost_rate,bill_rate,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft')
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.projectId,
      input.taskId || null,
      input.userId || context.userId,
      input.workDate,
      String(input.hours),
      input.description || null,
      Boolean(input.billable),
      String(input.costRate || 0),
      String(input.billRate || 0),
    ],
  );
  await event(
    client,
    context,
    "time_entry",
    result.rows[0].id,
    "project.time.created",
  );
  return result.rows[0];
}

export async function transitionProject(client, context, projectId, action) {
  const transitions = {
    plan: ["draft", "planned"],
    activate: ["planned", "active"],
    hold: ["active", "on_hold"],
    resume: ["on_hold", "active"],
    complete: ["active", "completed"],
    cancel: ["draft", "cancelled"],
  };
  const transition = transitions[action];
  if (!transition) throw new Error("Unsupported project action.");
  requirePermission(
    context,
    ["complete", "cancel"].includes(action)
      ? "projects.approve"
      : "projects.manage",
  );

  if (action === "complete") {
    const incomplete = await client.query(
      `SELECT count(*)::int AS count
       FROM tenant.project_tasks
       WHERE organization_id=$1 AND project_id=$2
         AND status NOT IN ('done','cancelled')`,
      [context.organizationId, projectId],
    );
    if (incomplete.rows[0].count > 0) {
      const error = new Error("Project has incomplete tasks.");
      error.code = "INCOMPLETE_TASKS";
      throw error;
    }
  }

  const result = await client.query(
    `UPDATE tenant.projects
     SET status=$4,
       actual_start_date=CASE WHEN $4='active'
         THEN coalesce(actual_start_date,current_date) ELSE actual_start_date END,
       actual_end_date=CASE WHEN $4='completed'
         THEN current_date ELSE actual_end_date END,
       closed_by=CASE WHEN $4 IN ('completed','cancelled') THEN $5 ELSE closed_by END,
       closed_at=CASE WHEN $4 IN ('completed','cancelled') THEN now() ELSE closed_at END,
       updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status=$6
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      projectId,
      transition[1],
      context.userId,
      transition[0],
    ],
  );
  if (!result.rows[0]) throw new Error("Project is not in the required state.");
  await event(client, context, "project", projectId, `project.${action}`, {
    from: transition[0],
    to: transition[1],
  });
  return result.rows[0];
}

export async function approveTimeEntry(
  client,
  context,
  timeEntryId,
  approve,
  reason = null,
) {
  requirePermission(context, "projects.time.approve");
  const current = await client.query(
    `SELECT * FROM tenant.project_time_entries
     WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, timeEntryId],
  );
  const row = current.rows[0];
  if (!row || row.status !== "submitted") {
    throw new Error("Only submitted time entries can be reviewed.");
  }
  if (row.user_id === context.userId) {
    const error = new Error("A user cannot approve their own time entry.");
    error.code = "SELF_APPROVAL_BLOCKED";
    throw error;
  }
  const result = await client.query(
    `UPDATE tenant.project_time_entries
     SET status=$3,approved_by=$4,approved_at=CASE WHEN $3='approved' THEN now() ELSE NULL END,
       rejection_reason=$5,updated_at=now()
     WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [
      context.organizationId,
      timeEntryId,
      approve ? "approved" : "rejected",
      context.userId,
      approve ? null : reason,
    ],
  );
  return result.rows[0];
}

export async function getProjectProfitability(client, context, projectId) {
  requirePermission(context, "projects.profitability.view");
  const project = await client.query(
    `SELECT * FROM tenant.projects
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, projectId],
  );
  if (!project.rows[0]) throw new Error("Project not found.");

  const costs = await client.query(
    `SELECT
       coalesce((SELECT sum(hours*cost_rate)
         FROM tenant.project_time_entries
         WHERE organization_id=$1 AND project_id=$2 AND status='approved'),0) AS labor_cost,
       coalesce((SELECT sum(base_amount)
         FROM tenant.project_expenses
         WHERE organization_id=$1 AND project_id=$2
           AND status IN ('approved','reimbursed')),0) AS expense_cost,
       coalesce((SELECT sum(actual_amount)
         FROM tenant.project_procurement_links
         WHERE organization_id=$1 AND project_id=$2),0) AS procurement_cost,
       coalesce((SELECT sum(amount)
         FROM tenant.project_billing_milestones
         WHERE organization_id=$1 AND project_id=$2
           AND status IN ('requested','invoiced')),0) AS billed_revenue`,
    [context.organizationId, projectId],
  );
  const row = costs.rows[0];
  const totalCost =
    Number(row.labor_cost) +
    Number(row.expense_cost) +
    Number(row.procurement_cost);
  const revenue = Number(project.rows[0].contracted_revenue);
  const grossMargin = revenue - totalCost;
  const grossMarginPercent = revenue > 0 ? (grossMargin / revenue) * 100 : 0;
  return {
    project: project.rows[0],
    laborCost: Number(row.labor_cost),
    expenseCost: Number(row.expense_cost),
    procurementCost: Number(row.procurement_cost),
    totalCost,
    contractedRevenue: revenue,
    billedRevenue: Number(row.billed_revenue),
    grossMargin,
    grossMarginPercent,
  };
}
