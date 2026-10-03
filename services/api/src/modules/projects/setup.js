// Project setup (F193-F195, F202-F204): settings, the project record and its lifecycle (plan, approve,
// activate, hold, complete, cancel, reopen), and the project team with allocation.
import {
  canSeeFinance, canSeeRates, dateOrNull, has, hashOf, isBroad, loadProject, loadSettings, need, nextNumber, nonNegative, oneOf, positive, ProjectError, qx, recordEvent, requiredText, text, textOrNull, uuid, uuidOrNull, fromCents,
} from "./common.js";

const PRIORITIES = ["low", "normal", "high", "urgent"];
const FIN_FIELDS = ["approved_budget", "contracted_revenue"];
export function maskProject(c, row) {
  if (canSeeFinance(c)) return row;
  const out = { ...row };
  for (const f of FIN_FIELDS) out[f] = null;
  return out;
}

// ------------------------------------------------------------------ settings
export async function getProjectSettings(client, c) {
  need(c, "projects.view");
  return loadSettings(client, c);
}
export async function saveProjectSettings(client, c, input) {
  need(c, "projects.settings.manage");
  const cur = await loadSettings(client, c);
  const b = (k, col) => (input[k] === undefined ? cur[col] : Boolean(input[k]));
  const hpd = input.hoursPerDay === undefined ? Number(cur.hours_per_day) : positive(input.hoursPerDay, "Hours per day");
  if (hpd > 24) throw new ProjectError(400, "Hours per day cannot exceed 24.", "PROJECT_NUMBER_INVALID");
  const res = await client.query(
    `INSERT INTO tenant.project_settings(organization_id,require_time_approval,prohibit_self_approval,default_currency_code,hours_per_day,require_membership_for_time,require_close_checks)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id) DO UPDATE SET require_time_approval=EXCLUDED.require_time_approval,prohibit_self_approval=EXCLUDED.prohibit_self_approval,default_currency_code=EXCLUDED.default_currency_code,hours_per_day=EXCLUDED.hours_per_day,require_membership_for_time=EXCLUDED.require_membership_for_time,require_close_checks=EXCLUDED.require_close_checks,updated_at=now()
     RETURNING *`,
    [c.organizationId, b("requireTimeApproval", "require_time_approval"), b("prohibitSelfApproval", "prohibit_self_approval"), text(input.defaultCurrencyCode || cur.default_currency_code, 3).toUpperCase() || "INR", hpd, b("requireMembershipForTime", "require_membership_for_time"), b("requireCloseChecks", "require_close_checks")],
  );
  return res.rows[0];
}

// ------------------------------------------------------------------ projects (F193-F195, F204)
const LIST_SQL = `SELECT p.*,u.full_name AS manager_name,cust.display_name AS customer_name,
    (SELECT count(*)::int FROM tenant.project_tasks t WHERE t.project_id=p.id AND t.status NOT IN ('done','cancelled')) AS open_tasks
  FROM tenant.projects p LEFT JOIN public.users u ON u.id=p.project_manager_id LEFT JOIN tenant.business_parties cust ON cust.id=p.customer_id`;

export async function listProjectsDesk(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (!isBroad(c)) add("(p.project_manager_id=? OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=? AND m.active=true))", c.userId);
  if (filters.status && filters.status !== "all") add("p.status=?", oneOf(filters.status, ["draft", "planned", "active", "on_hold", "completed", "cancelled"], "Status"));
  if (filters.projectType) add("p.project_type=?", oneOf(filters.projectType, ["customer", "internal"], "Project type"));
  if (filters.health) add("p.health=?", oneOf(filters.health, ["on_track", "at_risk", "off_track"], "Health"));
  if (filters.customerId) add("p.customer_id=?", uuid(filters.customerId, "Customer"));
  if (filters.managerId) add("p.project_manager_id=?", uuid(filters.managerId, "Manager"));
  if (filters.search) add("(p.project_number ILIKE ? OR p.name ILIKE ?)", `%${text(filters.search, 100)}%`);
  const res = await qx(client, `${LIST_SQL} WHERE p.organization_id=$1${where.map((w) => ` AND ${w}`).join("")} ORDER BY p.created_at DESC LIMIT 500`, values);
  return res.rows.map((r) => maskProject(c, r));
}

export async function getProjectDesk(client, c, projectId) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  const head = (await qx(client, `${LIST_SQL} WHERE p.organization_id=$1 AND p.id=$2`, [c.organizationId, p.id])).rows[0];
  const members = await qx(client, `SELECT m.*,u.full_name FROM tenant.project_members m LEFT JOIN public.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.project_id=$2 ORDER BY m.role_name,u.full_name`, [c.organizationId, p.id]);
  const rates = canSeeRates(c);
  return { project: maskProject(c, head), members: members.rows.map((m) => (rates ? m : { ...m, cost_rate: null, bill_rate: null })) };
}

async function requireOrgUser(client, c, userId, label) {
  const r = await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'`, [c.organizationId, userId]);
  if (!r.rows[0]) throw new ProjectError(409, `${label} is not an active member of this organization.`, "PROJECT_USER_INVALID");
}

async function requireCustomer(client, c, customerId) {
  const r = await client.query(`SELECT 1 FROM tenant.business_parties WHERE organization_id=$1 AND id=$2 AND party_type IN ('customer','both')`, [c.organizationId, customerId]);
  if (!r.rows[0]) throw new ProjectError(409, "The customer was not found.", "PROJECT_CUSTOMER_INVALID");
}

export async function createProjectRecord(client, c, input) {
  need(c, "projects.create");
  const settings = await loadSettings(client, c);
  const type = oneOf(input.projectType || "customer", ["customer", "internal"], "Project type");
  const customerId = uuidOrNull(input.customerId, "Customer");
  if (type === "internal" && customerId) throw new ProjectError(400, "An internal project has no customer.", "PROJECT_TYPE_INVALID");
  if (customerId) await requireCustomer(client, c, customerId);
  const start = dateOrNull(input.plannedStartDate, "Planned start");
  const end = dateOrNull(input.plannedEndDate, "Planned end");
  if (start && end && end < start) throw new ProjectError(400, "The planned end cannot be before the start.", "PROJECT_DATE_INVALID");
  const manager = uuidOrNull(input.projectManagerId, "Project manager") || c.userId;
  await requireOrgUser(client, c, manager, "The project manager");
  const salesOrderId = uuidOrNull(input.salesOrderId, "Sales order");
  if (salesOrderId) {
    const so = await client.query(`SELECT 1 FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`, [c.organizationId, salesOrderId]);
    if (!so.rows[0]) throw new ProjectError(409, "The sales order was not found.", "PROJECT_REFERENCE_INVALID");
  }
  const currency = textOrNull(input.currencyCode, 3)?.toUpperCase() || settings.default_currency_code || "INR";
  const number = input.projectNumber ? requiredText(input.projectNumber, "Project number", 60) : await nextNumber(client, c, "project", "PRJ");
  let p;
  try {
    p = (await qx(client,
      `INSERT INTO tenant.projects(organization_id,project_number,name,description,customer_id,sales_order_id,contract_reference,project_manager_id,status,billing_method,currency_code,planned_start_date,planned_end_date,approved_budget,contracted_revenue,billable,content_hash,created_by,project_type,template_id,priority,category)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [c.organizationId, number, requiredText(input.name, "Name", 300), textOrNull(input.description, 3000), customerId, salesOrderId, textOrNull(input.contractReference, 200), manager, "non_billable", currency, start, end, "0", "0", false, hashOf({ name: input.name, customerId, start, end }), c.userId, type, null, oneOf(input.priority || "normal", PRIORITIES, "Priority"), textOrNull(input.category, 100)])).rows[0];
  } catch (error) {
    if (error.code === "23505") throw new ProjectError(409, "A project with that number already exists.", "PROJECT_DUPLICATE");
    throw error;
  }
  await client.query(`INSERT INTO tenant.project_members(organization_id,project_id,user_id,role_name,allocation_percent,active,start_date,end_date) VALUES($1,$2,$3,'Project Manager',100,true,$4,$5) ON CONFLICT (project_id,user_id) DO NOTHING`, [c.organizationId, p.id, manager, start, end]);
  await recordEvent(client, c, "project", p.id, "project.created", { number, type });
  return maskProject(c, p);
}

export async function updateProjectRecord(client, c, projectId, input) {
  need(c, "projects.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  if (["completed", "cancelled"].includes(p.status)) throw new ProjectError(409, `This project is ${p.status}; reopen it before editing.`, "PROJECT_CLOSED");
  const sets = [];
  const vals = [c.organizationId, p.id];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (input.name !== undefined) set("name", requiredText(input.name, "Name", 300));
  if (input.description !== undefined) set("description", textOrNull(input.description, 3000));
  if (input.category !== undefined) set("category", textOrNull(input.category, 100));
  if (input.priority !== undefined) set("priority", oneOf(input.priority, PRIORITIES, "Priority"));
  if (input.health !== undefined) set("health", oneOf(input.health, ["on_track", "at_risk", "off_track"], "Health"));
  if (input.contractReference !== undefined) set("contract_reference", textOrNull(input.contractReference, 200));
  const start = input.plannedStartDate !== undefined ? dateOrNull(input.plannedStartDate, "Planned start") : p.planned_start_date;
  const end = input.plannedEndDate !== undefined ? dateOrNull(input.plannedEndDate, "Planned end") : p.planned_end_date;
  if (start && end && end < start) throw new ProjectError(400, "The planned end cannot be before the start.", "PROJECT_DATE_INVALID");
  if (input.plannedStartDate !== undefined) set("planned_start_date", start);
  if (input.plannedEndDate !== undefined) set("planned_end_date", end);
  if (input.projectManagerId !== undefined) {
    const m = uuid(input.projectManagerId, "Project manager");
    await requireOrgUser(client, c, m, "The project manager");
    set("project_manager_id", m);
    await client.query(`INSERT INTO tenant.project_members(organization_id,project_id,user_id,role_name,allocation_percent,active) VALUES($1,$2,$3,'Project Manager',100,true) ON CONFLICT (project_id,user_id) DO UPDATE SET active=true`, [c.organizationId, p.id, m]);
  }
  if (input.customerId !== undefined) {
    if (p.status !== "draft") throw new ProjectError(409, "The customer can only change while the project is a draft.", "PROJECT_FINANCIALS_LOCKED");
    const customer = uuidOrNull(input.customerId, "Customer");
    if (p.project_type === "internal" && customer) throw new ProjectError(400, "An internal project has no customer.", "PROJECT_TYPE_INVALID");
    if (customer) await requireCustomer(client, c, customer);
    set("customer_id", customer);
  }
  if (!sets.length) return maskProject(c, p);
  const res = await qx(client, `UPDATE tenant.projects SET ${sets.join(",")},updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, vals);
  await recordEvent(client, c, "project", p.id, "project.updated", { fields: sets.length });
  return maskProject(c, res.rows[0]);
}

// ------------------------------------------------------------------ lifecycle
export async function getCloseBlockers(client, c, projectId) {
  need(c, "projects.view");
  const p = await loadProject(client, c, projectId);
  const n = async (sql) => Number((await client.query(sql, [c.organizationId, p.id])).rows[0].n);
  const blockers = [];
  const add = (code, count, message) => { if (count > 0) blockers.push({ code, count, message: `${count} ${message}` }); };
  add("open_tasks", await n(`SELECT count(*) AS n FROM tenant.project_tasks WHERE organization_id=$1 AND project_id=$2 AND status NOT IN ('done','cancelled')`), "task(s) are not finished");
  add("unapproved_time", await n(`SELECT count(*) AS n FROM tenant.project_time_entries WHERE organization_id=$1 AND project_id=$2 AND status IN ('draft','submitted')`), "time entr(ies) are not approved");
  return { project: { id: p.id, project_number: p.project_number, status: p.status }, blockers, canClose: blockers.length === 0 };
}

export async function approveProjectRecord(client, c, projectId) {
  need(c, "projects.approve");
  const p = await loadProject(client, c, projectId, { lock: true });
  if (p.status !== "planned") throw new ProjectError(409, "Only a planned project can be approved.", "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && (p.created_by === c.userId)) throw new ProjectError(409, "The person who created a project cannot approve it.", "SELF_APPROVAL_BLOCKED");
  const res = await qx(client, `UPDATE tenant.projects SET approved_by=$2,approved_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [p.id, c.userId]);
  await recordEvent(client, c, "project", p.id, "project.approved");
  return maskProject(c, res.rows[0]);
}

export async function changeProjectStatus(client, c, projectId, action, input = {}) {
  const map = {
    plan: [["draft"], "planned", "projects.manage"], activate: [["planned"], "active", "projects.manage"], hold: [["active"], "on_hold", "projects.manage"], resume: [["on_hold"], "active", "projects.manage"],
    complete: [["active"], "completed", "projects.approve"], cancel: [["draft", "planned", "on_hold"], "cancelled", "projects.approve"], reopen: [["completed", "cancelled"], "active", "projects.approve"],
  };
  const t = map[action];
  if (!t) throw new ProjectError(400, "Unsupported project action.", "PROJECT_VALUE_INVALID");
  need(c, t[2]);
  const p = await loadProject(client, c, projectId, { lock: true });
  if (!t[0].includes(p.status)) throw new ProjectError(409, `A ${p.status.replace("_", " ")} project cannot be ${action === "plan" ? "planned" : action + "d"}.`.replace("planned d", "planned"), "PROJECT_STATE_INVALID");
  const settings = await loadSettings(client, c);
  const reason = ["cancel", "reopen", "hold"].includes(action) ? requiredText(input.reason, "Reason", 500) : textOrNull(input.reason, 500);
  if (action === "activate" && !p.approved_by) throw new ProjectError(409, "A project must be approved by someone other than its creator before it starts.", "PROJECT_NOT_APPROVED");
  if (action === "complete") {
    const status = await getCloseBlockers(client, c, p.id);
    const hard = settings.require_close_checks ? status.blockers : status.blockers.filter((b) => b.code === "open_tasks");
    if (hard.length) {
      const err = new ProjectError(409, `The project cannot be completed: ${hard.map((b) => b.message).join("; ")}.`, "PROJECT_CLOSE_BLOCKED");
      err.details = hard;
      throw err;
    }
  }
  if (action === "cancel") {
    const spent = await client.query(`SELECT count(*) AS n FROM tenant.project_time_entries WHERE project_id=$1 AND status='approved'`, [p.id]);
    if (Number(spent.rows[0].n) > 0) throw new ProjectError(409, "A project with approved time cannot be cancelled; complete it instead.", "PROJECT_HAS_ACTUALS");
  }
  const to = t[1];
  const res = await qx(client,
    `UPDATE tenant.projects SET status=$2,actual_start_date=CASE WHEN $2='active' THEN COALESCE(actual_start_date,current_date) ELSE actual_start_date END,
       actual_end_date=CASE WHEN $2='completed' THEN current_date WHEN $3='reopen' THEN NULL ELSE actual_end_date END,
       percent_complete=CASE WHEN $2='completed' THEN 100 ELSE percent_complete END,
       closed_by=CASE WHEN $2 IN ('completed','cancelled') THEN $4::uuid WHEN $3='reopen' THEN NULL ELSE closed_by END,
       closed_at=CASE WHEN $2 IN ('completed','cancelled') THEN now() WHEN $3='reopen' THEN NULL ELSE closed_at END,
       close_note=CASE WHEN $2 IN ('completed','cancelled') OR $3='reopen' THEN $5 ELSE close_note END,
       reopened_count=reopened_count+CASE WHEN $3='reopen' THEN 1 ELSE 0 END,updated_at=now()
     WHERE id=$1 RETURNING *`, [p.id, to, action, c.userId, reason]);
  await recordEvent(client, c, "project", p.id, `project.${action}`, { from: p.status, to, reason });
  return maskProject(c, res.rows[0]);
}

// ------------------------------------------------------------------ team (F202)
async function overlapLoad(client, c, userId, start, end, excludeMemberId = null) {
  const res = await qx(client,
    `SELECT COALESCE(sum(m.allocation_percent),0)::float AS load FROM tenant.project_members m JOIN tenant.projects p ON p.id=m.project_id
     WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active=true AND p.status IN ('draft','planned','active','on_hold') AND ($5::uuid IS NULL OR m.id<>$5)
       AND COALESCE(m.start_date,'0001-01-01')<=COALESCE($4::date,'9999-12-31') AND COALESCE(m.end_date,'9999-12-31')>=COALESCE($3::date,'0001-01-01')`,
    [c.organizationId, userId, start, end, excludeMemberId]);
  return res.rows[0].load;
}

export async function saveProjectMember(client, c, projectId, input) {
  need(c, "projects.resources.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  if (["completed", "cancelled"].includes(p.status)) throw new ProjectError(409, `This project is ${p.status}; reopen it before changing the team.`, "PROJECT_CLOSED");
  const userId = uuid(input.userId, "Team member");
  await requireOrgUser(client, c, userId, "The team member");
  const allocation = input.allocationPercent === undefined ? 100 : positive(input.allocationPercent, "Allocation");
  if (allocation > 100) throw new ProjectError(400, "Allocation cannot exceed 100%.", "PROJECT_NUMBER_INVALID");
  const start = dateOrNull(input.startDate, "Start");
  const end = dateOrNull(input.endDate, "End");
  if (start && end && end < start) throw new ProjectError(400, "The end cannot be before the start.", "PROJECT_DATE_INVALID");
  const existing = (await client.query(`SELECT id FROM tenant.project_members WHERE project_id=$1 AND user_id=$2`, [p.id, userId])).rows[0];
  const other = await overlapLoad(client, c, userId, start, end, existing?.id ?? null);
  const over = other + allocation;
  if (over > 100 && input.allowOverAllocation !== true) throw new ProjectError(409, `That would allocate this person ${Math.round(over)}% across projects in the period. Confirm over-allocation to proceed.`, "PROJECT_OVER_ALLOCATED");
  const vals = [c.organizationId, p.id, userId, requiredText(input.roleName || "Team member", "Role", 100), String(allocation), String(nonNegative(input.costRate, "Cost rate")), String(nonNegative(input.billRate, "Bill rate")), start, end, input.active === undefined ? true : Boolean(input.active)];
  const res = existing
    ? await qx(client, `UPDATE tenant.project_members SET role_name=$4,allocation_percent=$5,cost_rate=$6,bill_rate=$7,start_date=$8,end_date=$9,active=$10 WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 RETURNING *`, vals)
    : await qx(client, `INSERT INTO tenant.project_members(organization_id,project_id,user_id,role_name,allocation_percent,cost_rate,bill_rate,start_date,end_date,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, vals);
  await recordEvent(client, c, "project", p.id, existing ? "project.member_updated" : "project.member_added", { userId, allocation });
  return { ...res.rows[0], over_allocated: over > 100, total_allocation: over };
}

export async function removeProjectMember(client, c, projectId, userId) {
  need(c, "projects.resources.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  if (p.project_manager_id === userId) throw new ProjectError(409, "The project manager cannot be removed from the team; assign another manager first.", "PROJECT_STATE_INVALID");
  const open = await client.query(`SELECT count(*)::int AS n FROM tenant.project_tasks WHERE project_id=$1 AND assignee_user_id=$2 AND status NOT IN ('done','cancelled')`, [p.id, userId]);
  if (open.rows[0].n > 0) throw new ProjectError(409, `That person still has ${open.rows[0].n} open task(s); reassign them first.`, "PROJECT_MEMBER_HAS_WORK");
  const res = await client.query(`UPDATE tenant.project_members SET active=false,end_date=COALESCE(end_date,current_date) WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 RETURNING id`, [c.organizationId, p.id, uuid(userId, "Team member")]);
  if (!res.rows[0]) throw new ProjectError(404, "That person is not on the team.", "PROJECT_NOT_FOUND");
  return { ok: true };
}

export async function listProjectTeams(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (filters.projectId) add("m.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.userId) add("m.user_id=?", uuid(filters.userId, "User"));
  if (!isBroad(c)) add("(p.project_manager_id=? OR EXISTS (SELECT 1 FROM tenant.project_members mm WHERE mm.project_id=p.id AND mm.user_id=? AND mm.active=true))", c.userId);
  const res = await qx(client, `SELECT m.*,p.project_number,p.name AS project_name,p.status AS project_status,u.full_name FROM tenant.project_members m JOIN tenant.projects p ON p.id=m.project_id LEFT JOIN public.users u ON u.id=m.user_id WHERE m.organization_id=$1${where.map((w) => ` AND ${w}`).join("")} ORDER BY p.project_number,u.full_name LIMIT 500`, values);
  const rates = canSeeRates(c);
  return res.rows.map((r) => (rates ? r : { ...r, cost_rate: null, bill_rate: null }));
}

export async function listProjectOptions(client, c) {
  need(c, "projects.view");
  const q = async (sql, params = [c.organizationId]) => (await client.query(sql, params)).rows;
  const narrow = !isBroad(c);
  return {
    projects: await q(`SELECT p.id,p.project_number AS code,p.name FROM tenant.projects p WHERE p.organization_id=$1 AND p.status NOT IN ('cancelled')${narrow ? " AND (p.project_manager_id=$2 OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=$2 AND m.active=true))" : ""} ORDER BY p.project_number DESC LIMIT 500`, narrow ? [c.organizationId, c.userId] : undefined),
    users: await q(`SELECT u.id,u.email AS code,u.full_name AS name FROM public.users u JOIN public.organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND m.status='active' ORDER BY u.full_name LIMIT 500`),
    customers: await q(`SELECT id,code,display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('customer','both') AND status='active' ORDER BY display_name LIMIT 500`),
    tasks: await q(`SELECT t.id,t.task_number AS code,p.project_number||' / '||t.name AS name FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id WHERE t.organization_id=$1 AND t.status NOT IN ('done','cancelled')${narrow ? " AND (p.project_manager_id=$2 OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=$2 AND m.active=true))" : ""} ORDER BY p.project_number,t.sort_order LIMIT 500`, narrow ? [c.organizationId, c.userId] : undefined),
  };
}

export { has, fromCents };
