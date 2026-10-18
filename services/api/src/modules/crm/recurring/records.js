// Recurring plans (CRM plan 5.3): how often a deal's recurring revenue comes in — Monthly, Quarterly, Yearly, or the organization's
// own (every 6 months, every 2 years…). A deal names its plan and the amount per period; the pipeline shows it as monthly revenue.
import { CrmError } from "../data-management/errors.js";

const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STANDARD = Object.freeze([{ name: "Monthly", months: 1 }, { name: "Quarterly", months: 3 }, { name: "Yearly", months: 12 }]);
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (field, message) => new CrmError(400, message, "CRM_RECURRING_PLAN_VALIDATION", { issues: [{ field, message }] });

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage recurring plans.", "PERMISSION_DENIED");
}

const toPlan = (row) => ({ id: row.id, name: row.name, months: row.months, isActive: row.status === "active", dealCount: row.deal_count === undefined ? undefined : Number(row.deal_count) });

// The plans (Monthly, Quarterly and Yearly are there from the start), shortest first.
export async function listRecurringPlans(client, context, { includeInactive = false } = {}) {
  if (includeInactive) requireManage(context);
  const any = (await client.query("SELECT 1 FROM tenant.crm_recurring_plans WHERE organization_id = $1 LIMIT 1", [context.organizationId])).rows[0];
  if (!any) for (const plan of STANDARD)
    await client.query("INSERT INTO tenant.crm_recurring_plans (organization_id, name, months) VALUES ($1, $2, $3)", [context.organizationId, plan.name, plan.months]);
  const { rows } = await client.query(
    `SELECT plan.*, (SELECT count(*) FROM tenant.crm_opportunities deal WHERE deal.organization_id = plan.organization_id AND deal.recurring_plan_id = plan.id) AS deal_count
       FROM tenant.crm_recurring_plans plan WHERE plan.organization_id = $1 AND ($2 OR plan.status = 'active') ORDER BY (plan.status = 'active') DESC, plan.months, lower(plan.name)`,
    [context.organizationId, includeInactive]);
  return rows.map(toPlan);
}

function clean(input, creating) {
  const out = {};
  if (creating || has(input, "name")) {
    out.name = text(input.name);
    if (!out.name || out.name.length > 80) throw invalid("name", "Name the plan (up to 80 characters).");
  }
  if (creating || has(input, "months")) {
    out.months = Number(input.months);
    if (!Number.isInteger(out.months) || out.months < 1 || out.months > 120) throw invalid("months", "A period is 1 to 120 months.");
  }
  if (has(input, "isActive")) out.status = input.isActive ? "active" : "inactive";
  return out;
}

export async function createRecurringPlan(client, context, input = {}) {
  requireManage(context);
  const fields = clean(input, true);
  const clash = (await client.query("SELECT 1 FROM tenant.crm_recurring_plans WHERE organization_id = $1 AND lower(name) = lower($2) AND status = 'active'", [context.organizationId, fields.name])).rows[0];
  if (clash) throw invalid("name", "Another plan already has this name.");
  const row = (await client.query("INSERT INTO tenant.crm_recurring_plans (organization_id, name, months, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
    [context.organizationId, fields.name, fields.months, context.userId ?? null])).rows[0];
  return toPlan(row);
}

// input: any of { name, months, isActive }. A plan in use keeps its period (the deals' monthly figures rest on it).
export async function updateRecurringPlan(client, context, planId, input = {}) {
  requireManage(context);
  const current = UUID.test(String(planId ?? "")) ? (await client.query("SELECT * FROM tenant.crm_recurring_plans WHERE organization_id = $1 AND id = $2", [context.organizationId, planId])).rows[0] : null;
  if (!current) throw new CrmError(404, "Recurring plan not found.", "CRM_RECURRING_PLAN_NOT_FOUND");
  const fields = clean(input, false);
  if (has(fields, "months") && fields.months !== current.months
    && (await client.query("SELECT 1 FROM tenant.crm_opportunities WHERE organization_id = $1 AND recurring_plan_id = $2 LIMIT 1", [context.organizationId, current.id])).rows[0])
    throw invalid("months", "Deals use this plan: make a new plan for another period.");
  const columns = Object.keys(fields);
  if (columns.length)
    await client.query(`UPDATE tenant.crm_recurring_plans SET ${columns.map((column, index) => `${column} = $${index + 3}`).join(", ")}, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, current.id, ...columns.map((column) => fields[column])]);
  return toPlan((await client.query("SELECT * FROM tenant.crm_recurring_plans WHERE id = $1", [current.id])).rows[0]);
}
