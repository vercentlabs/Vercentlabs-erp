// HR & Payroll — variable pay: one-time earnings (bonus, incentive, allowance, arrear) and deductions (recovery, other deduction, a monthly
// TDS amount under the old regime) for one employee and pay month. Entered by one person, approved by another; an approved item is paid by
// the regular payroll of its month (the run that used it is recorded, and released again if that run is recalculated or cancelled); a paid
// item is never changed.
import { HrError, qx, recordEvent, text, textOrNull, uuid, has, need, round2 } from "../common.js";

export const VP = Object.freeze({ manage: "hr_payroll.inputs.manage", approve: "hr_payroll.inputs.approve", prepare: "hr_payroll.payroll.prepare" });
export const EARNINGS = Object.freeze({ bonus: "Bonus", incentive: "Incentive", allowance: "Allowance", arrear: "Arrear", settlement_earning: "Final-settlement earning" });
export const DEDUCTIONS = Object.freeze({ deduction: "Deduction", recovery: "Recovery", settlement_deduction: "Final-settlement deduction" });
const monthOf = (value) => {
  const s = String(value ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(s)) throw new HrError(400, "The pay month looks like 2026-10.", "HR_INPUT_INVALID");
  return `${s}-01`;
};

export async function listPayrollInputs(client, c, filters = {}) {
  if (!has(c, VP.manage) && !has(c, VP.approve) && !has(c, VP.prepare)) throw new HrError(403, "You do not have permission to see variable pay.", "HR_FORBIDDEN");
  const values = [c.organizationId];
  let where = "i.organization_id = $1";
  if (filters.month) { values.push(monthOf(filters.month)); where += ` AND i.pay_month = $${values.length}`; }
  if (filters.status) { values.push(String(filters.status)); where += ` AND i.status = $${values.length}`; }
  return (await qx(client, `SELECT i.*, e.employee_number, e.first_name, e.last_name, rq.full_name AS requested_name, dc.full_name AS decided_name, r.payroll_number
      FROM tenant.hr_payroll_inputs i JOIN tenant.hr_employees e ON e.id = i.employee_id LEFT JOIN public.users rq ON rq.id = i.requested_by LEFT JOIN public.users dc ON dc.id = i.decided_by
      LEFT JOIN tenant.hr_payroll_runs r ON r.id = i.payroll_run_id WHERE ${where} ORDER BY i.pay_month DESC, e.employee_number`, values)).rows.map((i) => ({
    id: i.id, employee: { id: i.employee_id, number: i.employee_number, name: `${i.first_name} ${i.last_name ?? ""}`.trim() }, type: i.input_type, typeLabel: EARNINGS[i.input_type] ?? DEDUCTIONS[i.input_type],
    kind: EARNINGS[i.input_type] ? "earning" : "deduction", code: i.component_code, amount: Number(i.amount), taxable: i.taxable, description: i.description, month: String(i.pay_month).slice(0, 7),
    status: i.status, requestedBy: i.requested_name, decidedBy: i.decided_name, decisionNote: i.decision_note, run: i.payroll_number ?? null, reference: i.reference, rowVersion: i.row_version }));
}
// input: { employeeId, type, amount, month, description, taxable?, code?, reference? }
export async function createPayrollInput(client, c, input = {}) {
  need(c, VP.manage);
  const employeeId = uuid(input.employeeId, "Employee");
  const emp = (await client.query(`SELECT id, status FROM tenant.hr_employees WHERE organization_id = $1 AND id = $2`, [c.organizationId, employeeId])).rows[0];
  if (!emp) throw new HrError(404, "That employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  const type = String(input.type ?? "");
  if (!EARNINGS[type] && !DEDUCTIONS[type]) throw new HrError(400, "Choose the kind of variable pay.", "HR_INPUT_INVALID");
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new HrError(400, "Enter an amount above zero.", "HR_INPUT_INVALID");
  const description = text(input.description, 300);
  if (!description) throw new HrError(400, "Describe what it is for.", "HR_INPUT_INVALID");
  const code = text(input.code, 30).toUpperCase().replace(/[^A-Z0-9_]/g, "") || type.toUpperCase();
  const row = (await client.query(`INSERT INTO tenant.hr_payroll_inputs (organization_id, employee_id, input_type, category, amount, taxable, description, pay_month, status, requested_by, source_type,
      component_code, reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_approval',$9,'manual',$10,$11) RETURNING id`,
  [c.organizationId, employeeId, type, EARNINGS[type] ? "earning" : "deduction", amount, EARNINGS[type] ? input.taxable !== false : false, description, monthOf(input.month), c.userId ?? null, code,
    textOrNull(input.reference, 120)])).rows[0];
  await recordEvent(client, c, "payroll_input", row.id, "hr.payroll.input_created", { type, amount });
  return { id: row.id };
}
// input: { approve, note? } — someone other than who entered it.
export async function decidePayrollInput(client, c, id, input = {}) {
  need(c, VP.approve);
  const row = (await client.query(`SELECT * FROM tenant.hr_payroll_inputs WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(id, "Variable pay")])).rows[0];
  if (!row) throw new HrError(404, "That item was not found.", "HR_INPUT_NOT_FOUND");
  if (row.status !== "pending_approval") throw new HrError(409, "Only an item awaiting approval is decided.", "HR_INPUT_STATE");
  if (row.requested_by === c.userId && !c.roleSlugs?.includes("organization_owner")) throw new HrError(403, "Someone other than who entered it approves variable pay.", "SELF_APPROVAL_BLOCKED");
  const approve = input.approve === true || input.approve === "true";
  if (!approve && !text(input.note)) throw new HrError(400, "Give the reason for rejecting it.", "HR_REASON_REQUIRED");
  await client.query(`UPDATE tenant.hr_payroll_inputs SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, row_version = row_version + 1 WHERE id = $1`,
    [row.id, approve ? "approved" : "rejected", c.userId ?? null, textOrNull(input.note, 500)]);
  await recordEvent(client, c, "payroll_input", row.id, approve ? "hr.payroll.input_approved" : "hr.payroll.input_rejected", { note: textOrNull(input.note, 300) });
  return { id: row.id, status: approve ? "approved" : "rejected" };
}
// input: { reason }
export async function cancelPayrollInput(client, c, id, input = {}) {
  need(c, VP.manage);
  const row = (await client.query(`SELECT * FROM tenant.hr_payroll_inputs WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(id, "Variable pay")])).rows[0];
  if (!row) throw new HrError(404, "That item was not found.", "HR_INPUT_NOT_FOUND");
  if (!["pending_approval", "approved"].includes(row.status) || row.payroll_run_id) throw new HrError(409, "An item a payroll has used is not cancelled; correct it with another item.", "HR_INPUT_STATE");
  if (!text(input.reason)) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
  await client.query(`UPDATE tenant.hr_payroll_inputs SET status = 'cancelled', decision_note = $2, row_version = row_version + 1 WHERE id = $1`, [row.id, text(input.reason, 500)]);
  await recordEvent(client, c, "payroll_input", row.id, "hr.payroll.input_cancelled", { reason: text(input.reason, 300) });
  return { id: row.id };
}
// The approved items a run pays for an employee (its month; not used by another run), as payslip lines.
export async function inputsForRun(client, c, emp, run) {
  const month = `${String(run.period_start).slice(0, 7)}-01`;
  const rows = (await client.query(`SELECT * FROM tenant.hr_payroll_inputs WHERE organization_id = $1 AND employee_id = $2 AND pay_month = $3 AND status = 'approved'
      AND (payroll_run_id IS NULL OR payroll_run_id = $4) ORDER BY created_at`, [c.organizationId, emp.id, month, run.id])).rows;
  return rows.map((i) => ({ inputId: i.id, code: i.component_code || i.input_type.toUpperCase(), name: i.description, type: EARNINGS[i.input_type] ? "earning" : "deduction", kind: i.input_type,
    amount: round2(Number(i.amount)), taxable: EARNINGS[i.input_type] && i.taxable ? round2(Number(i.amount)) : 0, employer: 0 }));
}
