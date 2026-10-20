// HR — employee exit / relieving (MVP 40): the exit record (resignation, termination, retirement, end of contract, absconding, death),
// its acceptance with the last working day (the employee goes on notice and payroll prorates to that day), the offboarding clearance
// checklist, completion on or after the last working day (the employee is separated; attendance, leave and payslips stay), and the final
// settlement — never marked settled while the final payslip or a settlement earning / deduction is unpaid. Payroll eligibility is a
// separate, audited switch: employment status does not decide whether someone is paid through payroll.
import { HrError, addDays, dateOrNull, has, hasAny, need, oneOf, ownEmployee, qx, recordEvent, text, textOrNull, today, uuid } from "../common.js";

export const SEPARATION_TYPES = Object.freeze({
  resignation: "Resignation", termination: "Termination", retirement: "Retirement", end_of_contract: "End of contract", absconding: "Absconding", death: "Death",
});
const LIVE = ["active", "on_leave", "suspended", "on_notice"];
const MANAGE = "hr_payroll.employee.manage";
const SETTLE = "hr_payroll.exit.settle";
// [title, owner, mandatory]
const CHECKLIST = [
  ["Hand over work to the reporting manager", "Manager", true],
  ["Return company assets (laptop, ID and access cards)", "IT / Admin", true],
  ["Remove ERP, email and other system access", "IT", true],
  ["Clear advances, loans and other dues with Finance", "Finance", true],
  ["Exit interview", "HR", false],
];
const NAMES = `e.first_name || COALESCE(' ' || e.last_name, '')`;

async function employeeOf(client, c, id, { lock = false } = {}) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Employee")]);
  if (!rows[0]) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  return rows[0];
}
async function separationOf(client, c, id, { lock = false } = {}) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_separations WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Exit")]);
  if (!rows[0]) throw new HrError(404, "That exit was not found.", "HR_EXIT_NOT_FOUND");
  return rows[0];
}
const state = (s, allowed, what) => {
  if (!allowed.includes(s.status)) throw new HrError(409, `This exit is ${s.status}; it cannot be ${what}.`, "HR_EXIT_STATE");
};
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

// input: employeeId, type, noticeDate, requestedLastDay, reason. An employee may resign themselves; every other kind is HR's.
export async function startSeparation(client, c, input = {}) {
  const e = await employeeOf(client, c, input.employeeId, { lock: true });
  const own = await ownEmployee(client, c);
  const type = oneOf(String(input.type ?? "resignation"), Object.keys(SEPARATION_TYPES), "Exit type");
  const isSelf = Boolean(own && own.id === e.id);
  if (!has(c, MANAGE) && !(isSelf && type === "resignation")) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
  if (!LIVE.includes(e.status)) throw new HrError(409, `${e.employee_number} is ${e.status}; only a current employee can leave.`, "HR_EMPLOYEE_STATE");
  const reason = text(input.reason, 1000);
  if (!reason) throw new HrError(400, "Give the reason for the exit.", "HR_REASON_REQUIRED");
  const noticeDate = dateOrNull(input.noticeDate, "Notice date") ?? today();
  const requested = dateOrNull(input.requestedLastDay, "Requested last day") ?? addDays(noticeDate, Number(e.notice_period_days ?? 0));
  if (requested < ymd(e.joining_date)) throw new HrError(400, "The last day cannot be before the employee joined.", "HR_EXIT_INVALID");
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.hr_separations(organization_id,employee_id,separation_type,notice_date,requested_last_day,reason,status,initiated_by)
      VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7) RETURNING *`, [c.organizationId, e.id, type, noticeDate, requested, reason, c.userId]);
    await recordEvent(client, c, "employee", e.id, "hr.exit.started", { separationId: rows[0].id, type, requestedLastDay: requested });
    return rows[0];
  } catch (error) {
    if (error.code === "23505") throw new HrError(409, `${e.employee_number} already has an open exit.`, "HR_EXIT_OPEN");
    throw error;
  }
}

// Accepting fixes the last working day: the employee goes on notice, payroll prorates to that day, and the clearance checklist is raised.
export async function acceptSeparation(client, c, id, input = {}) {
  need(c, MANAGE);
  const s = await separationOf(client, c, id, { lock: true });
  state(s, ["submitted"], "accepted");
  const e = await employeeOf(client, c, s.employee_id, { lock: true });
  const last = dateOrNull(input.lastWorkingDay, "Last working day") ?? ymd(s.requested_last_day);
  if (last < ymd(e.joining_date)) throw new HrError(400, "The last working day cannot be before the employee joined.", "HR_EXIT_INVALID");
  const { rows } = await qx(client, `UPDATE tenant.hr_separations SET status='accepted', last_working_day=$3, decided_by=$4, decided_at=now(), decision_note=$5 WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, s.id, last, c.userId, textOrNull(input.note, 1000)]);
  await qx(client, `UPDATE tenant.hr_employees SET status='on_notice', last_working_date=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, e.id, last]);
  const open = (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_lifecycle_tasks WHERE employee_id=$1 AND kind='offboarding' AND status='open'`, [e.id])).rows[0].n;
  if (!open) {
    for (const [title, ownerLabel, mandatory] of CHECKLIST) {
      await qx(client, `INSERT INTO tenant.hr_lifecycle_tasks(organization_id,employee_id,kind,title,owner_label,mandatory,due_date) VALUES ($1,$2,'offboarding',$3,$4,$5,$6)`,
        [c.organizationId, e.id, title, ownerLabel, mandatory, last]);
    }
  }
  await recordEvent(client, c, "employee", e.id, "hr.exit.accepted", { separationId: s.id, lastWorkingDay: last });
  return rows[0];
}
export async function rejectSeparation(client, c, id, input = {}) {
  need(c, MANAGE);
  const s = await separationOf(client, c, id, { lock: true });
  state(s, ["submitted"], "rejected");
  const note = text(input.note, 1000);
  if (!note) throw new HrError(400, "Give the reason for rejecting the exit.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_separations SET status='rejected', decided_by=$3, decided_at=now(), decision_note=$4 WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, s.id, c.userId, note]);
  await recordEvent(client, c, "employee", s.employee_id, "hr.exit.rejected", { separationId: s.id, note });
  return rows[0];
}
// Before completion: the employee is current again, and the open clearance tasks are waived.
export async function withdrawSeparation(client, c, id, input = {}) {
  const s = await separationOf(client, c, id, { lock: true });
  const own = await ownEmployee(client, c);
  if (!has(c, MANAGE) && !(own && own.id === s.employee_id && s.separation_type === "resignation")) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
  state(s, ["submitted", "accepted"], "withdrawn");
  const reason = text(input.reason, 1000);
  if (!reason) throw new HrError(400, "Give the reason for withdrawing the exit.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_separations SET status='withdrawn', withdrawn_reason=$3 WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, s.id, reason]);
  await qx(client, `UPDATE tenant.hr_employees SET status=CASE WHEN status='on_notice' THEN 'active' ELSE status END, last_working_date=NULL, updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, s.employee_id]);
  await qx(client, `UPDATE tenant.hr_lifecycle_tasks SET status='waived', completed_by=$3, completed_at=now(), note='Exit withdrawn' WHERE organization_id=$1 AND employee_id=$2 AND kind='offboarding' AND status='open'`,
    [c.organizationId, s.employee_id, c.userId]);
  await recordEvent(client, c, "employee", s.employee_id, "hr.exit.withdrawn", { separationId: s.id, reason });
  return rows[0];
}

// On or after the last working day, with every mandatory clearance task done or waived. The employee is separated; their records stay.
export async function completeSeparation(client, c, id, input = {}) {
  need(c, MANAGE);
  const s = await separationOf(client, c, id, { lock: true });
  state(s, ["accepted"], "completed");
  const last = ymd(s.last_working_day);
  if (last > today()) throw new HrError(409, `The last working day is ${last}; complete the exit on or after it.`, "HR_EXIT_EARLY");
  const open = (await qx(client, `SELECT title FROM tenant.hr_lifecycle_tasks WHERE employee_id=$1 AND kind='offboarding' AND status='open' AND mandatory ORDER BY created_at`, [s.employee_id])).rows;
  if (open.length) throw new HrError(409, `Clearance is not finished: ${open.map((t) => t.title).join("; ")}.`, "HR_EXIT_CLEARANCE_OPEN");
  const interview = input.exitInterview && typeof input.exitInterview === "object" ? input.exitInterview : input.exitInterview ? { notes: text(input.exitInterview, 4000) } : null;
  const { rows } = await qx(client, `UPDATE tenant.hr_separations SET status='completed', completed_by=$3, completed_at=now(), exit_interview=COALESCE($4::jsonb, exit_interview) WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, s.id, c.userId, interview ? JSON.stringify(interview) : null]);
  await qx(client, `UPDATE tenant.hr_employees SET status='separated', separation_date=$3, last_working_date=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, s.employee_id, last]);
  await recordEvent(client, c, "employee", s.employee_id, "hr.exit.completed", { separationId: s.id, lastWorkingDay: last });
  return rows[0];
}

// What still stands between the exit and its settlement: the final payslip (the payroll covering the last working day) and any
// settlement earning or deduction not yet paid.
export async function settlementOf(client, c, s) {
  const last = ymd(s.last_working_day);
  const finalSlip = last ? (await qx(client, `SELECT p.id, p.payslip_number, p.net_pay, p.paid_amount, p.payment_status, p.status, r.payroll_number, r.status AS run_status
      FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id = p.payroll_run_id
      WHERE p.organization_id=$1 AND p.employee_id=$2 AND r.status <> 'cancelled' AND p.status <> 'cancelled' AND r.period_start <= $3 AND r.period_end >= $3
      ORDER BY r.created_at DESC LIMIT 1`, [c.organizationId, s.employee_id, last])).rows[0] ?? null : null;
  const items = (await qx(client, `SELECT id, input_type, amount, description, status, to_char(pay_month, 'YYYY-MM') AS month FROM tenant.hr_payroll_inputs
      WHERE organization_id=$1 AND employee_id=$2 AND input_type IN ('settlement_earning','settlement_deduction') ORDER BY created_at`, [c.organizationId, s.employee_id])).rows;
  const unpaid = items.filter((i) => ["pending_approval", "approved"].includes(i.status));
  const blockers = [];
  if (s.status !== "completed") blockers.push("The exit is not completed yet.");
  if (!finalSlip) blockers.push(last ? `No final payslip yet: run the payroll covering ${last}.` : "No last working day is set.");
  else if (!(finalSlip.payment_status === "PAID" || Number(finalSlip.net_pay) === 0)) blockers.push(`Final payslip ${finalSlip.payslip_number} is ${String(finalSlip.payment_status).toLowerCase().replace(/_/g, " ")}.`);
  if (unpaid.length) blockers.push(`${unpaid.length} settlement item(s) are not paid yet.`);
  return { finalPayslip: finalSlip, items, blockers };
}
// input: note; notRequired (nothing is owed either way: no final payslip is expected and no settlement item is open).
export async function settleSeparation(client, c, id, input = {}) {
  need(c, SETTLE);
  const s = await separationOf(client, c, id, { lock: true });
  state(s, ["completed"], "settled");
  if (s.settlement_status !== "pending") throw new HrError(409, `The settlement is already ${s.settlement_status.replace("_", " ")}.`, "HR_EXIT_STATE");
  const note = textOrNull(input.note, 1000);
  const { finalPayslip, items, blockers } = await settlementOf(client, c, s);
  let status = "settled";
  if (input.notRequired === true || input.notRequired === "true") {
    if (!note) throw new HrError(400, "Say why no final settlement is needed.", "HR_REASON_REQUIRED");
    if ((finalPayslip && finalPayslip.payment_status !== "PAID" && Number(finalPayslip.net_pay) !== 0) || items.some((i) => ["pending_approval", "approved"].includes(i.status))) {
      throw new HrError(409, "Something is still owed: pay the final payslip and settlement items, or cancel them, first.", "HR_SETTLEMENT_BLOCKED");
    }
    status = "not_required";
  } else if (blockers.length) throw new HrError(409, blockers.join(" "), "HR_SETTLEMENT_BLOCKED");
  const { rows } = await qx(client, `UPDATE tenant.hr_separations SET settlement_status=$3, settled_by=$4, settled_at=now(), settlement_note=$5, final_payslip_id=$6 WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, s.id, status, c.userId, note, finalPayslip?.id ?? null]);
  await recordEvent(client, c, "employee", s.employee_id, "hr.exit.settled", { separationId: s.id, status, payslip: finalPayslip?.payslip_number ?? null });
  return rows[0];
}

// Payroll eligibility, apart from employment status: an ineligible employee is left out of payroll runs.
export async function setPayrollEligibility(client, c, employeeId, input = {}) {
  need(c, MANAGE);
  const e = await employeeOf(client, c, employeeId, { lock: true });
  const eligible = input.eligible === true || input.eligible === "true";
  const reason = text(input.reason, 500);
  if (!reason) throw new HrError(400, "Give the reason for the change.", "HR_REASON_REQUIRED");
  if (Boolean(e.payroll_eligible) === eligible) return e;
  const { rows } = await qx(client, `UPDATE tenant.hr_employees SET payroll_eligible=$3, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, e.id, eligible]);
  await recordEvent(client, c, "employee", e.id, "hr.payroll_eligibility.changed", { eligible, reason });
  return rows[0];
}

const shape = (r) => ({
  id: r.id, employee: { id: r.employee_id, number: r.employee_number, name: r.employee_name, status: r.employee_status }, type: r.separation_type, typeLabel: SEPARATION_TYPES[r.separation_type],
  status: r.status, noticeDate: ymd(r.notice_date), requestedLastDay: ymd(r.requested_last_day), lastWorkingDay: ymd(r.last_working_day), reason: r.reason,
  decisionNote: r.decision_note, decidedBy: r.decided_by_name ?? null, decidedAt: r.decided_at, completedAt: r.completed_at, withdrawnReason: r.withdrawn_reason,
  settlementStatus: r.settlement_status, settledAt: r.settled_at, settlementNote: r.settlement_note, exitInterview: r.exit_interview, createdAt: r.created_at,
});
const SELECT = `SELECT s.*, e.employee_number, ${NAMES} AS employee_name, e.status AS employee_status, u.full_name AS decided_by_name
  FROM tenant.hr_separations s JOIN tenant.hr_employees e ON e.id = s.employee_id LEFT JOIN public.users u ON u.id = s.decided_by`;
export async function listSeparations(client, c, filters = {}) {
  const params = [c.organizationId];
  let extra = "";
  if (!hasAny(c, [MANAGE, "hr_payroll.employee.view", SETTLE])) {
    const own = await ownEmployee(client, c);
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND s.employee_id=$${params.length}`;
  }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND s.status=$${params.length}`; }
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND s.employee_id=$${params.length}`; }
  if (filters.settlement) { params.push(String(filters.settlement)); extra += ` AND s.settlement_status=$${params.length} AND s.status='completed'`; }
  return (await qx(client, `${SELECT} WHERE s.organization_id=$1${extra} ORDER BY s.created_at DESC LIMIT 500`, params)).rows.map(shape);
}
export async function getSeparation(client, c, id) {
  const row = (await qx(client, `${SELECT} WHERE s.organization_id=$1 AND s.id=$2`, [c.organizationId, uuid(id, "Exit")])).rows[0];
  if (!row) throw new HrError(404, "That exit was not found.", "HR_EXIT_NOT_FOUND");
  if (!hasAny(c, [MANAGE, "hr_payroll.employee.view", SETTLE])) {
    const own = await ownEmployee(client, c);
    if (!own || own.id !== row.employee_id) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
  }
  const tasks = (await qx(client, `SELECT id, title, owner_label, mandatory, due_date, status, note FROM tenant.hr_lifecycle_tasks WHERE employee_id=$1 AND kind='offboarding' ORDER BY created_at`, [row.employee_id])).rows;
  return { ...shape(row), tasks, settlement: await settlementOf(client, c, row) };
}
// The employee record's exit panel: the latest exit (open or not), with its checklist and settlement.
export async function getEmployeeExit(client, c, employeeId) {
  const e = await employeeOf(client, c, employeeId);
  const latest = (await qx(client, `SELECT id FROM tenant.hr_separations WHERE organization_id=$1 AND employee_id=$2 ORDER BY created_at DESC LIMIT 1`, [c.organizationId, e.id])).rows[0];
  return { payrollEligible: e.payroll_eligible, noticePeriodDays: e.notice_period_days, types: Object.entries(SEPARATION_TYPES).map(([value, label]) => ({ value, label })),
    exit: latest ? await getSeparation(client, c, latest.id) : null };
}
