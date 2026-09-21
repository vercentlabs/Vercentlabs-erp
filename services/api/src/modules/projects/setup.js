// Project setup (F193-F196, F202-F204, F208-F209): settings, templates, the project record and its
// lifecycle (plan, approve, activate, hold, complete, cancel, reopen), the team with rates and allocation,
// and resource availability against capacity, other commitments and approved leave.
import {
  addDays, asDate, canSeeFinance, canSeeRates, dateOrNull, has, hashOf, isBroad, iso, loadProject, loadSettings, need, needAny, nextNumber, nonNegative, oneOf, positive, ProjectError, qx,
  recordEvent, requiredText, text, textOrNull, today, uuid, uuidOrNull, workingDaysBetween, fromCents, toCents,
} from "./common.js";
import { instantiateTemplate } from "./planning.js";

const BILLING = ["fixed_price", "time_and_material", "milestone", "non_billable"];
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
  const method = input.defaultBillingMethod ? oneOf(input.defaultBillingMethod, BILLING, "Billing method") : cur.default_billing_method;
  const res = await client.query(
    `INSERT INTO tenant.project_settings(organization_id,company_id,require_time_approval,require_expense_approval,prohibit_self_approval,default_currency_code,hours_per_day,require_membership_for_time,require_baseline_approval,require_budget_approval,require_billing_approval,require_close_checks,default_billing_method)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (organization_id,company_id) DO UPDATE SET require_time_approval=EXCLUDED.require_time_approval,require_expense_approval=EXCLUDED.require_expense_approval,prohibit_self_approval=EXCLUDED.prohibit_self_approval,default_currency_code=EXCLUDED.default_currency_code,hours_per_day=EXCLUDED.hours_per_day,require_membership_for_time=EXCLUDED.require_membership_for_time,require_baseline_approval=EXCLUDED.require_baseline_approval,require_budget_approval=EXCLUDED.require_budget_approval,require_billing_approval=EXCLUDED.require_billing_approval,require_close_checks=EXCLUDED.require_close_checks,default_billing_method=EXCLUDED.default_billing_method,updated_at=now()
     RETURNING *`,
    [c.organizationId, c.companyId, b("requireTimeApproval", "require_time_approval"), b("requireExpenseApproval", "require_expense_approval"), b("prohibitSelfApproval", "prohibit_self_approval"), text(input.defaultCurrencyCode || cur.default_currency_code, 3).toUpperCase() || "INR", hpd, b("requireMembershipForTime", "require_membership_for_time"), b("requireBaselineApproval", "require_baseline_approval"), b("requireBudgetApproval", "require_budget_approval"), b("requireBillingApproval", "require_billing_approval"), b("requireCloseChecks", "require_close_checks"), method],
  );
  return res.rows[0];
}

// ------------------------------------------------------------------ templates (F196)
export async function listProjectTemplates(client, c) {
  need(c, "projects.view");
  const res = await qx(client, `SELECT t.*,(SELECT count(*)::int FROM tenant.project_template_items i WHERE i.template_id=t.id) AS item_count FROM tenant.project_templates t WHERE t.organization_id=$1 AND t.company_id=$2 ORDER BY t.code`, [c.organizationId, c.companyId]);
  return res.rows;
}

export async function getProjectTemplate(client, c, templateId) {
  need(c, "projects.view");
  const t = (await qx(client, `SELECT * FROM tenant.project_templates WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(templateId, "Template")])).rows[0];
  if (!t) throw new ProjectError(404, "Template was not found.", "PROJECT_NOT_FOUND");
  const items = await qx(client, `SELECT * FROM tenant.project_template_items WHERE organization_id=$1 AND template_id=$2 ORDER BY sequence`, [c.organizationId, t.id]);
  return { template: t, items: items.rows };
}

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) throw new ProjectError(400, "A template needs at least one item.", "PROJECT_FIELD_REQUIRED");
  const seqs = new Set();
  const rows = items.map((raw, i) => {
    const sequence = raw.sequence === undefined ? i + 1 : Math.round(positive(raw.sequence, "Sequence"));
    if (seqs.has(sequence)) throw new ProjectError(400, `Item sequence ${sequence} is used twice.`, "PROJECT_TEMPLATE_INVALID");
    seqs.add(sequence);
    return {
      sequence, itemType: oneOf(raw.itemType || "task", ["task", "milestone"], "Item type"), parentSequence: raw.parentSequence ? Math.round(positive(raw.parentSequence, "Parent")) : null,
      name: requiredText(raw.name, "Item name", 300), description: textOrNull(raw.description, 1000), offsetDays: Math.round(nonNegative(raw.offsetDays, "Offset")), durationDays: Math.round(nonNegative(raw.durationDays, "Duration", 1)),
      estimatedHours: nonNegative(raw.estimatedHours, "Hours"), billable: raw.billable === true, priority: oneOf(raw.priority || "normal", PRIORITIES, "Priority"),
      predecessors: (raw.predecessorSequences || []).map((s) => Math.round(positive(s, "Predecessor"))), billingPercent: nonNegative(raw.billingPercent, "Billing percent"),
    };
  });
  for (const r of rows) {
    if (r.parentSequence && !seqs.has(r.parentSequence)) throw new ProjectError(400, `Item ${r.sequence} names a parent that is not in the template.`, "PROJECT_TEMPLATE_INVALID");
    if (r.parentSequence === r.sequence) throw new ProjectError(400, "An item cannot be its own parent.", "PROJECT_TEMPLATE_INVALID");
    for (const p of r.predecessors) if (!seqs.has(p) || p === r.sequence) throw new ProjectError(400, `Item ${r.sequence} names an invalid predecessor.`, "PROJECT_TEMPLATE_INVALID");
  }
  // no parent loop
  for (const r of rows) {
    let cursor = r; let hops = 0;
    while (cursor.parentSequence) { cursor = rows.find((x) => x.sequence === cursor.parentSequence); hops += 1; if (hops > rows.length) throw new ProjectError(400, "The template's parent structure loops.", "PROJECT_TEMPLATE_CYCLE"); }
  }
  // no dependency loop (DFS)
  const graph = new Map(rows.map((r) => [r.sequence, r.predecessors]));
  const state = new Map();
  const visit = (n) => {
    if (state.get(n) === 1) throw new ProjectError(400, "The template's dependencies loop.", "PROJECT_TEMPLATE_CYCLE");
    if (state.get(n) === 2) return;
    state.set(n, 1);
    for (const p of graph.get(n)) visit(p);
    state.set(n, 2);
  };
  for (const s of graph.keys()) visit(s);
  return rows;
}

export async function saveProjectTemplate(client, c, input) {
  need(c, "projects.settings.manage");
  const id = uuidOrNull(input.id, "Template");
  const rows = input.items === undefined && id ? null : validateItems(input.items);
  const type = oneOf(input.projectType || "customer", ["customer", "internal"], "Project type");
  const billing = type === "internal" ? "non_billable" : oneOf(input.billingMethod || "non_billable", BILLING, "Billing method");
  let t;
  if (id) {
    const res = await qx(client, `UPDATE tenant.project_templates SET code=COALESCE($4,code),name=COALESCE($5,name),description=$6,project_type=$7,billing_method=$8,active=$9,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, id, textOrNull(input.code, 40)?.toUpperCase() ?? null, textOrNull(input.name, 200), textOrNull(input.description, 1000), type, billing, input.active === undefined ? true : Boolean(input.active)]);
    t = res.rows[0];
    if (!t) throw new ProjectError(404, "Template was not found.", "PROJECT_NOT_FOUND");
  } else {
    try {
      t = (await qx(client, `INSERT INTO tenant.project_templates(organization_id,company_id,code,name,description,project_type,billing_method,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [c.organizationId, c.companyId, requiredText(input.code, "Code", 40).toUpperCase(), requiredText(input.name, "Name", 200), textOrNull(input.description, 1000), type, billing, input.active === undefined ? true : Boolean(input.active), c.userId])).rows[0];
    } catch (error) {
      if (error.code === "23505") throw new ProjectError(409, "A template with that code already exists.", "PROJECT_DUPLICATE");
      throw error;
    }
  }
  if (rows) {
    await client.query(`DELETE FROM tenant.project_template_items WHERE template_id=$1`, [t.id]);
    for (const r of rows) {
      await client.query(`INSERT INTO tenant.project_template_items(organization_id,template_id,sequence,item_type,parent_sequence,name,description,offset_days,duration_days,estimated_hours,billable,priority,predecessor_sequences,billing_percent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [c.organizationId, t.id, r.sequence, r.itemType, r.parentSequence, r.name, r.description, r.offsetDays, r.durationDays, String(r.estimatedHours), r.billable, r.priority, r.predecessors, String(r.billingPercent)]);
    }
  }
  return t;
}

// ------------------------------------------------------------------ projects (F193-F195, F204)
const LIST_SQL = `SELECT p.*,u.full_name AS manager_name,cust.display_name AS customer_name,
    (SELECT count(*)::int FROM tenant.project_tasks t WHERE t.project_id=p.id AND t.status NOT IN ('done','cancelled')) AS open_tasks
  FROM tenant.projects p LEFT JOIN public.users u ON u.id=p.project_manager_id LEFT JOIN tenant.business_parties cust ON cust.id=p.customer_id`;

export async function listProjectsDesk(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (!isBroad(c)) add("(p.project_manager_id=? OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=? AND m.active=true))", c.userId);
  if (filters.status && filters.status !== "all") add("p.status=?", oneOf(filters.status, ["draft", "planned", "active", "on_hold", "completed", "cancelled"], "Status"));
  if (filters.projectType) add("p.project_type=?", oneOf(filters.projectType, ["customer", "internal"], "Project type"));
  if (filters.health) add("p.health=?", oneOf(filters.health, ["on_track", "at_risk", "off_track"], "Health"));
  if (filters.customerId) add("p.customer_id=?", uuid(filters.customerId, "Customer"));
  if (filters.managerId) add("p.project_manager_id=?", uuid(filters.managerId, "Manager"));
  if (filters.search) add("(p.project_number ILIKE ? OR p.name ILIKE ?)", `%${text(filters.search, 100)}%`);
  const res = await qx(client, `${LIST_SQL} WHERE p.organization_id=$1 AND p.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY p.created_at DESC LIMIT 500`, values);
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
  const r = await client.query(`SELECT 1 FROM tenant.business_parties WHERE organization_id=$1 AND id=$2 AND party_type IN ('customer','both') AND (company_id IS NULL OR company_id=$3)`, [c.organizationId, customerId, c.companyId]);
  if (!r.rows[0]) throw new ProjectError(409, "The customer was not found in this company.", "PROJECT_CUSTOMER_INVALID");
}

export async function createProjectRecord(client, c, input) {
  need(c, "projects.create");
  const settings = await loadSettings(client, c);
  let template = null;
  if (input.templateId) template = (await getProjectTemplate(client, c, input.templateId));
  const type = oneOf(input.projectType || template?.template.project_type || "customer", ["customer", "internal"], "Project type");
  let billing = oneOf(input.billingMethod || template?.template.billing_method || settings.default_billing_method, BILLING, "Billing method");
  const customerId = uuidOrNull(input.customerId, "Customer");
  if (type === "internal") {
    if (customerId) throw new ProjectError(400, "An internal project has no customer.", "PROJECT_TYPE_INVALID");
    billing = "non_billable";
  } else {
    if (billing !== "non_billable" && !customerId) throw new ProjectError(400, "A billable customer project needs a customer.", "PROJECT_FIELD_REQUIRED");
    if (customerId) await requireCustomer(client, c, customerId);
  }
  const start = dateOrNull(input.plannedStartDate, "Planned start");
  const end = dateOrNull(input.plannedEndDate, "Planned end");
  if (start && end && end < start) throw new ProjectError(400, "The planned end cannot be before the start.", "PROJECT_DATE_INVALID");
  const manager = uuidOrNull(input.projectManagerId, "Project manager") || c.userId;
  await requireOrgUser(client, c, manager, "The project manager");
  const branchId = uuidOrNull(input.branchId, "Branch");
  if (branchId) {
    const b = await client.query(`SELECT 1 FROM public.branches WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, branchId]);
    if (!b.rows[0]) throw new ProjectError(409, "The branch does not belong to this company.", "PROJECT_REFERENCE_INVALID");
  }
  const salesOrderId = uuidOrNull(input.salesOrderId, "Sales order");
  if (salesOrderId) {
    const so = await client.query(`SELECT 1 FROM tenant.sales_orders WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, salesOrderId]);
    if (!so.rows[0]) throw new ProjectError(409, "The sales order was not found in this company.", "PROJECT_REFERENCE_INVALID");
  }
  const revenue = type === "internal" ? 0 : nonNegative(input.contractedRevenue, "Contracted revenue");
  const currency = textOrNull(input.currencyCode, 3)?.toUpperCase() || settings.default_currency_code || "INR";
  const number = input.projectNumber ? requiredText(input.projectNumber, "Project number", 60) : await nextNumber(client, c, "project", "PRJ");
  let p;
  try {
    p = (await qx(client,
      `INSERT INTO tenant.projects(organization_id,company_id,branch_id,project_number,name,description,customer_id,sales_order_id,contract_reference,project_manager_id,status,billing_method,currency_code,planned_start_date,planned_end_date,approved_budget,contracted_revenue,billable,content_hash,created_by,project_type,template_id,priority,category)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [c.organizationId, c.companyId, branchId, number, requiredText(input.name, "Name", 300), textOrNull(input.description, 3000), customerId, salesOrderId, textOrNull(input.contractReference, 200), manager, billing, currency, start, end, String(nonNegative(input.approvedBudget, "Budget")), String(revenue), billing !== "non_billable", hashOf({ name: input.name, customerId, billing, start, end }), c.userId, type, template?.template.id ?? null, oneOf(input.priority || "normal", PRIORITIES, "Priority"), textOrNull(input.category, 100)])).rows[0];
  } catch (error) {
    if (error.code === "23505") throw new ProjectError(409, "A project with that number already exists.", "PROJECT_DUPLICATE");
    throw error;
  }
  await client.query(`INSERT INTO tenant.project_members(organization_id,project_id,user_id,role_name,allocation_percent,active,start_date,end_date) VALUES($1,$2,$3,'Project Manager',100,true,$4,$5) ON CONFLICT (project_id,user_id) DO NOTHING`, [c.organizationId, p.id, manager, start, end]);
  if (template) await instantiateTemplate(client, c, p, template, start || today());
  await recordEvent(client, c, "project", p.id, "project.created", { number, type, template: template?.template.code ?? null });
  return maskProject(c, p);
}

export async function updateProjectRecord(client, c, projectId, input) {
  need(c, "projects.manage");
  const p = await loadProject(client, c, projectId, { lock: true });
  if (["completed", "cancelled"].includes(p.status)) throw new ProjectError(409, `This project is ${p.status}; reopen it before editing.`, "PROJECT_CLOSED");
  const sets = [];
  const vals = [c.organizationId, c.companyId, p.id];
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
  if (input.customerId !== undefined || input.billingMethod !== undefined) {
    if (p.status !== "draft") throw new ProjectError(409, "The customer and billing method can only change while the project is a draft.", "PROJECT_FINANCIALS_LOCKED");
    const customer = input.customerId !== undefined ? uuidOrNull(input.customerId, "Customer") : p.customer_id;
    const billing = p.project_type === "internal" ? "non_billable" : oneOf(input.billingMethod ?? p.billing_method, BILLING, "Billing method");
    if (p.project_type === "internal" && customer) throw new ProjectError(400, "An internal project has no customer.", "PROJECT_TYPE_INVALID");
    if (customer) await requireCustomer(client, c, customer);
    if (billing !== "non_billable" && !customer) throw new ProjectError(400, "A billable customer project needs a customer.", "PROJECT_FIELD_REQUIRED");
    set("customer_id", customer); set("billing_method", billing); set("billable", billing !== "non_billable");
  }
  if (input.contractedRevenue !== undefined) {
    if (p.project_type === "internal") throw new ProjectError(400, "An internal project earns no contracted revenue.", "PROJECT_TYPE_INVALID");
    if (p.status !== "draft") need(c, "projects.billing.manage");
    const revenue = nonNegative(input.contractedRevenue, "Contracted revenue");
    const billed = (await client.query(`SELECT COALESCE(sum(amount),0)::text AS s FROM tenant.project_billing_milestones WHERE project_id=$1 AND status IN ('ready','requested','invoiced')`, [p.id])).rows[0].s;
    if (toCents(String(revenue)) < toCents(billed)) throw new ProjectError(409, "Contracted revenue cannot be lower than what has already been billed or is queued for billing.", "PROJECT_REVENUE_BELOW_BILLED");
    set("contracted_revenue", String(revenue));
  }
  if (input.approvedBudget !== undefined) {
    if (p.status !== "draft") throw new ProjectError(409, "The budget changes through a budget revision once the project is planned.", "PROJECT_FINANCIALS_LOCKED");
    set("approved_budget", String(nonNegative(input.approvedBudget, "Budget")));
  }
  if (!sets.length) return maskProject(c, p);
  const res = await qx(client, `UPDATE tenant.projects SET ${sets.join(",")},updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, vals);
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
  add("unapproved_expenses", await n(`SELECT count(*) AS n FROM tenant.project_expenses WHERE organization_id=$1 AND project_id=$2 AND status IN ('draft','submitted')`), "expense(s) are not approved");
  add("open_billing", await n(`SELECT count(*) AS n FROM tenant.project_billing_milestones WHERE organization_id=$1 AND project_id=$2 AND status IN ('ready','requested')`), "billing line(s) are not invoiced or cancelled");
  add("critical_issues", await n(`SELECT count(*) AS n FROM tenant.project_issues WHERE organization_id=$1 AND project_id=$2 AND severity='critical' AND status IN ('open','in_progress')`), "critical issue(s) are unresolved");
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
  if (action === "plan" && p.project_type === "customer" && p.billing_method !== "non_billable" && !p.customer_id) throw new ProjectError(409, "A billable customer project needs a customer before it can be planned.", "PROJECT_FIELD_REQUIRED");
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
    const spent = await client.query(`SELECT (SELECT count(*) FROM tenant.project_time_entries WHERE project_id=$1 AND status='approved')+(SELECT count(*) FROM tenant.project_expenses WHERE project_id=$1 AND status IN ('approved','reimbursed'))+(SELECT count(*) FROM tenant.project_billing_milestones WHERE project_id=$1 AND status='invoiced') AS n`, [p.id]);
    if (Number(spent.rows[0].n) > 0) throw new ProjectError(409, "A project with approved time, approved expenses or invoices cannot be cancelled; complete it instead.", "PROJECT_HAS_ACTUALS");
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

// ------------------------------------------------------------------ team (F202, F208)
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

// F209: capacity minus every commitment and approved leave, per person over a range.
export async function getResourceAvailability(client, c, filters = {}) {
  needAny(c, ["projects.resources.manage", "projects.reports.view", "projects.manage"]);
  const from = dateOrNull(filters.from, "From") || today();
  const to = dateOrNull(filters.to, "To") || iso(new Date(asDate(from).getTime() + 27 * 86400000));
  if (to < from) throw new ProjectError(400, "The end cannot be before the start.", "PROJECT_DATE_INVALID");
  const settings = await loadSettings(client, c);
  const hpd = Number(settings.hours_per_day);
  const members = await qx(client,
    `SELECT m.user_id,m.allocation_percent,m.start_date,m.end_date,p.project_number,p.name AS project_name,u.full_name
     FROM tenant.project_members m JOIN tenant.projects p ON p.id=m.project_id AND p.company_id=$2 LEFT JOIN public.users u ON u.id=m.user_id
     WHERE m.organization_id=$1 AND m.active=true AND p.status IN ('planned','active','on_hold')
       AND COALESCE(m.start_date,'0001-01-01')<=$4::date AND COALESCE(m.end_date,'9999-12-31')>=$3::date`, [c.organizationId, c.companyId, from, to]);
  const leave = await qx(client,
    `SELECT e.user_id,l.start_date,l.end_date FROM tenant.hr_leave_requests l JOIN tenant.hr_employees e ON e.id=l.employee_id
     WHERE l.organization_id=$1 AND l.company_id=$2 AND l.status='approved' AND e.user_id IS NOT NULL AND l.start_date<=$4::date AND l.end_date>=$3::date`, [c.organizationId, c.companyId, from, to]);
  const people = new Map();
  for (const m of members.rows) {
    const s = m.start_date && m.start_date > from ? m.start_date : from;
    const e = m.end_date && m.end_date < to ? m.end_date : to;
    const days = workingDaysBetween(s, e);
    const person = people.get(m.user_id) || { userId: m.user_id, name: m.full_name, allocatedHours: 0, leaveHours: 0, projects: [] };
    const hours = (days * hpd * Number(m.allocation_percent)) / 100;
    person.allocatedHours += hours;
    person.projects.push({ project: `${m.project_number} ${m.project_name}`, percent: Number(m.allocation_percent), hours });
    people.set(m.user_id, person);
  }
  for (const l of leave.rows) {
    const person = people.get(l.user_id);
    if (!person) continue;
    const s = l.start_date > from ? l.start_date : from;
    const e = l.end_date < to ? l.end_date : to;
    person.leaveHours += workingDaysBetween(s, e) * hpd;
  }
  const capacity = workingDaysBetween(from, to) * hpd;
  const rows = [...people.values()].map((p) => {
    const available = Math.max(0, capacity - p.leaveHours);
    return { ...p, capacityHours: capacity, availableHours: available - p.allocatedHours, overAllocated: p.allocatedHours > available + 0.001, utilizationPercent: available > 0 ? Math.round((p.allocatedHours / available) * 1000) / 10 : 0 };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { from, to, hoursPerDay: hpd, rows };
}

export async function listProjectTeams(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (filters.projectId) add("m.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.userId) add("m.user_id=?", uuid(filters.userId, "User"));
  if (!isBroad(c)) add("(p.project_manager_id=? OR EXISTS (SELECT 1 FROM tenant.project_members mm WHERE mm.project_id=p.id AND mm.user_id=? AND mm.active=true))", c.userId);
  const res = await qx(client, `SELECT m.*,p.project_number,p.name AS project_name,p.status AS project_status,u.full_name FROM tenant.project_members m JOIN tenant.projects p ON p.id=m.project_id LEFT JOIN public.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND p.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY p.project_number,u.full_name LIMIT 500`, values);
  const rates = canSeeRates(c);
  return res.rows.map((r) => (rates ? r : { ...r, cost_rate: null, bill_rate: null }));
}

export async function listProjectOptions(client, c) {
  need(c, "projects.view");
  const q = async (sql, params = [c.organizationId, c.companyId]) => (await client.query(sql, params)).rows;
  const narrow = !isBroad(c);
  return {
    projects: await q(`SELECT p.id,p.project_number AS code,p.name FROM tenant.projects p WHERE p.organization_id=$1 AND p.company_id=$2 AND p.status NOT IN ('cancelled')${narrow ? " AND (p.project_manager_id=$3 OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=$3 AND m.active=true))" : ""} ORDER BY p.project_number DESC LIMIT 500`, narrow ? [c.organizationId, c.companyId, c.userId] : undefined),
    templates: await q(`SELECT id,code,name FROM tenant.project_templates WHERE organization_id=$1 AND company_id=$2 AND active=true ORDER BY code`),
    users: await q(`SELECT u.id,u.email AS code,u.full_name AS name FROM public.users u JOIN public.organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND m.status='active' AND $2::uuid IS NOT NULL ORDER BY u.full_name LIMIT 500`),
    customers: await q(`SELECT id,code,display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('customer','both') AND status='active' AND (company_id IS NULL OR company_id=$2) ORDER BY display_name LIMIT 500`),
    suppliers: await q(`SELECT id,code,display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('supplier','both') AND status='active' AND (company_id IS NULL OR company_id=$2) ORDER BY display_name LIMIT 500`),
    items: await q(`SELECT id,code,name FROM tenant.items WHERE organization_id=$1 AND ($2::uuid IS NOT NULL) AND status='active' ORDER BY name LIMIT 500`),
    tasks: await q(`SELECT t.id,t.task_number AS code,p.project_number||' / '||t.name AS name FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id WHERE t.organization_id=$1 AND p.company_id=$2 AND t.status NOT IN ('done','cancelled')${narrow ? " AND (p.project_manager_id=$3 OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=$3 AND m.active=true))" : ""} ORDER BY p.project_number,t.sort_order LIMIT 500`, narrow ? [c.organizationId, c.companyId, c.userId] : undefined),
    milestones: await q(`SELECT m.id,p.project_number AS code,p.project_number||' / '||m.name AS name FROM tenant.project_milestones m JOIN tenant.projects p ON p.id=m.project_id WHERE m.organization_id=$1 AND p.company_id=$2 AND m.status<>'cancelled' AND m.billing_trigger=true ORDER BY p.project_number,m.sequence LIMIT 500`),
    purchaseOrders: await q(`SELECT id,left(id::text,8) AS code,'PO '||left(id::text,8)||' ('||status||')' AS name FROM tenant.procurement_purchase_orders WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 200`),
    receipts: await q(`SELECT id,left(id::text,8) AS code,'Receipt '||left(id::text,8)||' ('||status||')' AS name FROM tenant.procurement_receipts WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 200`),
    requisitions: await q(`SELECT id,left(id::text,8) AS code,'Requisition '||left(id::text,8)||' ('||status||')' AS name FROM tenant.procurement_requisitions WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 200`),
    sourcingEvents: await q(`SELECT id,left(id::text,8) AS code,'Sourcing '||left(id::text,8)||' ('||status||')' AS name FROM tenant.procurement_sourcing_events WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 200`),
    vendorBills: await q(`SELECT id,bill_number AS code,bill_number||' - '||grand_total::text AS name FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND company_id=$2 AND status IN ('posted','partially_paid','paid','overdue','disputed') ORDER BY bill_date DESC LIMIT 200`),
    warehouses: await q(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND company_id=$2 ORDER BY name`),
  };
}

export { has, fromCents };
