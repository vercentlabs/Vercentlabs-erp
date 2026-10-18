// Capacity and pause per salesperson (CRM plan 3.6). A salesperson can be given a monthly lead capacity — how many leads may be assigned
// to them in any 30 days, as Odoo counts it — and be paused from one day to another (leave, a trade fair, a full plate). Automatic
// assignment (rules, round robin, the fallback owner, the scheduled re-run) passes over whoever is paused or full; assigning by hand still
// works, and says so.
import { CrmError } from "../data-management/errors.js";
import { orgToday } from "../data-management/org-date.js";

const MANAGERS = ["crm.leads.reassign", "crm.settings.manage", "crm.leads.bulk_assign"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_AVAILABILITY_VALIDATION", { issues: [{ field, message }] });
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function requireManager(context) {
  if (context.roleSlugs?.includes("organization_owner") || MANAGERS.some((permission) => context.permissions?.includes(permission))) return;
  throw new CrmError(403, "You do not have permission to set salespeople's capacity or leave.", "PERMISSION_DENIED");
}

// SQL: a user (by the expression `userExpr`) is not paused today and is under their 30-day capacity. `org` is the organization id parameter.
export const AVAILABLE_FOR_AUTO_ASSIGNMENT_SQL = (org, userExpr) => `NOT EXISTS (
  SELECT 1 FROM tenant.crm_salesperson_availability availability
   WHERE availability.organization_id = ${org} AND availability.user_id = ${userExpr}
     AND ((availability.paused_from IS NOT NULL OR availability.paused_until IS NOT NULL)
            AND COALESCE(availability.paused_from, '-infinity'::date) <= ${orgToday(org)}
            AND COALESCE(availability.paused_until, 'infinity'::date) >= ${orgToday(org)}
          OR availability.monthly_lead_capacity IS NOT NULL
            AND (SELECT count(*) FROM tenant.crm_leads assigned WHERE assigned.organization_id = ${org} AND assigned.owner_user_id = ${userExpr}
                  AND assigned.assigned_at >= now() - interval '30 days') >= availability.monthly_lead_capacity))`;

// Why someone is not taking leads automatically right now, or null.
export async function availabilityOf(client, organizationId, userId) {
  const row = (await client.query(
    `SELECT availability.*, to_char(availability.paused_from, 'YYYY-MM-DD') AS from_text, to_char(availability.paused_until, 'YYYY-MM-DD') AS until_text,
            ${orgToday("$1")} AS today,
            (SELECT count(*)::int FROM tenant.crm_leads assigned WHERE assigned.organization_id = $1 AND assigned.owner_user_id = $2 AND assigned.assigned_at >= now() - interval '30 days') AS recent
       FROM tenant.crm_salesperson_availability availability WHERE availability.organization_id = $1 AND availability.user_id = $2`,
    [organizationId, userId])).rows[0];
  if (!row) return null;
  const today = row.today instanceof Date ? row.today.toISOString().slice(0, 10) : String(row.today).slice(0, 10);
  const paused = (row.from_text || row.until_text) && (!row.from_text || row.from_text <= today) && (!row.until_text || row.until_text >= today);
  if (paused) return { reason: "paused", message: `On a pause${row.until_text ? ` until ${row.until_text}` : ""}${row.pause_reason ? ` (${row.pause_reason})` : ""}.` };
  if (row.monthly_lead_capacity !== null && row.recent >= row.monthly_lead_capacity)
    return { reason: "full", message: `Has ${row.recent} leads from the last 30 days, at the capacity of ${row.monthly_lead_capacity}.` };
  return null;
}

// Every active CRM member with their capacity, pause and the leads they got in the last 30 days.
export async function listSalespersonAvailability(client, context) {
  const { rows } = await client.query(
    `SELECT app_user.id AS user_id, app_user.full_name, availability.monthly_lead_capacity, availability.pause_reason,
            to_char(availability.paused_from, 'YYYY-MM-DD') AS paused_from, to_char(availability.paused_until, 'YYYY-MM-DD') AS paused_until,
            (SELECT count(*)::int FROM tenant.crm_leads assigned WHERE assigned.organization_id = $1 AND assigned.owner_user_id = app_user.id AND assigned.assigned_at >= now() - interval '30 days') AS recent,
            (SELECT count(*)::int FROM tenant.crm_leads open_lead WHERE open_lead.organization_id = $1 AND open_lead.owner_user_id = app_user.id AND open_lead.status IN ('open', 'qualified') AND open_lead.archived_at IS NULL) AS open_leads,
            ${AVAILABLE_FOR_AUTO_ASSIGNMENT_SQL("$1", "app_user.id")} AS available
       FROM organization_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id AND app_user.status = 'active'
       LEFT JOIN tenant.crm_salesperson_availability availability ON availability.organization_id = $1 AND availability.user_id = app_user.id
      WHERE membership.organization_id = $1 AND membership.status = 'active'
        AND EXISTS (SELECT 1 FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
                      LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
                     WHERE assignment.organization_id = $1 AND assignment.user_id = app_user.id AND assignment.status = 'active'
                       AND (role.slug = 'organization_owner' OR grant_row.permission_key LIKE 'crm.leads.%'))
      ORDER BY lower(app_user.full_name)`, [context.organizationId]);
  return rows.map((row) => ({
    userId: row.user_id, name: row.full_name, monthlyLeadCapacity: row.monthly_lead_capacity, pausedFrom: row.paused_from, pausedUntil: row.paused_until,
    pauseReason: row.pause_reason, leadsLast30Days: row.recent, openLeads: row.open_leads, takingLeads: row.available,
  }));
}

// input: { monthlyLeadCapacity?: number | null, pausedFrom?: date | null, pausedUntil?: date | null, pauseReason?: string | null }
export async function setSalespersonAvailability(client, context, userId, input = {}) {
  requireManager(context);
  if (!UUID.test(String(userId ?? ""))) throw new CrmError(404, "Salesperson not found.", "CRM_AVAILABILITY_NOT_FOUND");
  const member = (await client.query("SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [context.organizationId, userId])).rows[0];
  if (!member) throw new CrmError(404, "Salesperson not found.", "CRM_AVAILABILITY_NOT_FOUND");
  const current = (await client.query(
    `SELECT monthly_lead_capacity, pause_reason, to_char(paused_from, 'YYYY-MM-DD') AS paused_from, to_char(paused_until, 'YYYY-MM-DD') AS paused_until
       FROM tenant.crm_salesperson_availability WHERE organization_id = $1 AND user_id = $2`, [context.organizationId, userId])).rows[0] ?? {};
  const next = {
    capacity: input.monthlyLeadCapacity === undefined ? current.monthly_lead_capacity ?? null
      : input.monthlyLeadCapacity === null || text(input.monthlyLeadCapacity) === "" ? null : Number(input.monthlyLeadCapacity),
    from: input.pausedFrom === undefined ? current.paused_from ?? null : text(input.pausedFrom) || null,
    until: input.pausedUntil === undefined ? current.paused_until ?? null : text(input.pausedUntil) || null,
    reason: input.pauseReason === undefined ? current.pause_reason ?? null : text(input.pauseReason).slice(0, 200) || null,
  };
  if (next.capacity !== null && (!Number.isInteger(next.capacity) || next.capacity < 0 || next.capacity > 100000)) throw invalid("monthlyLeadCapacity", "Enter a whole number of leads, or leave it empty for no limit.");
  for (const [field, value] of [["pausedFrom", next.from], ["pausedUntil", next.until]]) if (value && !isDay(value)) throw invalid(field, "Enter a valid date.");
  if (next.from && next.until && next.from > next.until) throw invalid("pausedUntil", "The pause ends before it starts.");
  if (!next.from && !next.until) next.reason = null;
  await client.query(
    `INSERT INTO tenant.crm_salesperson_availability (organization_id, user_id, monthly_lead_capacity, paused_from, paused_until, pause_reason, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (organization_id, user_id) DO UPDATE SET monthly_lead_capacity = EXCLUDED.monthly_lead_capacity, paused_from = EXCLUDED.paused_from,
       paused_until = EXCLUDED.paused_until, pause_reason = EXCLUDED.pause_reason, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, userId, next.capacity, next.from, next.until, next.reason, context.userId ?? null]);
  return (await listSalespersonAvailability(client, context)).find((entry) => entry.userId === userId) ?? null;
}
