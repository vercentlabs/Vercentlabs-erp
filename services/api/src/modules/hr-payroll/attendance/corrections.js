// HR — attendance corrections (MVP 40). An employee (or HR) asks for a day's missing or wrong check-in / check-out to be corrected; the day
// shows PENDING_CORRECTION until the employee's manager or HR — never the person who asked — decides. Approval adds punches marked
// "regularized" next to the original ones (which are never changed), and the day is derived again. A day in an approved payroll is locked.
import { HrError, dateRequired, has, need, ownEmployee, qx, recordEvent, text, textOrNull, today, uuid } from "../common.js";
import { assertDateOpen, isManagerOf, recomputeDay } from "../time.js";

const MANAGE = "hr_payroll.attendance.manage";
const LIVE = ["active", "on_leave", "on_notice"];
const NAMES = `e.first_name || COALESCE(' ' || e.last_name, '')`;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function employeeOf(client, c, id) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(id, "Employee")]);
  if (!rows[0]) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  return rows[0];
}
async function zone(client, c) {
  return (await qx(client, `SELECT coalesce(timezone,'UTC') AS tz FROM public.organizations WHERE id=$1`, [c.organizationId])).rows[0]?.tz || "UTC";
}
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// input: employeeId (HR, or omitted for oneself), date, checkIn / checkOut ("HH:MM", local time; a check-out before the check-in is the
// next morning), reason.
export async function requestAttendanceCorrection(client, c, input = {}) {
  const own = await ownEmployee(client, c);
  const employee = await employeeOf(client, c, input.employeeId ?? own?.id);
  const isSelf = Boolean(own && own.id === employee.id);
  if (!isSelf && !has(c, MANAGE)) throw new HrError(403, "You can only ask for your own attendance to be corrected.", "HR_FORBIDDEN");
  if (!LIVE.includes(employee.status)) throw new HrError(409, "Only a current employee's attendance can be corrected.", "HR_EMPLOYEE_STATE");
  const date = dateRequired(input.date, "Date");
  if (date > today()) throw new HrError(400, "A future day cannot be corrected.", "HR_CORRECTION_INVALID");
  if (date < ymd(employee.joining_date)) throw new HrError(400, "That is before the employee joined.", "HR_CORRECTION_INVALID");
  const checkIn = input.checkIn ? String(input.checkIn).slice(0, 5) : null;
  const checkOut = input.checkOut ? String(input.checkOut).slice(0, 5) : null;
  if ((!checkIn && !checkOut) || (checkIn && !TIME.test(checkIn)) || (checkOut && !TIME.test(checkOut))) throw new HrError(400, "Give the check-in and / or check-out time (HH:MM).", "HR_CORRECTION_INVALID");
  const reason = text(input.reason, 500);
  if (!reason) throw new HrError(400, "Say why the day needs correcting.", "HR_REASON_REQUIRED");
  await assertDateOpen(client, c, date);
  const day = (await qx(client, `SELECT leave_request_id FROM tenant.hr_attendance WHERE employee_id=$1 AND attendance_date=$2`, [employee.id, date])).rows[0];
  if (day?.leave_request_id) throw new HrError(409, "That day is approved leave. Cancel the leave instead.", "HR_CORRECTION_INVALID");
  if (isSelf && !has(c, MANAGE)) {
    const limit = Number((await qx(client, `SELECT regularization_limit_per_month AS n FROM tenant.hr_payroll_settings WHERE organization_id=$1`, [c.organizationId])).rows[0]?.n ?? 0);
    const used = (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_attendance_regularizations WHERE employee_id=$1 AND status IN ('pending','approved') AND date_trunc('month', attendance_date) = date_trunc('month', $2::date)`, [employee.id, date])).rows[0].n;
    if (limit > 0 && used >= limit) throw new HrError(409, `Only ${limit} correction(s) can be asked for in a month. Ask HR.`, "HR_CORRECTION_LIMIT");
  }
  const tz = await zone(client, c);
  const at = (await qx(client, `SELECT CASE WHEN $2::text IS NULL THEN NULL ELSE ($1::date + $2::time) AT TIME ZONE $4 END AS cin,
      CASE WHEN $3::text IS NULL THEN NULL ELSE ($1::date + $3::time + CASE WHEN $2::text IS NOT NULL AND $3::time <= $2::time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE $4 END AS cout`,
    [date, checkIn, checkOut, tz])).rows[0];
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.hr_attendance_regularizations(organization_id,employee_id,attendance_date,requested_check_in,requested_check_out,reason,status,requested_by)
      VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING *`, [c.organizationId, employee.id, date, at.cin, at.cout, reason, c.userId]);
    await recomputeDay(client, c, employee, date);
    await recordEvent(client, c, "employee", employee.id, "hr.attendance.correction_requested", { date, checkIn, checkOut });
    return rows[0];
  } catch (error) {
    if (error.code === "23505") throw new HrError(409, "A correction for that day is already waiting for a decision.", "HR_CORRECTION_DUPLICATE");
    throw error;
  }
}

async function requestOf(client, c, id) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_attendance_regularizations WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(id, "Correction")]);
  if (!rows[0]) throw new HrError(404, "That correction was not found.", "HR_CORRECTION_NOT_FOUND");
  if (rows[0].status !== "pending") throw new HrError(409, `That correction is already ${rows[0].status}.`, "HR_CORRECTION_STATE");
  return rows[0];
}
// The employee's manager or HR decides, never the person who asked. Approval adds 'regularized' punches; the originals stay.
export async function decideAttendanceCorrection(client, c, id, { approve, note } = {}) {
  const r = await requestOf(client, c, id);
  const employee = await employeeOf(client, c, r.employee_id);
  if (!has(c, MANAGE) && !(await isManagerOf(client, c, employee))) throw new HrError(403, "Only the employee's manager or HR can decide a correction.", "HR_FORBIDDEN");
  if (r.requested_by === c.userId) throw new HrError(403, "Someone other than the person who asked must decide the correction.", "HR_SELF_APPROVAL");
  const date = ymd(r.attendance_date);
  const added = [];
  if (approve) {
    await assertDateOpen(client, c, date);
    for (const [at, direction] of [[r.requested_check_in, "in"], [r.requested_check_out, "out"]]) {
      if (!at) continue;
      const p = await qx(client, `INSERT INTO tenant.hr_attendance_punches(organization_id,employee_id,punched_at,direction,source,note,created_by) VALUES ($1,$2,$3,$4,'regularized',$5,$6) RETURNING id`,
        [c.organizationId, employee.id, at, direction, `Correction approved: ${text(r.reason, 200)}`, c.userId]);
      added.push(p.rows[0].id);
    }
  } else if (!text(note)) throw new HrError(400, "Give the reason for rejecting the correction.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_attendance_regularizations SET status=$3, decided_by=$4, decided_at=now(), decision_note=$5, added_punch_ids=$6::uuid[] WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, r.id, approve ? "approved" : "rejected", c.userId, textOrNull(note, 500), added]);
  const day = await recomputeDay(client, c, employee, date);
  await recordEvent(client, c, "employee", employee.id, approve ? "hr.attendance.correction_approved" : "hr.attendance.correction_rejected", { date, note: textOrNull(note, 500) });
  return { ...rows[0], attendance: day };
}
export async function cancelAttendanceCorrection(client, c, id) {
  const r = await requestOf(client, c, id);
  if (r.requested_by !== c.userId && !has(c, MANAGE)) throw new HrError(403, "Only the person who asked, or HR, can cancel a correction.", "HR_FORBIDDEN");
  const { rows } = await qx(client, `UPDATE tenant.hr_attendance_regularizations SET status='cancelled' WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, r.id]);
  await recomputeDay(client, c, await employeeOf(client, c, r.employee_id), ymd(r.attendance_date));
  return rows[0];
}

// HR sees every correction; a manager, their direct reports'; everyone, their own. canDecide marks what the viewer may decide.
export async function listAttendanceCorrections(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId];
  let extra = "";
  if (!has(c, MANAGE) && !has(c, "hr_payroll.employee.view")) {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND (r.employee_id=$${params.length} OR e.manager_employee_id=$${params.length})`;
  }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND r.status=$${params.length}`; }
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND r.employee_id=$${params.length}`; }
  const hr = has(c, MANAGE);
  const tz = await zone(client, c);
  params.push(tz);
  const { rows } = await qx(client, `SELECT r.*, e.employee_number, ${NAMES} AS employee_name, e.manager_employee_id, u.full_name AS requested_by_name, d.full_name AS decided_by_name,
      to_char(r.requested_check_in AT TIME ZONE $${params.length}, 'HH24:MI') AS check_in, to_char(r.requested_check_out AT TIME ZONE $${params.length}, 'HH24:MI') AS check_out,
      a.status AS day_status, a.check_in_at, a.check_out_at
    FROM tenant.hr_attendance_regularizations r JOIN tenant.hr_employees e ON e.id = r.employee_id
    LEFT JOIN public.users u ON u.id = r.requested_by LEFT JOIN public.users d ON d.id = r.decided_by
    LEFT JOIN tenant.hr_attendance a ON a.employee_id = r.employee_id AND a.attendance_date = r.attendance_date
    WHERE r.organization_id=$1${extra} ORDER BY (r.status = 'pending') DESC, r.attendance_date DESC, r.created_at DESC LIMIT 500`, params);
  return rows.map((r) => ({ ...r, attendance_date: ymd(r.attendance_date),
    canDecide: r.status === "pending" && r.requested_by !== c.userId && (hr || Boolean(own && r.manager_employee_id === own.id)),
    canCancel: r.status === "pending" && (r.requested_by === c.userId || hr) }));
}
void need;
