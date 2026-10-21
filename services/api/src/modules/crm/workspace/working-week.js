// The organization's working week (M3): the days it works, its hours, which Saturdays of the month are off, on its own clock, plus its
// holidays — the schedule reminders, the lead first-response time and the stage time limits count in (activities/shared/business-hours.js).
// Stored on the CRM settings row (migration 0217); an organization that never saved one works Monday–Saturday, 10:00–19:00.
export const STANDARD_WORKING_WEEK = Object.freeze({ workingDays: [1, 2, 3, 4, 5, 6], workStart: "10:00", workEnd: "19:00", saturdaysOff: [] });

export async function getWorkingWeek(client, organizationId) {
  const row = (await client.query("SELECT working_days, work_start, work_end, saturdays_off FROM tenant.crm_settings WHERE organization_id = $1", [organizationId])).rows[0];
  if (!row) return { ...STANDARD_WORKING_WEEK };
  return { workingDays: row.working_days.map(Number), workStart: row.work_start, workEnd: row.work_end, saturdaysOff: row.saturdays_off.map(Number) };
}

// The schedule for business-hours.js: the working week, the organization's time zone and its holidays from yesterday to a year ahead.
export async function workSchedule(client, organizationId) {
  const week = await getWorkingWeek(client, organizationId);
  const timezone = (await client.query("SELECT timezone FROM public.organizations WHERE id = $1", [organizationId])).rows[0]?.timezone || "Asia/Kolkata";
  const holidays = (await client.query(
    "SELECT to_char(holiday_date, 'YYYY-MM-DD') AS day FROM tenant.crm_holidays WHERE organization_id = $1 AND holiday_date BETWEEN current_date - 400 AND current_date + 400",
    [organizationId])).rows.map((row) => row.day);
  return { timezone, weekdays: week.workingDays, start: week.workStart, end: week.workEnd, saturdaysOff: week.saturdaysOff, holidays };
}
