// Holidays (CRM plan 5.6): the organization's days off. Reminders moved into working hours skip them, and a follow-up planned on one
// shows the holiday so it can be moved. India's three national holidays can be added for a year in one go; festivals and state
// holidays, which move each year, are added by date.
import { CrmError } from "../data-management/errors.js";

const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NATIONAL = Object.freeze([["01-26", "Republic Day"], ["08-15", "Independence Day"], ["10-02", "Gandhi Jayanti"]]);
const invalid = (field, message) => new CrmError(400, message, "CRM_HOLIDAY_VALIDATION", { issues: [{ field, message }] });
const toHoliday = (row) => ({ id: row.id, date: row.day, name: row.name });

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage holidays.", "PERMISSION_DENIED");
}

// The holidays of a year (default: this year and next).
export async function listHolidays(client, context, { year = null } = {}) {
  const { rows } = await client.query(
    `SELECT id, name, to_char(holiday_date, 'YYYY-MM-DD') AS day FROM tenant.crm_holidays
      WHERE organization_id = $1 AND ($2::int IS NULL AND holiday_date >= date_trunc('year', current_date) AND holiday_date < date_trunc('year', current_date) + interval '2 years'
             OR extract(year FROM holiday_date) = $2::int)
      ORDER BY holiday_date`, [context.organizationId, year ? Number(year) : null]);
  return rows.map(toHoliday);
}

// input: { date: YYYY-MM-DD, name } — a date already a holiday is renamed.
export async function addHoliday(client, context, input = {}) {
  requireManage(context);
  const date = String(input.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw invalid("date", "Choose the date.");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 80) throw invalid("name", "Name the holiday (up to 80 characters).");
  const row = (await client.query(
    `INSERT INTO tenant.crm_holidays (organization_id, holiday_date, name, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, holiday_date) DO UPDATE SET name = EXCLUDED.name RETURNING id, name, to_char(holiday_date, 'YYYY-MM-DD') AS day`,
    [context.organizationId, date, name, context.userId ?? null])).rows[0];
  return toHoliday(row);
}

export async function removeHoliday(client, context, holidayId) {
  requireManage(context);
  if (!UUID.test(String(holidayId ?? ""))) throw new CrmError(404, "Holiday not found.", "CRM_HOLIDAY_NOT_FOUND");
  const { rowCount } = await client.query("DELETE FROM tenant.crm_holidays WHERE organization_id = $1 AND id = $2", [context.organizationId, holidayId]);
  if (!rowCount) throw new CrmError(404, "Holiday not found.", "CRM_HOLIDAY_NOT_FOUND");
  return { removed: true };
}

// Republic Day, Independence Day and Gandhi Jayanti for a year (those already there are kept).
export async function addNationalHolidays(client, context, year) {
  requireManage(context);
  const value = Number(year);
  if (!Number.isInteger(value) || value < 2000 || value > 2100) throw invalid("year", "Choose a year.");
  let added = 0;
  for (const [day, name] of NATIONAL) {
    const { rowCount } = await client.query(
      "INSERT INTO tenant.crm_holidays (organization_id, holiday_date, name, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, holiday_date) DO NOTHING",
      [context.organizationId, `${value}-${day}`, name, context.userId ?? null]);
    added += rowCount;
  }
  return { added, holidays: await listHolidays(client, context, { year: value }) };
}
