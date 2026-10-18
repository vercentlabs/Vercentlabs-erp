// CRM plan 3.7 — what each salesperson did, and against what target.
//
//   Activity report (CRM-R4)  per person over a period: the calls, emails, meetings, WhatsApp and SMS messages they logged, the tasks and
//                             follow-ups they completed, what is overdue now, and the leads and deals they touched;
//   Targets (CRM-T4)          a monthly target per person on the value won, the deals won, the new leads taken on, or the activities
//                             logged — each set against what was done in that month.
//
// A person sees themselves; a manager also sees the members of the teams they manage; whoever sees every CRM record sees everyone
// (the Leads list's own rule for whose work is visible). Targets are set by whoever manages CRM settings or reassigns leads.
import { CrmError } from "../data-management/errors.js";
import { crmOwnerScopeSql } from "../data-management/crm-access-scope.js";
import { reportingCurrencyOf } from "../data-management/reporting-currency.js";

const ZONE = "(SELECT org_tz.timezone FROM public.organizations org_tz WHERE org_tz.id = $1)";
const TARGET_METRICS = Object.freeze([
  { key: "won_value", label: "Value won", money: true },
  { key: "won_count", label: "Deals won" },
  { key: "new_leads", label: "New leads" },
  { key: "activities", label: "Activities logged" },
]);
const SETTERS = ["crm.settings.manage", "crm.leads.reassign"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
const num = (value) => Number(value ?? 0);
const invalid = (field, message) => new CrmError(400, message, "CRM_TARGET_VALIDATION", { issues: [{ field, message }] });

function requireCrm(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.some((permission) => permission.startsWith("crm."))) return;
  throw new CrmError(403, "You do not have access to CRM reports.", "PERMISSION_DENIED");
}

// The people whose work the caller may see: active members with CRM access, limited by the owner rule. Adds the binds to `values`.
function peopleSql(context, values, { teamId = null } = {}) {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const scope = crmOwnerScopeSql(context, bind, "app_user.id", "$1", { includeUnassigned: false, resource: "leads" });
  const team = teamId && UUID.test(teamId)
    ? ` AND EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member WHERE member.organization_id = $1 AND member.user_id = app_user.id AND member.team_id = ${bind(teamId)} AND member.status = 'active')`
    : "";
  return `SELECT app_user.id, app_user.full_name FROM organization_memberships membership
            JOIN users app_user ON app_user.id = membership.user_id AND app_user.status = 'active'
           WHERE membership.organization_id = $1 AND membership.status = 'active'
             AND EXISTS (SELECT 1 FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
                           LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
                          WHERE assignment.organization_id = $1 AND assignment.user_id = app_user.id AND assignment.status = 'active'
                            AND (role.slug = 'organization_owner' OR grant_row.permission_key LIKE 'crm.%'))${scope}${team}`;
}

function period(input) {
  const today = new Date().toISOString().slice(0, 10);
  const from = isDay(input.from) ? input.from : `${today.slice(0, 8)}01`;
  const to = isDay(input.to) ? input.to : today;
  if (to < from) throw new CrmError(400, "The start date is after the end date.", "CRM_REPORT_INVALID");
  return { from, to };
}

// input: { from?, to?, teamId? } — one row per visible person, with totals.
export async function getActivityReport(client, context, input = {}) {
  requireCrm(context);
  const { from, to } = period(input);
  const values = [context.organizationId, from, to];
  const people = peopleSql(context, values, { teamId: input.teamId ?? null });
  const local = (column) => `(${column} AT TIME ZONE ${ZONE})::date`;
  const done = (type) => `count(*) FILTER (WHERE activity.activity_type = '${type}' AND activity.status = 'completed' AND NOT activity.is_inbound
                                          AND ${local("COALESCE(activity.completed_at, activity.start_at, activity.created_at)")} BETWEEN $2::date AND $3::date)::int`;
  const { rows } = await client.query(
    `WITH people AS (${people})
     SELECT people.id AS user_id, people.full_name AS name,
            ${done("call")} AS calls, ${done("email")} AS emails, ${done("meeting")} AS meetings, ${done("whatsapp")} AS whatsapp, ${done("sms")} AS sms,
            ${done("task")} AS tasks_done, ${done("follow_up")} AS follow_ups_done,
            count(*) FILTER (WHERE activity.activity_type IN ('task', 'follow_up') AND activity.status IN ('planned', 'in_progress', 'overdue') AND activity.due_at < now())::int AS overdue,
            count(DISTINCT activity.entity_id) FILTER (WHERE activity.entity_type = 'lead' AND activity.status = 'completed' AND NOT activity.is_inbound
                                                       AND ${local("COALESCE(activity.completed_at, activity.created_at)")} BETWEEN $2::date AND $3::date)::int AS leads_touched,
            count(DISTINCT activity.entity_id) FILTER (WHERE activity.entity_type = 'opportunity' AND activity.status = 'completed' AND NOT activity.is_inbound
                                                       AND ${local("COALESCE(activity.completed_at, activity.created_at)")} BETWEEN $2::date AND $3::date)::int AS deals_touched
       FROM people
       LEFT JOIN tenant.crm_activities activity ON activity.organization_id = $1
             AND (activity.assigned_to = people.id OR (activity.assigned_to IS NULL AND activity.created_by = people.id))
      GROUP BY people.id, people.full_name ORDER BY lower(people.full_name)`, values);
  const keys = ["calls", "emails", "meetings", "whatsapp", "sms", "tasks_done", "follow_ups_done", "overdue", "leads_touched", "deals_touched"];
  const camel = (key) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const people_ = rows.map((row) => ({ userId: row.user_id, name: row.name, ...Object.fromEntries(keys.map((key) => [camel(key), num(row[key])])),
    total: ["calls", "emails", "meetings", "whatsapp", "sms"].reduce((total, key) => total + num(row[key]), 0) }));
  const totals = Object.fromEntries([...keys.map(camel), "total"].map((key) => [key, people_.reduce((total, person) => total + person[key], 0)]));
  return { from, to, people: people_, totals };
}

// ------------------------------------------------------------------ targets

export function listTargetMetrics() {
  return TARGET_METRICS;
}

const monthStart = (value) => {
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (isDay(text)) return `${text.slice(0, 7)}-01`;
  return null;
};

// input: { month: "YYYY-MM", targets: [{ userId, metric, target | null }] } — a null target removes it.
export async function setSalesTargets(client, context, input = {}) {
  if (!(context.roleSlugs?.includes("organization_owner") || SETTERS.some((permission) => context.permissions?.includes(permission))))
    throw new CrmError(403, "You do not have permission to set targets.", "PERMISSION_DENIED");
  const month = monthStart(input.month);
  if (!month) throw invalid("month", "Choose the month.");
  const entries = Array.isArray(input.targets) ? input.targets : [];
  if (entries.length > 500) throw invalid("targets", "Set at most 500 targets at once.");
  const values = [context.organizationId];
  const visible = new Set((await client.query(peopleSql(context, values), values)).rows.map((row) => row.id));
  for (const entry of entries) {
    if (!TARGET_METRICS.some((metric) => metric.key === entry.metric)) throw invalid("metric", "Choose what the target measures.");
    if (!visible.has(entry.userId)) throw invalid("userId", "You can set targets only for people whose work you see.");
    if (entry.target === null || entry.target === undefined || String(entry.target).trim() === "") {
      await client.query("DELETE FROM tenant.crm_sales_targets WHERE organization_id = $1 AND user_id = $2 AND month = $3 AND metric = $4",
        [context.organizationId, entry.userId, month, entry.metric]);
      continue;
    }
    const target = Number(entry.target);
    if (!Number.isFinite(target) || target < 0) throw invalid("target", "A target is zero or more.");
    await client.query(
      `INSERT INTO tenant.crm_sales_targets (organization_id, user_id, month, metric, target, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (organization_id, user_id, month, metric) DO UPDATE SET target = EXCLUDED.target, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [context.organizationId, entry.userId, month, entry.metric, target, context.userId ?? null]);
  }
  return getTargetAttainment(client, context, { month: month.slice(0, 7) });
}

// One month: each visible person's targets and what they did — value and deals won (base currency, by close date), new leads they own
// (by created date) and activities they logged.
export async function getTargetAttainment(client, context, input = {}) {
  requireCrm(context);
  const month = monthStart(input.month) ?? `${new Date().toISOString().slice(0, 7)}-01`;
  const values = [context.organizationId, month];
  const people = peopleSql(context, values, { teamId: input.teamId ?? null });
  const { rows } = await client.query(
    `WITH people AS (${people}),
     span AS (SELECT $2::date AS first_day, ($2::date + interval '1 month' - interval '1 day')::date AS last_day)
     SELECT people.id AS user_id, people.full_name AS name,
            (SELECT COALESCE(sum(COALESCE(deal.won_amount, deal.amount) * CASE WHEN COALESCE(deal.currency_code, org.base_currency) = org.base_currency THEN 1
                     ELSE (SELECT rate.rate FROM tenant.exchange_rates rate WHERE rate.organization_id = deal.organization_id AND rate.from_currency_code = deal.currency_code
                             AND rate.to_currency_code = org.base_currency AND rate.status = 'active' AND rate.rate_date <= deal.actual_close_date ORDER BY rate.rate_date DESC LIMIT 1) END), 0)::float8
               FROM tenant.crm_opportunities deal JOIN public.organizations org ON org.id = deal.organization_id
              WHERE deal.organization_id = $1 AND deal.owner_user_id = people.id AND deal.status = 'won' AND deal.actual_close_date BETWEEN span.first_day AND span.last_day) AS won_value,
            (SELECT count(*)::int FROM tenant.crm_opportunities deal WHERE deal.organization_id = $1 AND deal.owner_user_id = people.id AND deal.status = 'won'
                AND deal.actual_close_date BETWEEN span.first_day AND span.last_day) AS won_count,
            (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.owner_user_id = people.id
                AND (lead.created_at AT TIME ZONE ${ZONE})::date BETWEEN span.first_day AND span.last_day) AS new_leads,
            (SELECT count(*)::int FROM tenant.crm_activities activity WHERE activity.organization_id = $1 AND activity.status = 'completed' AND NOT activity.is_inbound
                AND activity.activity_type IN ('call', 'email', 'meeting', 'whatsapp', 'sms') AND COALESCE(activity.assigned_to, activity.created_by) = people.id
                AND (COALESCE(activity.completed_at, activity.created_at) AT TIME ZONE ${ZONE})::date BETWEEN span.first_day AND span.last_day) AS activities,
            (SELECT jsonb_object_agg(target.metric, target.target) FROM tenant.crm_sales_targets target
              WHERE target.organization_id = $1 AND target.user_id = people.id AND target.month = span.first_day) AS targets
       FROM people, span ORDER BY lower(people.full_name)`, values);
  const out = rows.map((row) => ({
    userId: row.user_id, name: row.name,
    measures: Object.fromEntries(TARGET_METRICS.map(({ key }) => {
      const target = row.targets?.[key] === undefined ? null : num(row.targets[key]);
      const actual = num(row[key]);
      return [key, { actual, target, attainment: target ? Math.round((actual / target) * 1000) / 10 : null }];
    })),
  }));
  const canSet = Boolean(context.roleSlugs?.includes("organization_owner") || SETTERS.some((permission) => context.permissions?.includes(permission)));
  return { month: month.slice(0, 7), metrics: TARGET_METRICS, people: out, canSet, currency: await reportingCurrencyOf(client, context.organizationId) };
}
