// F403-F409, F415: shifts and assignment, holiday calendars, check-in/out punches, the daily
// attendance record (late arrival, early exit, overtime), regularization, and the attendance
// summary payroll consumes.
import {
  HrError, addDays, dateOrNull, dateRequired, has, hasAny, need, needAny, nonNegative, oneOf, ownEmployee, positive, qx, recordEvent, seq, text, textOrNull, today, uuid, uuidOrNull, ymd,
} from "./common.js";

const LIVE = ["active", "on_leave", "on_notice"];
const MANAGE = "hr_payroll.attendance.manage";
const VIEW = [MANAGE, "hr_payroll.employee.view", "hr_payroll.employee.manage", "hr_payroll.reports.view"];

async function settings(client, c) {
  await qx(client, `INSERT INTO tenant.hr_payroll_settings(organization_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.organizationId, c.companyId]);
  return (await qx(client, `SELECT * FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId])).rows[0];
}
async function orgZone(client, c) {
  const { rows } = await qx(client, `SELECT coalesce(timezone,'UTC') AS tz FROM public.organizations WHERE id=$1`, [c.organizationId]);
  return rows[0]?.tz || "UTC";
}
async function loadEmployee(client, c, id) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Employee")]);
  if (!rows[0]) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  return rows[0];
}
export async function isManagerOf(client, c, employee) {
  const own = await ownEmployee(client, c);
  return Boolean(own && employee.manager_employee_id === own.id);
}
// An employee acting on their own record, HR with the permission, or the direct manager (for approvals).
async function actor(client, c, employeeId, { perm = MANAGE, allowManager = false } = {}) {
  const employee = await loadEmployee(client, c, employeeId);
  const own = await ownEmployee(client, c);
  const isSelf = Boolean(own && own.id === employee.id);
  const isManager = allowManager && (await isManagerOf(client, c, employee));
  const isHr = has(c, perm);
  return { employee, isSelf, isManager, isHr };
}

// ---------------------------------------------------------------- shifts (F403)
export async function listShifts(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.shift.manage", MANAGE]);
  const { rows } = await qx(client, `SELECT s.*, (SELECT count(*) FROM tenant.hr_employee_shift_assignments a WHERE a.shift_id=s.id AND (a.effective_to IS NULL OR a.effective_to >= current_date))::int AS assigned FROM tenant.hr_shifts s WHERE s.organization_id=$1 AND s.company_id=$2 ORDER BY s.code`, [c.organizationId, c.companyId]);
  return rows;
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export async function saveShift(client, c, input) {
  need(c, "hr_payroll.shift.manage");
  const code = text(input.code, 20).toUpperCase();
  const name = text(input.name, 80);
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) throw new HrError(400, "Shift code must be letters, digits, - or _.", "HR_SHIFT_INVALID");
  if (!name) throw new HrError(400, "Shift name is required.", "HR_SHIFT_INVALID");
  const start = text(input.startTime, 8);
  const end = text(input.endTime, 8);
  if (!TIME.test(start) || !TIME.test(end)) throw new HrError(400, "Start and end times must look like 09:00.", "HR_SHIFT_INVALID");
  const overnight = input.overnight === true;
  if (start === end) throw new HrError(400, "A shift cannot start and end at the same time.", "HR_SHIFT_INVALID");
  if (end < start && !overnight) throw new HrError(400, "This shift ends before it starts. Mark it as an overnight shift.", "HR_SHIFT_OVERNIGHT");
  if (end > start && overnight) throw new HrError(400, "An overnight shift ends after midnight, so its end time is earlier than its start.", "HR_SHIFT_OVERNIGHT");
  const days = Array.isArray(input.workingDays) ? [...new Set(input.workingDays.map(Number))].sort() : [1, 2, 3, 4, 5];
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new HrError(400, "Working days are 1 (Monday) to 7 (Sunday).", "HR_SHIFT_INVALID");
  const minutes = ((Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5))) + 1440) % 1440);
  const brk = Math.trunc(nonNegative(input.breakMinutes, "Break"));
  if (brk >= minutes) throw new HrError(400, "The break is as long as the shift.", "HR_SHIFT_INVALID");
  const grace = Math.trunc(nonNegative(input.graceMinutes, "Grace"));
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.hr_shifts SET name=$4, start_time=$5, end_time=$6, break_minutes=$7, grace_minutes=$8, working_days=$9::jsonb, overnight=$10, active=$11 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Shift"), name, start, end, brk, grace, JSON.stringify(days), overnight, input.active !== false]);
    if (!rows[0]) throw new HrError(404, "Shift was not found.", "HR_SHIFT_NOT_FOUND");
    return rows[0];
  }
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_shifts WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code]);
  if (dup.rows[0]) throw new HrError(409, `Shift ${code} already exists.`, "HR_SHIFT_DUPLICATE");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_shifts(organization_id,company_id,code,name,start_time,end_time,break_minutes,grace_minutes,working_days,overnight,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) RETURNING *`,
    [c.organizationId, c.companyId, code, name, start, end, brk, grace, JSON.stringify(days), overnight, input.active !== false, c.userId]);
  return rows[0];
}

export async function listShiftAssignments(client, c, filters = {}) {
  needAny(c, ["hr_payroll.shift.manage", ...VIEW]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra = ` AND a.employee_id=$3`; }
  const { rows } = await qx(client, `SELECT a.*, s.code AS shift_code, s.name AS shift_name, s.start_time, s.end_time, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name
    FROM tenant.hr_employee_shift_assignments a JOIN tenant.hr_shifts s ON s.id=a.shift_id JOIN tenant.hr_employees e ON e.id=a.employee_id
    WHERE a.organization_id=$1 AND e.company_id=$2${extra} ORDER BY a.effective_from DESC LIMIT 1000`, params);
  return rows;
}
export async function assignShift(client, c, input) {
  need(c, "hr_payroll.shift.manage");
  const e = await loadEmployee(client, c, input.employeeId);
  if (e.status === "separated") throw new HrError(409, "A separated employee cannot be assigned a shift.", "HR_EMPLOYEE_CLOSED");
  const shift = (await qx(client, `SELECT * FROM tenant.hr_shifts WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, uuid(input.shiftId, "Shift")])).rows[0];
  if (!shift) throw new HrError(400, "Shift was not found or is inactive.", "HR_SHIFT_NOT_FOUND");
  const from = dateRequired(input.effectiveFrom, "Effective from");
  const to = dateOrNull(input.effectiveTo, "Effective to");
  if (to && to < from) throw new HrError(400, "The end date is before the start date.", "HR_SHIFT_INVALID");
  const later = await qx(client, `SELECT 1 FROM tenant.hr_employee_shift_assignments WHERE employee_id=$1 AND effective_from >= $2 AND ($3::date IS NULL OR effective_from <= $3::date)`, [e.id, from, to]);
  if (later.rows[0]) throw new HrError(409, "This overlaps a later shift assignment for the employee.", "HR_SHIFT_OVERLAP");
  // the previous open-ended assignment ends the day before this one begins
  await qx(client, `UPDATE tenant.hr_employee_shift_assignments SET effective_to=$2::date - 1 WHERE employee_id=$1 AND effective_from < $2 AND (effective_to IS NULL OR effective_to >= $2)`, [e.id, from]);
  const { rows } = await qx(client, `INSERT INTO tenant.hr_employee_shift_assignments(organization_id,employee_id,shift_id,effective_from,effective_to,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [c.organizationId, e.id, shift.id, from, to, c.userId]);
  await recordEvent(client, c, "employee", e.id, "hr.shift.assigned", { shift: shift.code, from });
  return rows[0];
}

// ---------------------------------------------------------------- holidays (F415)
export async function listHolidayCalendars(client, c) {
  needAny(c, ["hr_payroll.view", ...VIEW]);
  const { rows } = await qx(client, `SELECT h.*, (SELECT count(*) FROM tenant.hr_holidays d WHERE d.calendar_id=h.id)::int AS holidays, (SELECT count(*) FROM tenant.hr_employees e WHERE e.holiday_calendar_id=h.id)::int AS employees FROM tenant.hr_holiday_calendars h WHERE h.organization_id=$1 AND h.company_id=$2 ORDER BY h.code`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveHolidayCalendar(client, c, input) {
  need(c, "hr_payroll.settings.manage");
  const code = text(input.code, 20).toUpperCase();
  const name = text(input.name, 80);
  if (!/^[A-Z0-9_-]{1,20}$/.test(code) || !name) throw new HrError(400, "A calendar needs a code and a name.", "HR_CALENDAR_INVALID");
  const makeDefault = input.isDefault === true;
  if (makeDefault) await qx(client, `UPDATE tenant.hr_holiday_calendars SET is_default=false WHERE organization_id=$1 AND company_id=$2 AND is_default AND ($3::uuid IS NULL OR id <> $3::uuid)`, [c.organizationId, c.companyId, uuidOrNull(input.id, "Calendar")]);
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.hr_holiday_calendars SET name=$4, is_default=$5, active=$6 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(input.id, "Calendar"), name, makeDefault, input.active !== false]);
    if (!rows[0]) throw new HrError(404, "Calendar was not found.", "HR_CALENDAR_NOT_FOUND");
    return rows[0];
  }
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_holiday_calendars WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code]);
  if (dup.rows[0]) throw new HrError(409, `Calendar ${code} already exists.`, "HR_CALENDAR_DUPLICATE");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_holiday_calendars(organization_id,company_id,code,name,is_default,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [c.organizationId, c.companyId, code, name, makeDefault, c.userId]);
  return rows[0];
}
export async function listHolidays(client, c, filters = {}) {
  needAny(c, ["hr_payroll.view", ...VIEW]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.calendarId) { params.push(uuid(filters.calendarId, "Calendar")); extra += ` AND d.calendar_id=$${params.length}`; }
  if (filters.year) { params.push(Math.trunc(Number(filters.year))); extra += ` AND extract(year FROM d.holiday_date)=$${params.length}`; }
  const { rows } = await qx(client, `SELECT d.*, h.code AS calendar_code, h.name AS calendar_name FROM tenant.hr_holidays d JOIN tenant.hr_holiday_calendars h ON h.id=d.calendar_id WHERE d.organization_id=$1 AND h.company_id=$2${extra} ORDER BY d.holiday_date LIMIT 1000`, params);
  return rows;
}
export async function addHoliday(client, c, input) {
  need(c, "hr_payroll.settings.manage");
  const cal = (await qx(client, `SELECT id FROM tenant.hr_holiday_calendars WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.calendarId, "Calendar")])).rows[0];
  if (!cal) throw new HrError(404, "Calendar was not found.", "HR_CALENDAR_NOT_FOUND");
  const date = dateRequired(input.holidayDate, "Holiday date");
  const name = text(input.name, 120);
  if (!name) throw new HrError(400, "A holiday needs a name.", "HR_HOLIDAY_INVALID");
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_holidays WHERE calendar_id=$1 AND holiday_date=$2`, [cal.id, date]);
  if (dup.rows[0]) throw new HrError(409, "That date already has a holiday in this calendar.", "HR_HOLIDAY_DUPLICATE");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_holidays(organization_id,calendar_id,holiday_date,name,holiday_type,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [c.organizationId, cal.id, date, name, oneOf(String(input.holidayType ?? "public"), ["public", "optional", "restricted"], "Holiday type"), c.userId]);
  return rows[0];
}
export async function removeHoliday(client, c, id) {
  need(c, "hr_payroll.settings.manage");
  const { rows } = await qx(client, `DELETE FROM tenant.hr_holidays WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, uuid(id, "Holiday")]);
  if (!rows[0]) throw new HrError(404, "Holiday was not found.", "HR_HOLIDAY_NOT_FOUND");
  return rows[0];
}
export async function assignHolidayCalendar(client, c, input) {
  need(c, "hr_payroll.settings.manage");
  const ids = Array.isArray(input.employeeIds) ? input.employeeIds.map((x) => uuid(x, "Employee")) : [uuid(input.employeeId, "Employee")];
  const calendarId = uuidOrNull(input.calendarId, "Calendar");
  if (calendarId && !(await qx(client, `SELECT 1 FROM tenant.hr_holiday_calendars WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, calendarId])).rows[0]) throw new HrError(404, "Calendar was not found.", "HR_CALENDAR_NOT_FOUND");
  const { rowCount } = await qx(client, `UPDATE tenant.hr_employees SET holiday_calendar_id=$3, updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id = ANY($4::uuid[])`, [c.organizationId, c.companyId, calendarId, ids]);
  return { updated: rowCount };
}

// ---------------------------------------------------------------- working pattern for a date
// Everything payroll and leave need to know about a day for an employee.
export async function loadDayContext(client, c, employee, from, to) {
  const shifts = await qx(client, `SELECT a.effective_from, a.effective_to, s.* FROM tenant.hr_employee_shift_assignments a JOIN tenant.hr_shifts s ON s.id=a.shift_id WHERE a.employee_id=$1 AND a.effective_from <= $3 AND (a.effective_to IS NULL OR a.effective_to >= $2) ORDER BY a.effective_from`, [employee.id, from, to]);
  const cal = employee.holiday_calendar_id ?? (await qx(client, `SELECT id FROM tenant.hr_holiday_calendars WHERE organization_id=$1 AND company_id=$2 AND is_default AND active`, [c.organizationId, c.companyId])).rows[0]?.id;
  const hol = cal ? await qx(client, `SELECT holiday_date, name FROM tenant.hr_holidays WHERE calendar_id=$1 AND holiday_type='public' AND holiday_date BETWEEN $2 AND $3`, [cal, from, to]) : { rows: [] };
  const holidays = new Map(hol.rows.map((h) => [h.holiday_date, h.name]));
  return {
    holidays,
    shiftFor(date) {
      return shifts.rows.find((s) => s.effective_from <= date && (!s.effective_to || s.effective_to >= date)) ?? null;
    },
    isoWeekday(date) {
      const d = new Date(`${date}T00:00:00Z`).getUTCDay();
      return d === 0 ? 7 : d;
    },
    classify(date) {
      const shift = this.shiftFor(date);
      const days = shift ? shift.working_days : [1, 2, 3, 4, 5];
      if (holidays.has(date)) return { kind: "holiday", name: holidays.get(date), shift };
      if (!days.includes(this.isoWeekday(date))) return { kind: "weekly_off", shift };
      return { kind: "working", shift };
    },
  };
}
const dayRange = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const minutesOf = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
const shiftMinutes = (s) => (s ? ((minutesOf(s.end_time) - minutesOf(s.start_time) + 1440) % 1440) - Number(s.break_minutes) : 480);

async function assertDateOpen(client, c, date) {
  const r = await qx(client, `SELECT payroll_number, status FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND status IN ('approved','posted','paid') AND period_start <= $3 AND period_end >= $3 LIMIT 1`, [c.organizationId, c.companyId, date]);
  if (r.rows[0]) throw new HrError(409, `${date} is in payroll ${r.rows[0].payroll_number}, which is ${r.rows[0].status}. Attendance for it is locked.`, "HR_PERIOD_LOCKED");
  // a payroll period that has been locked (or closed) freezes attendance even before a run exists
  const p = await qx(client, `SELECT period_code, status FROM tenant.hr_payroll_periods WHERE organization_id=$1 AND company_id=$2 AND status IN ('locked','closed') AND period_start <= $3 AND period_end >= $3 LIMIT 1`, [c.organizationId, c.companyId, date]);
  if (p.rows[0]) throw new HrError(409, `${date} is in payroll period ${p.rows[0].period_code}, which is ${p.rows[0].status}. Attendance for it is locked.`, "HR_PERIOD_LOCKED");
}
export { assertDateOpen };

// ---------------------------------------------------------------- daily attendance (F404-F408)
async function localDate(client, tz, when) {
  return (await qx(client, `SELECT (($1::timestamptz) AT TIME ZONE $2)::date AS d`, [when, tz])).rows[0].d;
}

// Recompute the attendance row for an employee-date from the punches, the shift and the settings.
export async function recomputeDay(client, c, employee, date) {
  const cfg = await settings(client, c);
  const tz = await orgZone(client, c);
  const ctx = await loadDayContext(client, c, employee, date, date);
  const { kind, shift, name } = ctx.classify(date);
  const existing = (await qx(client, `SELECT * FROM tenant.hr_attendance WHERE employee_id=$1 AND attendance_date=$2`, [employee.id, date])).rows[0];
  // approved leave and a deliberate manual override are not re-derived from punches
  if (existing && (existing.leave_request_id || (existing.source === "manual" && existing.override_reason))) return existing;
  const windowEnd = shift?.overnight ? "($2::date + 2)::timestamp" : "($2::date + 1)::timestamp";
  const punches = (await qx(client, `SELECT punched_at, direction, source FROM tenant.hr_attendance_punches WHERE organization_id=$1 AND employee_id=$3 AND (punched_at AT TIME ZONE $4) >= $2::date::timestamp AND (punched_at AT TIME ZONE $4) < ${windowEnd} ORDER BY punched_at`, [c.organizationId, date, employee.id, tz])).rows;
  // the first 'in' anchors the day; an 'out' before any 'in' belongs to the previous (overnight) day
  const usable = [];
  let open = null;
  for (const p of punches) {
    if (p.direction === "in" && open === null) { open = p.punched_at; usable.push({ in: p.punched_at, out: null }); }
    else if (p.direction === "out" && open !== null) { usable[usable.length - 1].out = p.punched_at; open = null; }
  }
  let worked = 0;
  for (const u of usable) if (u.out) worked += Math.round((new Date(u.out) - new Date(u.in)) / 60000);
  const pairs = usable.filter((u) => u.out).length;
  if (pairs === 1 && shift && Number(shift.break_minutes) > 0 && worked > Number(shift.break_minutes) * 3) worked -= Number(shift.break_minutes);
  const firstIn = usable[0]?.in ?? null;
  const lastOut = [...usable].reverse().find((u) => u.out)?.out ?? null;
  const full = shiftMinutes(shift);
  let status;
  let late = 0;
  let early = 0;
  let overtime = 0;
  let notes = null;
  if (!usable.length) {
    if (kind === "holiday") { status = "holiday"; notes = name; } else if (kind === "weekly_off") status = "weekly_off";
    else if (date < today()) { status = "absent"; notes = "No punches recorded"; } else return existing ?? null;
  } else {
    const graceMin = Math.max(Number(shift?.grace_minutes ?? 0), Number(cfg.attendance_grace_minutes ?? 0));
    if (shift && kind === "working") {
      const startAt = (await qx(client, `SELECT (($1::date + $2::time) AT TIME ZONE $3) AS s, (($1::date + $4::time + CASE WHEN $5 THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE $3) AS e`, [date, shift.start_time, tz, shift.end_time, shift.overnight])).rows[0];
      const lateBy = Math.round((new Date(firstIn) - new Date(startAt.s)) / 60000);
      if (lateBy > graceMin) late = lateBy;
      if (lastOut) {
        const earlyBy = Math.round((new Date(startAt.e) - new Date(lastOut)) / 60000);
        if (earlyBy > 0) early = earlyBy;
      }
    }
    if (!lastOut) {
      if (date < today()) { status = "absent"; notes = "Missing check-out. Regularize the day."; } else status = "present";
    } else if (kind !== "working") {
      status = "present";
      overtime = worked >= Number(cfg.overtime_threshold_minutes) ? worked : 0;
    } else if (worked >= Math.floor((full * cfg.full_day_percent) / 100)) {
      status = "present";
      overtime = worked - full >= Number(cfg.overtime_threshold_minutes) ? worked - full : 0;
    } else if (worked >= Math.floor((full * cfg.half_day_percent) / 100)) status = "half_day";
    else status = "absent";
    if (status === "absent" && lastOut) notes = "Worked too little to count as present";
  }
  const source = punches.length ? (punches.some((p) => p.source === "regularized") ? "regularized" : "web") : "system";
  const { rows } = await qx(client,
    `INSERT INTO tenant.hr_attendance(organization_id,company_id,employee_id,attendance_date,shift_id,check_in_at,check_out_at,worked_minutes,overtime_minutes,late_minutes,early_exit_minutes,status,source,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (employee_id,attendance_date) DO UPDATE SET shift_id=EXCLUDED.shift_id, check_in_at=EXCLUDED.check_in_at, check_out_at=EXCLUDED.check_out_at, worked_minutes=EXCLUDED.worked_minutes, overtime_minutes=EXCLUDED.overtime_minutes,
       late_minutes=EXCLUDED.late_minutes, early_exit_minutes=EXCLUDED.early_exit_minutes, status=EXCLUDED.status, source=EXCLUDED.source, notes=EXCLUDED.notes, updated_at=now() RETURNING *`,
    [c.organizationId, c.companyId, employee.id, date, shift?.id ?? null, firstIn, lastOut, Math.max(worked, 0), overtime, late, early, status, source, notes, c.userId]);
  const row = rows[0];
  if (overtime > 0) {
    await qx(client, `INSERT INTO tenant.hr_overtime(organization_id,company_id,employee_id,work_date,minutes) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (employee_id,work_date) DO UPDATE SET minutes=EXCLUDED.minutes WHERE tenant.hr_overtime.status='pending'`, [c.organizationId, c.companyId, employee.id, date, overtime]);
  } else {
    await qx(client, `DELETE FROM tenant.hr_overtime WHERE employee_id=$1 AND work_date=$2 AND status='pending'`, [employee.id, date]);
  }
  return row;
}

export async function punch(client, c, input) {
  const own = await ownEmployee(client, c);
  if (!input.employeeId && !own) throw new HrError(404, "Your user is not linked to an employee record. Ask HR to link it.", "HR_NO_EMPLOYEE_PROFILE");
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const { employee, isSelf, isHr } = await actor(client, c, employeeId);
  if (!isSelf && !isHr) throw new HrError(403, "You can only record your own attendance.", "HR_FORBIDDEN");
  if (!LIVE.includes(employee.status)) throw new HrError(409, "Only a current employee can be recorded.", "HR_EMPLOYEE_STATE");
  const direction = oneOf(String(input.direction), ["in", "out"], "Direction");
  // an employee punches at the server's time; only HR may record a past time
  const at = input.at && isHr ? new Date(String(input.at)) : new Date();
  if (Number.isNaN(at.getTime())) throw new HrError(400, "That time is not valid.", "HR_PUNCH_INVALID");
  if (at.getTime() > Date.now() + 5 * 60000) throw new HrError(400, "A punch cannot be in the future.", "HR_PUNCH_INVALID");
  const tz = await orgZone(client, c);
  const date = await localDate(client, tz, at.toISOString());
  if (date < employee.joining_date) throw new HrError(400, "That is before the employee joined.", "HR_PUNCH_INVALID");
  await assertDateOpen(client, c, date);
  const last = (await qx(client, `SELECT direction, punched_at FROM tenant.hr_attendance_punches WHERE organization_id=$1 AND employee_id=$2 ORDER BY punched_at DESC LIMIT 1`, [c.organizationId, employee.id])).rows[0];
  if (last && new Date(last.punched_at).getTime() >= at.getTime()) throw new HrError(409, "There is a later punch already recorded.", "HR_PUNCH_ORDER");
  if (direction === "in" && last?.direction === "in") throw new HrError(409, "You are already checked in. Check out first.", "HR_ALREADY_CHECKED_IN");
  if (direction === "out" && (!last || last.direction === "out")) throw new HrError(409, "You are not checked in.", "HR_NOT_CHECKED_IN");
  const source = oneOf(String(input.source ?? "web"), ["web", "mobile", "biometric", "import"], "Source");
  const lat = input.latitude === undefined || input.latitude === "" ? null : Number(input.latitude);
  const lon = input.longitude === undefined || input.longitude === "" ? null : Number(input.longitude);
  if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lon !== null && !(lon >= -180 && lon <= 180))) throw new HrError(400, "That location is not valid.", "HR_PUNCH_INVALID");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_attendance_punches(organization_id,company_id,employee_id,punched_at,direction,source,latitude,longitude,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, employee.id, at.toISOString(), direction, source, lat, lon, textOrNull(input.note, 300), c.userId]);
  // an 'out' after midnight closes the previous day's overnight 'in'
  let attendanceDate = date;
  if (direction === "out" && last) attendanceDate = await localDate(client, tz, last.punched_at);
  const day = await recomputeDay(client, c, employee, attendanceDate);
  return { punch: rows[0], attendance: day };
}

export async function recordAttendance(client, c, input) {
  need(c, MANAGE);
  const employee = await loadEmployee(client, c, input.employeeId);
  const date = dateRequired(input.attendanceDate, "Date");
  if (date > today()) throw new HrError(400, "Attendance cannot be recorded for a future date.", "HR_ATTENDANCE_INVALID");
  if (date < employee.joining_date) throw new HrError(400, "That is before the employee joined.", "HR_ATTENDANCE_INVALID");
  if (employee.separation_date && date > employee.separation_date) throw new HrError(400, "That is after the employee left.", "HR_ATTENDANCE_INVALID");
  await assertDateOpen(client, c, date);
  const status = oneOf(String(input.status), ["present", "absent", "half_day", "remote", "holiday", "weekly_off"], "Status");
  if (!text(input.reason)) throw new HrError(400, "Give the reason for recording attendance by hand.", "HR_REASON_REQUIRED");
  const cur = (await qx(client, `SELECT * FROM tenant.hr_attendance WHERE employee_id=$1 AND attendance_date=$2`, [employee.id, date])).rows[0];
  if (cur?.leave_request_id) throw new HrError(409, "That day is covered by approved leave. Cancel the leave first.", "HR_ATTENDANCE_ON_LEAVE");
  const cin = input.checkIn ? new Date(String(input.checkIn)) : null;
  const cout = input.checkOut ? new Date(String(input.checkOut)) : null;
  if ((cin && Number.isNaN(cin.getTime())) || (cout && Number.isNaN(cout.getTime())) || (cin && cout && cout <= cin)) throw new HrError(400, "The check-in and check-out times are not valid.", "HR_ATTENDANCE_INVALID");
  const worked = cin && cout ? Math.round((cout - cin) / 60000) : 0;
  const { rows } = await qx(client,
    `INSERT INTO tenant.hr_attendance(organization_id,company_id,employee_id,attendance_date,check_in_at,check_out_at,worked_minutes,status,source,notes,override_reason,approved_by,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,$10,$11,$11) ON CONFLICT (employee_id,attendance_date) DO UPDATE SET check_in_at=EXCLUDED.check_in_at, check_out_at=EXCLUDED.check_out_at, worked_minutes=EXCLUDED.worked_minutes, status=EXCLUDED.status,
       source='manual', notes=EXCLUDED.notes, override_reason=EXCLUDED.override_reason, approved_by=EXCLUDED.approved_by, late_minutes=0, early_exit_minutes=0, overtime_minutes=0, updated_at=now() RETURNING *`,
    [c.organizationId, c.companyId, employee.id, date, cin?.toISOString() ?? null, cout?.toISOString() ?? null, worked, status, textOrNull(input.notes, 300), text(input.reason, 300), c.userId]);
  await qx(client, `DELETE FROM tenant.hr_overtime WHERE employee_id=$1 AND work_date=$2 AND status='pending'`, [employee.id, date]);
  await recordEvent(client, c, "employee", employee.id, "hr.attendance.recorded", { date, status, reason: text(input.reason, 300) });
  return rows[0];
}

export async function listAttendance(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  // "Today" is the organisation's calendar day: attendance is recorded against it, and for part of every day it is a day
  // ahead of UTC, which would otherwise hide the record just made.
  const orgToday = await localDate(client, await orgZone(client, c), new Date().toISOString());
  const from = dateOrNull(filters.from, "From") ?? addDays(orgToday, -30);
  const to = dateOrNull(filters.to, "To") ?? orgToday;
  params.push(from, to);
  extra += ` AND a.attendance_date BETWEEN $3 AND $4`;
  if (filters.mine === true || !hasAny(c, VIEW)) {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra += ` AND a.employee_id=$${params.length}`;
  } else if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND a.employee_id=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND a.status=$${params.length}`; }
  if (filters.flag === "late") extra += ` AND a.late_minutes > 0`;
  if (filters.flag === "early") extra += ` AND a.early_exit_minutes > 0`;
  const { rows } = await qx(client, `SELECT a.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, s.code AS shift_code FROM tenant.hr_attendance a JOIN tenant.hr_employees e ON e.id=a.employee_id LEFT JOIN tenant.hr_shifts s ON s.id=a.shift_id WHERE a.organization_id=$1 AND a.company_id=$2${extra} ORDER BY a.attendance_date DESC, e.employee_number LIMIT 2000`, params);
  return rows;
}

export async function getMyPunchState(client, c) {
  const own = await ownEmployee(client, c);
  if (!own) throw new HrError(404, "Your user is not linked to an employee record. Ask HR to link it.", "HR_NO_EMPLOYEE_PROFILE");
  const last = (await qx(client, `SELECT direction, punched_at FROM tenant.hr_attendance_punches WHERE organization_id=$1 AND employee_id=$2 ORDER BY punched_at DESC LIMIT 1`, [c.organizationId, own.id])).rows[0];
  const tz = await orgZone(client, c);
  const day = await qx(client, `SELECT * FROM tenant.hr_attendance WHERE employee_id=$1 AND attendance_date=($2::timestamptz AT TIME ZONE $3)::date`, [own.id, new Date().toISOString(), tz]);
  return { checkedIn: last?.direction === "in", lastPunch: last ?? null, today: day.rows[0] ?? null };
}

// ---------------------------------------------------------------- regularization (F409)
export async function listRegularizations(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra += ` AND r.status=$${params.length}`; }
  if (filters.scope === "mine") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra += ` AND r.employee_id=$${params.length}`;
  } else if (filters.scope === "team") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra += ` AND e.manager_employee_id=$${params.length}`;
  } else needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT r.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_attendance_regularizations r JOIN tenant.hr_employees e ON e.id=r.employee_id WHERE r.organization_id=$1 AND r.company_id=$2${extra} ORDER BY r.created_at DESC LIMIT 500`, params);
  return rows;
}
export async function requestRegularization(client, c, input) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const { employee, isSelf, isHr } = await actor(client, c, employeeId);
  if (!isSelf && !isHr) throw new HrError(403, "You can only request a correction for your own attendance.", "HR_FORBIDDEN");
  const date = dateRequired(input.attendanceDate, "Date");
  if (date > today()) throw new HrError(400, "You cannot correct a future day.", "HR_REGULARIZATION_INVALID");
  if (date < addDays(today(), -31)) throw new HrError(400, "Only the last 31 days can be corrected.", "HR_REGULARIZATION_INVALID");
  if (date < employee.joining_date) throw new HrError(400, "That is before the employee joined.", "HR_REGULARIZATION_INVALID");
  await assertDateOpen(client, c, date);
  if (!text(input.reason)) throw new HrError(400, "Say why the day needs correcting.", "HR_REASON_REQUIRED");
  const cin = input.checkIn ? new Date(String(input.checkIn)) : null;
  const cout = input.checkOut ? new Date(String(input.checkOut)) : null;
  if ((!cin && !cout) || (cin && Number.isNaN(cin.getTime())) || (cout && Number.isNaN(cout.getTime())) || (cin && cout && cout <= cin)) throw new HrError(400, "Give a valid check-in and/or check-out time.", "HR_REGULARIZATION_INVALID");
  const day = (await qx(client, `SELECT * FROM tenant.hr_attendance WHERE employee_id=$1 AND attendance_date=$2`, [employee.id, date])).rows[0];
  if (day?.leave_request_id) throw new HrError(409, "That day is covered by approved leave.", "HR_ATTENDANCE_ON_LEAVE");
  const cfg = await settings(client, c);
  const used = (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_attendance_regularizations WHERE employee_id=$1 AND status IN ('pending','approved') AND date_trunc('month', attendance_date) = date_trunc('month', $2::date)`, [employee.id, date])).rows[0].n;
  if (used >= cfg.regularization_limit_per_month) throw new HrError(409, `The limit of ${cfg.regularization_limit_per_month} corrections a month has been reached.`, "HR_REGULARIZATION_LIMIT");
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_attendance_regularizations WHERE employee_id=$1 AND attendance_date=$2 AND status='pending'`, [employee.id, date]);
  if (dup.rows[0]) throw new HrError(409, "There is already a pending correction for that day.", "HR_REGULARIZATION_OPEN");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_attendance_regularizations(organization_id,company_id,employee_id,attendance_date,requested_check_in,requested_check_out,reason,requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [c.organizationId, c.companyId, employee.id, date, cin?.toISOString() ?? null, cout?.toISOString() ?? null, text(input.reason, 500), c.userId]);
  await recordEvent(client, c, "employee", employee.id, "hr.regularization.requested", { date });
  return rows[0];
}
export async function decideRegularization(client, c, id, { approve, note }) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_attendance_regularizations WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Correction")]);
  const r = rows[0];
  if (!r) throw new HrError(404, "Correction was not found.", "HR_REGULARIZATION_NOT_FOUND");
  const { employee, isManager, isHr } = await actor(client, c, r.employee_id, { allowManager: true });
  if (!isManager && !isHr) throw new HrError(403, "Only the reporting manager or HR can decide a correction.", "HR_FORBIDDEN");
  if (r.status !== "pending") throw new HrError(409, "That correction has already been decided.", "HR_REGULARIZATION_STATE");
  if (r.requested_by === c.userId || employee.user_id === c.userId) throw new HrError(403, "You cannot decide your own correction.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting.", "HR_REASON_REQUIRED");
  if (approve) {
    await assertDateOpen(client, c, r.attendance_date);
    const tz = await orgZone(client, c);
    const pairs = [];
    if (r.requested_check_in) pairs.push(["in", r.requested_check_in]);
    if (r.requested_check_out) pairs.push(["out", r.requested_check_out]);
    for (const [direction, when] of pairs) {
      const clash = await qx(client, `SELECT 1 FROM tenant.hr_attendance_punches WHERE employee_id=$1 AND punched_at=$2`, [employee.id, when]);
      if (!clash.rows[0]) await qx(client, `INSERT INTO tenant.hr_attendance_punches(organization_id,company_id,employee_id,punched_at,direction,source,note,created_by) VALUES ($1,$2,$3,$4,$5,'regularized',$6,$7)`, [c.organizationId, c.companyId, employee.id, when, direction, `Regularization ${r.id}`, c.userId]);
    }
    // a corrected day is derived from its punches again, even if it was overridden by hand before
    await qx(client, `UPDATE tenant.hr_attendance SET override_reason=NULL, source='regularized' WHERE employee_id=$1 AND attendance_date=$2`, [employee.id, r.attendance_date]);
    await recomputeDay(client, c, employee, r.attendance_date);
    void tz;
  }
  const out = await qx(client, `UPDATE tenant.hr_attendance_regularizations SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 RETURNING *`, [r.id, approve ? "approved" : "rejected", c.userId, textOrNull(note)]);
  await recordEvent(client, c, "employee", employee.id, approve ? "hr.regularization.approved" : "hr.regularization.rejected", { date: r.attendance_date });
  return out.rows[0];
}
export async function cancelRegularization(client, c, id) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_attendance_regularizations WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Correction")]);
  const r = rows[0];
  if (!r) throw new HrError(404, "Correction was not found.", "HR_REGULARIZATION_NOT_FOUND");
  if (!(r.requested_by === c.userId || has(c, MANAGE))) throw new HrError(403, "You cannot cancel this correction.", "HR_FORBIDDEN");
  if (r.status !== "pending") throw new HrError(409, "Only a pending correction can be cancelled.", "HR_REGULARIZATION_STATE");
  return (await qx(client, `UPDATE tenant.hr_attendance_regularizations SET status='cancelled', decided_at=now() WHERE id=$1 RETURNING *`, [r.id])).rows[0];
}

// ---------------------------------------------------------------- overtime (F408)
export async function listOvertime(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra += ` AND o.status=$${params.length}`; }
  if (filters.scope === "mine") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra += ` AND o.employee_id=$${params.length}`;
  } else if (filters.scope === "team") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra += ` AND e.manager_employee_id=$${params.length}`;
  } else needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT o.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_overtime o JOIN tenant.hr_employees e ON e.id=o.employee_id WHERE o.organization_id=$1 AND o.company_id=$2${extra} ORDER BY o.work_date DESC LIMIT 1000`, params);
  return rows;
}
export async function decideOvertime(client, c, id, { approve, note }) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_overtime WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Overtime")]);
  const o = rows[0];
  if (!o) throw new HrError(404, "Overtime was not found.", "HR_OVERTIME_NOT_FOUND");
  const { employee, isManager, isHr } = await actor(client, c, o.employee_id, { allowManager: true });
  if (!isManager && !isHr) throw new HrError(403, "Only the reporting manager or HR can decide overtime.", "HR_FORBIDDEN");
  if (employee.user_id === c.userId) throw new HrError(403, "You cannot approve your own overtime.", "SELF_APPROVAL_BLOCKED");
  if (o.status !== "pending") throw new HrError(409, "That overtime has already been decided.", "HR_OVERTIME_STATE");
  await assertDateOpen(client, c, o.work_date);
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting the overtime.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_overtime SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 RETURNING *`, [o.id, approve ? "approved" : "rejected", c.userId, textOrNull(note)]);
  await recordEvent(client, c, "employee", employee.id, approve ? "hr.overtime.approved" : "hr.overtime.rejected", { date: o.work_date, minutes: o.minutes });
  return out.rows[0];
}

// ---------------------------------------------------------------- late / early report (F406, F407)
export async function getLateEarlyReport(client, c, filters = {}) {
  needAny(c, VIEW);
  const from = dateOrNull(filters.from, "From") ?? addDays(today(), -30);
  const to = dateOrNull(filters.to, "To") ?? today();
  const cfg = await settings(client, c);
  const { rows } = await qx(client,
    `SELECT e.id, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name,
       count(*) FILTER (WHERE a.late_minutes > 0)::int AS late_marks, coalesce(sum(a.late_minutes),0)::int AS late_minutes,
       count(*) FILTER (WHERE a.early_exit_minutes > 0)::int AS early_exits, coalesce(sum(a.early_exit_minutes),0)::int AS early_exit_minutes
     FROM tenant.hr_attendance a JOIN tenant.hr_employees e ON e.id=a.employee_id
     WHERE a.organization_id=$1 AND a.company_id=$2 AND a.attendance_date BETWEEN $3 AND $4 AND (a.late_minutes > 0 OR a.early_exit_minutes > 0)
     GROUP BY e.id ORDER BY late_marks DESC, early_exits DESC LIMIT 500`, [c.organizationId, c.companyId, from, to]);
  const per = Number(cfg.late_marks_per_deduction);
  return { from, to, lateMarksPerDeduction: per, rows: rows.map((r) => ({ ...r, deduction_days: per > 0 ? Math.floor((r.late_marks + r.early_exits) / per) * 0.5 : 0 })) };
}

// ---------------------------------------------------------------- summary for payroll (F425)
// Classifies every day of a period for one employee. Payroll turns this into paid and unpaid days.
export async function computeAttendanceSummary(client, c, employeeId, from, to, { runId = null } = {}) {
  const employee = await loadEmployee(client, c, employeeId);
  const ctx = await loadDayContext(client, c, employee, from, to);
  const cfg = await settings(client, c);
  const att = await qx(client, `SELECT a.*, l.leave_type_id, t.paid AS leave_paid, t.code AS leave_code, l.start_half, l.end_half, l.start_date, l.end_date FROM tenant.hr_attendance a LEFT JOIN tenant.hr_leave_requests l ON l.id=a.leave_request_id LEFT JOIN tenant.hr_leave_types t ON t.id=l.leave_type_id WHERE a.employee_id=$1 AND a.attendance_date BETWEEN $2 AND $3`, [employee.id, from, to]);
  const byDate = new Map(att.rows.map((r) => [r.attendance_date, r]));
  const s = { from, to, calendarDays: 0, payableDays: 0, presentDays: 0, halfDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, holidays: 0, weeklyOffs: 0, absentDays: 0, unmarkedDays: 0, notEmployedDays: 0, overtimeMinutes: 0, lateMarks: 0, earlyExits: 0, lateDeductionDays: 0, details: [] };
  const last = employee.separation_date ?? employee.last_working_date ?? null;
  for (const date of dayRange(from, to)) {
    s.calendarDays += 1;
    if (date < employee.joining_date || (last && date > last)) { s.notEmployedDays += 1; continue; }
    const day = ctx.classify(date);
    const rec = byDate.get(date);
    let value = 0;
    let kind;
    if (rec?.leave_request_id) {
      const half = rec.status === "half_day";
      const days = half ? 0.5 : 1;
      if (rec.leave_paid) { s.paidLeaveDays += days; value = days; } else s.unpaidLeaveDays += days;
      // the other half of a half-day leave is worked (present) or not
      if (half) { s.presentDays += 0.5; value += 0.5; }
      kind = rec.leave_paid ? "paid_leave" : "unpaid_leave";
    } else if (day.kind === "holiday") { s.holidays += 1; value = 1; kind = "holiday"; }
    else if (day.kind === "weekly_off" && !(rec && ["present", "half_day"].includes(rec.status))) { s.weeklyOffs += 1; value = 1; kind = "weekly_off"; }
    else if (rec) {
      if (["present", "remote"].includes(rec.status)) { s.presentDays += 1; value = 1; kind = "present"; }
      else if (rec.status === "half_day") { s.halfDays += 1; value = 0.5; kind = "half_day"; }
      else if (rec.status === "holiday") { s.holidays += 1; value = 1; kind = "holiday"; }
      else if (rec.status === "weekly_off") { s.weeklyOffs += 1; value = 1; kind = "weekly_off"; }
      else { s.absentDays += 1; kind = "absent"; }
    } else if (date < today()) { s.unmarkedDays += 1; s.absentDays += 1; kind = "unmarked"; }
    else { s.payableDays += 1; s.details.push({ date, kind: "future", value: 1 }); continue; }
    if (rec?.late_minutes > 0) s.lateMarks += 1;
    if (rec?.early_exit_minutes > 0) s.earlyExits += 1;
    s.payableDays += value;
    s.details.push({ date, kind, value });
  }
  const ot = await qx(client, `SELECT coalesce(sum(minutes),0)::int AS m FROM tenant.hr_overtime WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3 AND status='approved' AND (payroll_run_id IS NULL OR payroll_run_id=$4::uuid)`, [employee.id, from, to, runId]);
  s.overtimeMinutes = ot.rows[0].m;
  const per = Number(cfg.late_marks_per_deduction);
  s.lateDeductionDays = per > 0 ? Math.floor((s.lateMarks + s.earlyExits) / per) * 0.5 : 0;
  return s;
}
export async function getAttendanceSummary(client, c, input) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  if (!(own && own.id === employeeId)) needAny(c, VIEW);
  const from = dateRequired(input.from, "From");
  const to = dateRequired(input.to, "To");
  if (to < from || daysSpan(from, to) > 400) throw new HrError(400, "Choose a valid period of up to about a year.", "HR_PERIOD_INVALID");
  return computeAttendanceSummary(client, c, employeeId, from, to);
}
const daysSpan = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
void positive; void seq; void ymd;
