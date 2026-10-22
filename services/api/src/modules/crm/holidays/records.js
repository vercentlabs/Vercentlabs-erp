// Holidays (CRM plan 5.6): the organization's days off. Reminders moved into working hours skip them, and a follow-up planned on one
// shows the holiday so it can be moved. India's three national holidays are built in — every year, for every company, without being
// added (NATIONAL_HOLIDAYS) — and the festivals and state days of a state come from presets (presets.js); others are added by date.
import { CrmError } from "../data-management/errors.js";

const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Month-day and name: the national holidays every company has.
export const NATIONAL_HOLIDAYS = Object.freeze([["01-26", "Republic Day"], ["08-15", "Independence Day"], ["10-02", "Gandhi Jayanti"]]);

// The national holidays between two days (YYYY-MM-DD, both included), as { day, name }.
export function nationalHolidaysBetween(from, to) {
  const out = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1)
    for (const [monthDay, name] of NATIONAL_HOLIDAYS) {
      const day = `${year}-${monthDay}`;
      if (day >= from && day <= to) out.push({ day, name });
    }
  return out;
}

// SQL: the national holiday's name on a date expression, else NULL (for queries that read crm_holidays).
export const nationalHolidaySql = (dateSql) =>
  `CASE to_char(${dateSql}, 'MM-DD') ${NATIONAL_HOLIDAYS.map(([monthDay, name]) => `WHEN '${monthDay}' THEN '${name}'`).join(" ")} END`;
const invalid = (field, message) => new CrmError(400, message, "CRM_HOLIDAY_VALIDATION", { issues: [{ field, message }] });
const NATIONAL_DAYS = new Set(NATIONAL_HOLIDAYS.map(([monthDay]) => monthDay));
const toHoliday = (row) => ({ id: row.id, date: row.day, name: row.name, national: NATIONAL_DAYS.has(row.day.slice(5)) });

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage holidays.", "PERMISSION_DENIED");
}

// The holidays of a year (default: this year and next): the ones added, with the national holidays always among them (national: true;
// a built-in one has the id "national-YYYY-MM-DD" and cannot be removed).
export async function listHolidays(client, context, { year = null } = {}) {
  const { rows } = await client.query(
    `SELECT id, name, to_char(holiday_date, 'YYYY-MM-DD') AS day, extract(year FROM current_date)::int AS this_year FROM tenant.crm_holidays
      WHERE organization_id = $1 AND ($2::int IS NULL AND holiday_date >= date_trunc('year', current_date) AND holiday_date < date_trunc('year', current_date) + interval '2 years'
             OR extract(year FROM holiday_date) = $2::int)
      ORDER BY holiday_date`, [context.organizationId, year ? Number(year) : null]);
  const firstYear = year ? Number(year) : Number(rows[0]?.this_year ?? new Date().getFullYear());
  const lastYear = year ? Number(year) : firstYear + 1;
  const stored = new Set(rows.map((row) => row.day));
  const builtIn = nationalHolidaysBetween(`${firstYear}-01-01`, `${lastYear}-12-31`).filter((entry) => !stored.has(entry.day))
    .map((entry) => ({ id: `national-${entry.day}`, day: entry.day, name: entry.name }));
  return [...rows, ...builtIn].sort((a, b) => a.day.localeCompare(b.day)).map(toHoliday);
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
  if (String(holidayId ?? "").startsWith("national-")) throw new CrmError(409, "National holidays are always holidays.", "CRM_HOLIDAY_NATIONAL");
  if (!UUID.test(String(holidayId ?? ""))) throw new CrmError(404, "Holiday not found.", "CRM_HOLIDAY_NOT_FOUND");
  const { rowCount } = await client.query("DELETE FROM tenant.crm_holidays WHERE organization_id = $1 AND id = $2", [context.organizationId, holidayId]);
  if (!rowCount) throw new CrmError(404, "Holiday not found.", "CRM_HOLIDAY_NOT_FOUND");
  return { removed: true };
}
