// F423-F427 and the run lifecycle of F434: payroll periods, the calculation engine (attendance
// based, prorated for joining and leaving, overtime), payslips with a frozen source snapshot and a
// deterministic hash, exceptions, and maker-checker approval.
//
// Later slices plug into the engine through registerPayrollHook: extra earnings and deductions from
// approved inputs (bonus, incentives, reimbursements, arrears, loans) and the statutory engine.
import { createHash } from "node:crypto";

import {
  HrError, addDays, dateOrNull, dateRequired, daysBetween, has, needAny, need, ownEmployee, qx, recordEvent, round2, text, textOrNull, today, uuid, uuidOrNull, oneOf, seq,
} from "./common.js";
import { compensationDuring, ensureSystemComponent } from "./compensation.js";
import { computeAttendanceSummary } from "./time.js";

const PREPARE = "hr_payroll.payroll.prepare";
const APPROVE = "hr_payroll.payroll.approve";
const VIEW = [PREPARE, APPROVE, "hr_payroll.payroll.post", "hr_payroll.payslip.view", "hr_payroll.reports.view"];

// ---------------------------------------------------------------- extension points
export const PAYROLL_HOOKS = { earnings: null, statutory: null, deductions: null, afterPayslip: null, afterApprove: null, afterCancel: null };
export function registerPayrollHook(name, fn) {
  if (!(name in PAYROLL_HOOKS)) throw new Error(`Unknown payroll hook ${name}`);
  PAYROLL_HOOKS[name] = fn;
}

const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const monthEnd = (ymd) => {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
};
async function settings(client, c) {
  await qx(client, `INSERT INTO tenant.hr_payroll_settings(organization_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.organizationId, c.companyId]);
  return (await qx(client, `SELECT * FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId])).rows[0];
}

// ---------------------------------------------------------------- periods (F423)
export async function listPayrollPeriods(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.year) { params.push(Math.trunc(Number(filters.year))); extra = ` AND extract(year FROM p.period_start)=$3`; }
  const { rows } = await qx(client, `SELECT p.*, r.id AS run_id, r.payroll_number, r.status AS run_status, r.net_pay FROM tenant.hr_payroll_periods p LEFT JOIN tenant.hr_payroll_runs r ON r.period_id=p.id AND r.run_type='regular' AND r.status <> 'cancelled' WHERE p.organization_id=$1 AND p.company_id=$2${extra} ORDER BY p.period_start DESC LIMIT 400`, params);
  return rows;
}
export async function generatePayrollPeriods(client, c, input) {
  need(c, PREPARE);
  const cfg = await settings(client, c);
  const year = Math.trunc(Number(input.year ?? today().slice(0, 4)));
  if (!(year >= 2000 && year <= 2100)) throw new HrError(400, "That year is not valid.", "HR_PERIOD_INVALID");
  const payDay = input.paymentDay === undefined || input.paymentDay === "" || input.paymentDay === null || Number(input.paymentDay) === 0 ? null : Math.trunc(Number(input.paymentDay));
  if (payDay !== null && !(payDay >= 1 && payDay <= 28)) throw new HrError(400, "The payment day is 1 to 28 of the following month.", "HR_PERIOD_INVALID");
  const made = [];
  const skipped = [];
  const add = async (code, start, end) => {
    const pay = payDay === null ? end : `${addDays(end, 1).slice(0, 7)}-${String(payDay).padStart(2, "0")}`;
    const exists = await qx(client, `SELECT 1 FROM tenant.hr_payroll_periods WHERE organization_id=$1 AND company_id=$2 AND (period_code=$3 OR (period_start <= $5 AND period_end >= $4))`, [c.organizationId, c.companyId, code, start, end]);
    if (exists.rows[0]) { skipped.push(code); return; }
    await qx(client, `INSERT INTO tenant.hr_payroll_periods(organization_id,company_id,period_code,period_start,period_end,payment_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [c.organizationId, c.companyId, code, start, end, pay < end ? end : pay, c.userId]);
    made.push(code);
  };
  if (cfg.payroll_frequency === "monthly") {
    for (let m = 1; m <= 12; m += 1) {
      const start = `${year}-${String(m).padStart(2, "0")}-01`;
      await add(`${year}-${String(m).padStart(2, "0")}`, start, monthEnd(start));
    }
  } else {
    const step = cfg.payroll_frequency === "weekly" ? 7 : 14;
    const first = dateRequired(input.startDate, "First period start");
    let n = 0;
    for (let s = first; s.slice(0, 4) <= String(year); s = addDays(s, step)) { n += 1; await add(`${first.slice(0, 4)}-${cfg.payroll_frequency === "weekly" ? "W" : "B"}${String(n).padStart(2, "0")}`, s, addDays(s, step - 1)); }
  }
  return { created: made.length, skipped: skipped.length, codes: made };
}
export async function lockPayrollPeriod(client, c, id, { force = false, reason } = {}) {
  need(c, PREPARE);
  const p = (await qx(client, `SELECT * FROM tenant.hr_payroll_periods WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Period")])).rows[0];
  if (!p) throw new HrError(404, "Payroll period was not found.", "HR_PERIOD_NOT_FOUND");
  if (p.status !== "open") throw new HrError(409, "Only an open period can be locked.", "HR_PERIOD_STATE");
  const pending = {
    corrections: (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_attendance_regularizations WHERE organization_id=$1 AND company_id=$2 AND status='pending' AND attendance_date BETWEEN $3 AND $4`, [c.organizationId, c.companyId, p.period_start, p.period_end])).rows[0].n,
    overtime: (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_overtime WHERE organization_id=$1 AND company_id=$2 AND status='pending' AND work_date BETWEEN $3 AND $4`, [c.organizationId, c.companyId, p.period_start, p.period_end])).rows[0].n,
    leave: (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_leave_requests WHERE organization_id=$1 AND company_id=$2 AND status='submitted' AND start_date <= $4 AND end_date >= $3`, [c.organizationId, c.companyId, p.period_start, p.period_end])).rows[0].n,
  };
  const open = pending.corrections + pending.overtime + pending.leave;
  if (open > 0 && !(force && text(reason))) throw new HrError(409, `Resolve first: ${pending.corrections} attendance correction(s), ${pending.overtime} overtime item(s), ${pending.leave} leave request(s) awaiting a decision in this period. Or lock it anyway with a reason.`, "HR_PERIOD_PENDING_ITEMS");
  const { rows } = await qx(client, `UPDATE tenant.hr_payroll_periods SET status='locked', locked_by=$2, locked_at=now() WHERE id=$1 RETURNING *`, [p.id, c.userId]);
  await recordEvent(client, c, "payroll_period", p.id, "hr.period.locked", { pending, forced: open > 0, reason: textOrNull(reason) });
  return rows[0];
}
export async function unlockPayrollPeriod(client, c, id, reason) {
  need(c, APPROVE);
  const p = (await qx(client, `SELECT * FROM tenant.hr_payroll_periods WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Period")])).rows[0];
  if (!p) throw new HrError(404, "Payroll period was not found.", "HR_PERIOD_NOT_FOUND");
  if (p.status !== "locked") throw new HrError(409, "Only a locked period can be unlocked.", "HR_PERIOD_STATE");
  if (!text(reason)) throw new HrError(400, "Give a reason for unlocking the period.", "HR_REASON_REQUIRED");
  const run = await qx(client, `SELECT payroll_number FROM tenant.hr_payroll_runs WHERE period_id=$1 AND status IN ('approved','posted','paid') LIMIT 1`, [p.id]);
  if (run.rows[0]) throw new HrError(409, `Payroll ${run.rows[0].payroll_number} is already approved for this period.`, "HR_PERIOD_HAS_RUN");
  const { rows } = await qx(client, `UPDATE tenant.hr_payroll_periods SET status='open', locked_by=NULL, locked_at=NULL WHERE id=$1 RETURNING *`, [p.id]);
  await recordEvent(client, c, "payroll_period", p.id, "hr.period.unlocked", { reason: text(reason, 300) });
  return rows[0];
}
export async function closePayrollPeriod(client, c, id) {
  need(c, "hr_payroll.payroll.post");
  const p = (await qx(client, `SELECT * FROM tenant.hr_payroll_periods WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Period")])).rows[0];
  if (!p) throw new HrError(404, "Payroll period was not found.", "HR_PERIOD_NOT_FOUND");
  if (p.status === "closed") throw new HrError(409, "The period is already closed.", "HR_PERIOD_STATE");
  const run = await qx(client, `SELECT status FROM tenant.hr_payroll_runs WHERE period_id=$1 AND run_type='regular' AND status <> 'cancelled'`, [p.id]);
  if (!run.rows[0] || !["posted", "paid"].includes(run.rows[0].status)) throw new HrError(409, "A period closes once its payroll has been posted to accounting.", "HR_PERIOD_RUN_OPEN");
  return (await qx(client, `UPDATE tenant.hr_payroll_periods SET status='closed', closed_at=now() WHERE id=$1 RETURNING *`, [p.id])).rows[0];
}

// ---------------------------------------------------------------- the engine (F424-F427)
const line = (o) => ({ code: o.code, name: o.name, type: o.type, kind: o.kind ?? null, amount: round2(o.amount), taxable: round2(o.taxable ?? (o.type === "earning" ? o.amount : 0)), employer: round2(o.employer ?? 0), componentId: o.componentId ?? null, statutoryId: o.statutoryId ?? null });

// A final settlement pays only what its own inputs say (already computed and frozen by the
// settlement calculation): no structure-based proration, since the employee's regular pay for days
// worked was already settled by the regular payroll runs that came before it.
async function computeSettlement(client, c, run, emp, cfg) {
  const exceptions = [];
  const hookCtx = { client, c, run, employee: emp, cfg, lines: [], exceptions, attendance: { payable: 0, D: 1, segments: [] }, monthlyGross: 0 };
  const extra = PAYROLL_HOOKS.earnings ? await PAYROLL_HOOKS.earnings(hookCtx) : { lines: [], data: {} };
  const lines = (extra.lines ?? []).map((l) => line(l));
  if (!lines.length) return { skip: true, exceptions: [{ code: "NO_SETTLEMENT_LINES", severity: "error", message: `${emp.employee_number} has no settlement lines to pay.` }] };
  const gross = round2(lines.filter((l) => l.type === "earning").reduce((n, l) => n + l.amount, 0));
  const taxableGross = round2(lines.filter((l) => l.type === "earning").reduce((n, l) => n + l.taxable, 0));
  const ded = PAYROLL_HOOKS.deductions ? await PAYROLL_HOOKS.deductions({ ...hookCtx, lines, gross, taxableGross, alreadyDeducted: 0 }) : { lines: [], data: {} };
  for (const l of ded.lines ?? []) lines.push(line(l));
  const deductions = round2(lines.filter((l) => l.type === "deduction").reduce((n, l) => n + l.amount, 0));
  const employer = round2(lines.reduce((n, l) => n + l.employer, 0));
  const net = round2(gross - deductions);
  if (net < 0) exceptions.push({ code: "NEGATIVE_NET", severity: "error", message: `Deductions (${deductions}) exceed earnings (${gross}). The net pay would be ${net}.` });
  if (!emp.bank_details?.account_number) exceptions.push({ code: "MISSING_BANK", severity: "warning", message: "No bank account is on file. The net pay cannot be transferred until one is added." });
  const snapshot = { basis: "settlement", period: { from: String(run.period_start), to: String(run.period_end), days: 1 }, compensation: [], attendance: { payableDays: 0, lopDays: 0, lateDeductionDays: 0, overtimeMinutes: 0, unmarkedDays: 0 }, inputs: extra.data ?? {}, statutory: {}, deductions: ded.data ?? {}, wages: { pf: 0, esic: 0, taxableGross } };
  const ordered = lines.map((l, i) => ({ ...l, sequence: i + 1 }));
  const hash = sha({ lines: ordered.map((l) => [l.code, l.type, l.amount, l.taxable, l.employer]), totals: [gross, deductions, employer, net], snapshot });
  return {
    skip: false, exceptions, lines: ordered, gross, deductions, employer, net, snapshot, hash,
    days: { working: 1, paid: 0, leave: 0, lop: 0, overtimeMinutes: 0 },
    consumed: { earnings: extra.consumed ?? null, deductions: ded.consumed ?? null },
  };
}

async function computeEmployee(client, c, run, emp, cfg) {
  if (run.run_type === "final_settlement") return computeSettlement(client, c, run, emp, cfg);
  const from = String(run.period_start);
  const to = String(run.period_end);
  const D = daysBetween(from, to) + 1;
  const exceptions = [];
  const comps = await compensationDuring(client, emp.id, from, to);
  if (!comps.length) return { skip: true, exceptions: [{ code: "NO_COMPENSATION", severity: "error", message: `${emp.employee_number} has no approved compensation for this period. No payslip was produced.` }] };
  const segs = [];
  for (const k of comps) {
    const sf = String(k.effective_from) > from ? String(k.effective_from) : from;
    const st = k.effective_to && String(k.effective_to) < to ? String(k.effective_to) : to;
    if (sf > st) continue;
    segs.push({ k, sf, st, sum: await computeAttendanceSummary(client, c, emp.id, sf, st, { runId: run.id }) });
  }
  const lateDeduction = segs.reduce((n, s) => n + s.sum.lateDeductionDays, 0);
  const employedInSegs = segs.reduce((n, s) => n + (s.sum.calendarDays - s.sum.notEmployedDays), 0);
  let payable = segs.reduce((n, s) => n + s.sum.payableDays, 0);
  let basis = cfg.payroll_days_basis;
  if (basis === "fixed_30" && segs.length > 1) {
    basis = "calendar";
    exceptions.push({ code: "BASIS_FALLBACK", severity: "warning", message: "Pay changed during the period, so days were counted on the calendar rather than a fixed 30." });
  }
  const unpaidLate = Math.min(lateDeduction, payable);
  payable = Math.max(0, payable - unpaidLate);
  // per-segment payable, with the late-mark deduction taken from the last segment
  let remainingDeduct = unpaidLate;
  const parts = [...segs].reverse().map((s) => {
    const take = Math.min(remainingDeduct, s.sum.payableDays);
    remainingDeduct -= take;
    return { ...s, payable: s.sum.payableDays - take, employed: s.sum.calendarDays - s.sum.notEmployedDays };
  }).reverse();
  const totalUnpaid = D - payable; // includes days before joining / after leaving
  const ratioFor = (p) => (basis === "fixed_30" && parts.length === 1 ? Math.max(0, Math.min(30, 30 - totalUnpaid)) / 30 : p.payable / D);
  const employedRatioFor = (p) => (basis === "fixed_30" && parts.length === 1 ? Math.max(0, 30 - (D - p.employed)) / 30 : p.employed / D);
  const byCode = new Map();
  for (const p of parts) {
    for (const comp of p.k.breakup.components ?? []) {
      if (comp.statutory || !(comp.amount > 0)) continue;
      const scaled = comp.amount * (comp.prorated ? ratioFor(p) : employedRatioFor(p));
      const cur = byCode.get(comp.code) ?? { ...comp, amount: 0 };
      cur.amount += scaled;
      byCode.set(comp.code, cur);
    }
  }
  const lines = [];
  for (const comp of byCode.values()) {
    const amount = round2(comp.amount);
    if (comp.type === "earning") lines.push(line({ code: comp.code, name: comp.name, type: "earning", kind: comp.kind, amount, taxable: comp.taxable ? amount : 0 }));
    else if (comp.type === "deduction") lines.push(line({ code: comp.code, name: comp.name, type: "deduction", kind: comp.kind, amount, taxable: 0 }));
    else lines.push(line({ code: comp.code, name: comp.name, type: "employer_contribution", kind: comp.kind, amount: 0, taxable: 0, employer: amount }));
  }
  const lastSeg = parts[parts.length - 1];
  const monthlyGross = Number(lastSeg.k.monthly_gross);
  // overtime (F427): approved hours, at the hourly rate x the multiplier
  const otMinutes = segs.reduce((n, s) => n + s.sum.overtimeMinutes, 0);
  let overtimeAmount = 0;
  if (otMinutes > 0) {
    const hourly = monthlyGross / Number(cfg.overtime_basis_days) / Number(cfg.overtime_hours_per_day);
    overtimeAmount = round2((otMinutes / 60) * hourly * Number(cfg.overtime_multiplier));
    const comp = await ensureSystemComponent(client, c, "OVERTIME", "Overtime", "earning", "overtime");
    lines.push(line({ code: "OVERTIME", name: "Overtime", type: "earning", kind: "overtime", amount: overtimeAmount, componentId: comp.id }));
  }
  const pendingOt = (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_overtime WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3 AND status='pending'`, [emp.id, from, to])).rows[0].n;
  if (pendingOt > 0) exceptions.push({ code: "PENDING_OVERTIME", severity: "warning", message: `${pendingOt} overtime item(s) are still awaiting approval and are not paid in this run.` });
  const unmarked = segs.reduce((n, s) => n + s.sum.unmarkedDays, 0);
  if (unmarked > 0) exceptions.push({ code: "UNMARKED_DAYS", severity: "warning", message: `${unmarked} working day(s) have no attendance and are treated as unpaid.` });
  const pendingLeave = (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_leave_requests WHERE employee_id=$1 AND status='submitted' AND start_date <= $3 AND end_date >= $2`, [emp.id, from, to])).rows[0].n;
  if (pendingLeave > 0) exceptions.push({ code: "PENDING_LEAVE", severity: "warning", message: `${pendingLeave} leave request(s) in this period are awaiting a decision.` });
  if (!emp.bank_details?.account_number) exceptions.push({ code: "MISSING_BANK", severity: "warning", message: "No bank account is on file. The net pay cannot be transferred until one is added." });
  if (!emp.tax_identifiers?.pan) exceptions.push({ code: "NO_PAN", severity: "warning", message: "No PAN is on file, which raises the tax deducted." });
  const empStart = String(emp.joining_date) > from ? String(emp.joining_date) : from;
  const lastDay = emp.separation_date ?? emp.last_working_date ?? null;
  const empEnd = lastDay && String(lastDay) < to ? String(lastDay) : to;
  const employedPeriodDays = empEnd >= empStart ? daysBetween(empStart, empEnd) + 1 : 0;
  if (employedInSegs < employedPeriodDays) exceptions.push({ code: "COMP_GAP", severity: "warning", message: `Pay is not set for ${employedPeriodDays - employedInSegs} day(s) the employee was employed. Those days are unpaid.` });

  const hookCtx = { client, c, run, employee: emp, cfg, lines, exceptions, attendance: { payable, D, segments: parts.map((p) => ({ from: p.sf, to: p.st, payable: p.payable })) }, monthlyGross };
  const extra = PAYROLL_HOOKS.earnings ? await PAYROLL_HOOKS.earnings(hookCtx) : { lines: [], data: {} };
  for (const l of extra.lines ?? []) lines.push(line(l));
  const gross = round2(lines.filter((l) => l.type === "earning").reduce((n, l) => n + l.amount, 0));
  const taxableGross = round2(lines.filter((l) => l.type === "earning").reduce((n, l) => n + l.taxable, 0));
  const pfWages = round2([...byCode.values()].filter((x) => x.type === "earning" && x.pf_wage).reduce((n, x) => n + x.amount, 0));
  const esicWages = round2([...byCode.values()].filter((x) => x.type === "earning" && x.esic_wage).reduce((n, x) => n + x.amount, 0) + lines.filter((l) => l.code === "OVERTIME").reduce((n, l) => n + l.amount, 0));
  const statutory = PAYROLL_HOOKS.statutory ? await PAYROLL_HOOKS.statutory({ ...hookCtx, gross, taxableGross, pfWages, esicWages, monthlyGross }) : { lines: [], data: {} };
  for (const l of statutory.lines ?? []) lines.push(line(l));
  const preCapDeductions = round2(lines.filter((l) => l.type === "deduction").reduce((n, l) => n + l.amount, 0));
  const ded = PAYROLL_HOOKS.deductions ? await PAYROLL_HOOKS.deductions({ ...hookCtx, gross, taxableGross, alreadyDeducted: preCapDeductions }) : { lines: [], data: {} };
  for (const l of ded.lines ?? []) lines.push(line(l));
  const deductions = round2(lines.filter((l) => l.type === "deduction").reduce((n, l) => n + l.amount, 0));
  const employer = round2(lines.reduce((n, l) => n + l.employer, 0));
  const net = round2(gross - deductions);
  if (net < 0) exceptions.push({ code: "NEGATIVE_NET", severity: "error", message: `Deductions (${deductions}) exceed earnings (${gross}). The net pay would be ${net}.` });
  const leaveDays = segs.reduce((n, s) => n + s.sum.paidLeaveDays + s.sum.unpaidLeaveDays, 0);
  const snapshot = {
    basis,
    period: { from, to, days: D },
    compensation: parts.map((p) => ({ id: p.k.id, from: p.sf, to: p.st, monthlyGross: Number(p.k.monthly_gross), annualCtc: Number(p.k.annual_ctc), structureVersion: p.k.structure_version, payable: p.payable, employed: p.employed })),
    attendance: { payableDays: payable, lopDays: round2(D - payable - segs.reduce((n, s) => n + s.sum.notEmployedDays, 0)), lateDeductionDays: unpaidLate, overtimeMinutes: otMinutes, unmarkedDays: unmarked },
    inputs: extra.data ?? {},
    statutory: statutory.data ?? {},
    deductions: ded.data ?? {},
    wages: { pf: pfWages, esic: esicWages, taxableGross },
  };
  const ordered = lines.map((l, i) => ({ ...l, sequence: i + 1 }));
  const hash = sha({ lines: ordered.map((l) => [l.code, l.type, l.amount, l.taxable, l.employer]), totals: [gross, deductions, employer, net], snapshot });
  return {
    skip: false, exceptions, lines: ordered, gross, deductions, employer, net, snapshot, hash,
    days: { working: D, paid: round2(payable), leave: round2(leaveDays), lop: snapshot.attendance.lopDays, overtimeMinutes: otMinutes },
    consumed: { earnings: extra.consumed ?? null, deductions: ded.consumed ?? null },
  };
}

async function eligibleEmployees(client, c, run, employeeIds) {
  const params = [c.organizationId, c.companyId, run.period_start, run.period_end];
  let extra = "";
  if (employeeIds?.length) { params.push(employeeIds); extra += ` AND id = ANY($${params.length}::uuid[])`; }
  const scope = run.scope ?? {};
  if (scope.departmentId) { params.push(scope.departmentId); extra += ` AND department_id=$${params.length}`; }
  if (scope.branchId) { params.push(scope.branchId); extra += ` AND branch_id=$${params.length}`; }
  // someone already paid by another live regular run of the same period is not paid twice -- $N for
  // run.id is only added (and only referenced) when this clause is actually used
  let notElsewhere = "";
  if (run.run_type === "regular") {
    params.push(run.id);
    notElsewhere = ` AND NOT EXISTS (SELECT 1 FROM tenant.hr_payslips ps JOIN tenant.hr_payroll_runs pr ON pr.id=ps.payroll_run_id WHERE ps.employee_id=tenant.hr_employees.id AND pr.id <> $${params.length} AND pr.run_type='regular' AND pr.status <> 'cancelled' AND pr.period_start=$3 AND pr.period_end=$4)`;
  }
  return (await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND status <> 'draft' AND joining_date <= $4 AND (separation_date IS NULL OR separation_date >= $3)${extra}${notElsewhere} ORDER BY employee_number`, params)).rows;
}

export async function startPayrollRun(client, c, input) {
  need(c, PREPARE);
  const period = (await qx(client, `SELECT * FROM tenant.hr_payroll_periods WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.periodId, "Period")])).rows[0];
  if (!period) throw new HrError(404, "Payroll period was not found.", "HR_PERIOD_NOT_FOUND");
  if (period.status === "closed") throw new HrError(409, "That period is closed.", "HR_PERIOD_STATE");
  const type = oneOf(String(input.runType ?? "regular"), ["regular", "off_cycle", "final_settlement"], "Run type");
  const departmentId = uuidOrNull(input.departmentId, "Department");
  const branchId = uuidOrNull(input.branchId, "Branch");
  const scope = { ...(departmentId ? { departmentId } : {}), ...(branchId ? { branchId } : {}) };
  const scopeKey = type === "off_cycle" ? "off" : type === "final_settlement" ? "fs" : departmentId || branchId ? `${departmentId ? `d:${departmentId}` : ""}${branchId ? `|b:${branchId}` : ""}` : "all";
  if (type === "regular") {
    const exists = await qx(client, `SELECT payroll_number FROM tenant.hr_payroll_runs WHERE period_id=$1 AND run_type='regular' AND scope_key=$2 AND status <> 'cancelled'`, [period.id, scopeKey]);
    if (exists.rows[0]) throw new HrError(409, `Payroll ${exists.rows[0].payroll_number} already exists for this period and group.`, "HR_RUN_EXISTS");
    // a company-wide payroll and a group payroll for the same period would pay people twice
    const clash = await qx(client, `SELECT payroll_number FROM tenant.hr_payroll_runs WHERE period_id=$1 AND run_type='regular' AND status <> 'cancelled' AND ($2='all' OR scope_key='all')`, [period.id, scopeKey]);
    if (clash.rows[0]) throw new HrError(409, `Payroll ${clash.rows[0].payroll_number} already covers this period for everyone or for this group.`, "HR_RUN_EXISTS");
  }
  let base = `PAY-${period.period_code}`;
  if (type === "off_cycle") base = `${base}-OC`;
  else if (type === "final_settlement") base = `${base}-FS`;
  else if (scopeKey !== "all") {
    const label = departmentId ? (await qx(client, `SELECT code FROM tenant.hr_departments WHERE id=$1`, [departmentId])).rows[0]?.code : (await qx(client, `SELECT code FROM public.branches WHERE id=$1`, [branchId])).rows[0]?.code;
    base = `${base}-${String(label ?? "GRP").toUpperCase()}`;
  }
  // a cancelled run keeps its number; running again gets the next revision
  let number = base;
  for (let n = 1; (await qx(client, `SELECT 1 FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND payroll_number=$2`, [c.organizationId, number])).rows[0]; n += 1) number = `${base}-${type === "off_cycle" ? "" : "R"}${n + 1}`;
  const { rows } = await qx(client, `INSERT INTO tenant.hr_payroll_runs(organization_id,company_id,payroll_number,period_start,period_end,payment_date,status,created_by,period_id,run_type,notes,scope,scope_key) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11::jsonb,$12) RETURNING *`,
    [c.organizationId, c.companyId, number, period.period_start, period.period_end, period.payment_date, c.userId, period.id, type, textOrNull(input.notes, 500), JSON.stringify(scope), scopeKey]);
  await recordEvent(client, c, "payroll_run", rows[0].id, "hr.payroll.started", { number });
  return rows[0];
}

async function loadRun(client, c, id, lock = false) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Payroll run")]);
  if (!rows[0]) throw new HrError(404, "Payroll run was not found.", "HR_RUN_NOT_FOUND");
  return rows[0];
}

export async function runPayrollCalculation(client, c, id, input = {}) {
  need(c, PREPARE);
  const run = await loadRun(client, c, id, true);
  if (!["draft", "calculated"].includes(run.status)) throw new HrError(409, "Only a draft or calculated payroll can be (re)calculated. Send a submitted one back first.", "HR_RUN_STATE");
  const cfg = await settings(client, c);
  // recalculation starts clean: release what the previous calculation reserved
  await qx(client, `UPDATE tenant.hr_overtime SET payroll_run_id=NULL WHERE payroll_run_id=$1 AND status='approved'`, [run.id]);
  if (PAYROLL_HOOKS.afterCancel) await PAYROLL_HOOKS.afterCancel({ client, c, run, reason: "recalculation", keepRun: true });
  await qx(client, `DELETE FROM tenant.hr_payslips WHERE payroll_run_id=$1`, [run.id]);
  await qx(client, `DELETE FROM tenant.hr_payroll_exceptions WHERE payroll_run_id=$1`, [run.id]);
  const needsExplicitEmployees = run.run_type === "off_cycle" || run.run_type === "final_settlement";
  const emps = await eligibleEmployees(client, c, run, needsExplicitEmployees ? (Array.isArray(input.employeeIds) ? input.employeeIds.map((x) => uuid(x, "Employee")) : []) : null);
  if (needsExplicitEmployees && !emps.length) throw new HrError(400, run.run_type === "final_settlement" ? "The settled employee could not be found for this run." : "Choose the employees for an off-cycle run.", "HR_RUN_EMPTY");
  let gross = 0; let ded = 0; let employer = 0; let net = 0; let count = 0; let errors = 0;
  const hashes = [];
  for (const emp of emps) {
    const r = await computeEmployee(client, c, run, emp, cfg);
    for (const ex of r.exceptions) {
      await qx(client, `INSERT INTO tenant.hr_payroll_exceptions(organization_id,company_id,payroll_run_id,employee_id,code,severity,message) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [c.organizationId, c.companyId, run.id, emp.id, ex.code, ex.severity, ex.message]);
      if (ex.severity === "error") errors += 1;
    }
    if (r.skip) continue;
    const slip = (await qx(client, `INSERT INTO tenant.hr_payslips(organization_id,company_id,payroll_run_id,employee_id,payslip_number,working_days,paid_days,leave_days,absent_days,overtime_minutes,gross_pay,total_deductions,employer_contributions,net_pay,status,generated_at,source_snapshot,calc_hash,lop_days)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'calculated',now(),$15::jsonb,$16,$17) RETURNING *`,
      [c.organizationId, c.companyId, run.id, emp.id, `PS-${run.payroll_number}-${emp.employee_number}`, r.days.working, r.days.paid, r.days.leave, r.days.lop, r.days.overtimeMinutes, r.gross, r.deductions, r.employer, r.net, JSON.stringify(r.snapshot), r.hash, r.days.lop])).rows[0];
    for (const l of r.lines) {
      await qx(client, `INSERT INTO tenant.hr_payslip_lines(organization_id,payslip_id,salary_component_id,statutory_component_id,component_code,component_name,component_type,amount,taxable_amount,employer_amount,line_sequence,component_kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [c.organizationId, slip.id, l.componentId, l.statutoryId, l.code, l.name, l.type, l.amount, l.taxable, l.employer, l.sequence, l.kind]);
    }
    if (r.snapshot.attendance.overtimeMinutes > 0) await qx(client, `UPDATE tenant.hr_overtime SET payroll_run_id=$4 WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3 AND status='approved' AND payroll_run_id IS NULL`, [emp.id, run.period_start, run.period_end, run.id]);
    if (PAYROLL_HOOKS.afterPayslip) await PAYROLL_HOOKS.afterPayslip({ client, c, run, employee: emp, payslip: slip, consumed: r.consumed });
    hashes.push(`${emp.employee_number}:${r.hash}`);
    gross += r.gross; ded += r.deductions; employer += r.employer; net += r.net; count += 1;
  }
  const { rows } = await qx(client, `UPDATE tenant.hr_payroll_runs SET status='calculated', employee_count=$2, gross_pay=$3, total_deductions=$4, employer_contributions=$5, net_pay=$6, calculated_by=$7, calculated_at=now(), calc_hash=$8, returned_reason=NULL WHERE id=$1 RETURNING *`,
    [run.id, count, round2(gross), round2(ded), round2(employer), round2(net), c.userId, sha(hashes)]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.calculated", { employees: count, net: round2(net), errors });
  return { ...rows[0], blockingExceptions: errors };
}

export async function submitPayrollRun(client, c, id) {
  need(c, PREPARE);
  const run = await loadRun(client, c, id, true);
  if (run.status !== "calculated") throw new HrError(409, "Only a calculated payroll can be submitted for approval.", "HR_RUN_STATE");
  const open = (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_payroll_exceptions WHERE payroll_run_id=$1 AND severity='error' AND NOT resolved`, [run.id])).rows[0].n;
  if (open > 0) throw new HrError(409, `${open} blocking exception(s) must be resolved before the payroll can be submitted.`, "HR_RUN_BLOCKED");
  if (!run.employee_count) throw new HrError(409, "There is nobody to pay in this run.", "HR_RUN_EMPTY");
  const { rows } = await qx(client, `UPDATE tenant.hr_payroll_runs SET status='pending_approval', submitted_by=$2, submitted_at=now() WHERE id=$1 RETURNING *`, [run.id, c.userId]);
  await qx(client, `UPDATE tenant.hr_payslips SET status='calculated' WHERE payroll_run_id=$1`, [run.id]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.submitted", {});
  return rows[0];
}
export async function returnPayrollRun(client, c, id, reason) {
  needAny(c, [PREPARE, APPROVE]);
  const run = await loadRun(client, c, id, true);
  if (run.status !== "pending_approval") throw new HrError(409, "Only a payroll awaiting approval can be sent back.", "HR_RUN_STATE");
  if (!text(reason)) throw new HrError(400, "Give a reason for sending the payroll back.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_payroll_runs SET status='calculated', returned_reason=$2, submitted_by=NULL, submitted_at=NULL WHERE id=$1 RETURNING *`, [run.id, text(reason, 500)]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.returned", { reason: text(reason, 300) });
  return rows[0];
}
export async function decidePayrollRun(client, c, id, { approve, note }) {
  need(c, APPROVE);
  const run = await loadRun(client, c, id, true);
  if (run.status !== "pending_approval") throw new HrError(409, "Only a payroll awaiting approval can be decided.", "HR_RUN_STATE");
  // maker-checker: nobody who created, calculated or submitted the payroll may approve it
  if ([run.created_by, run.calculated_by, run.submitted_by].includes(c.userId)) throw new HrError(403, "A payroll must be approved by someone who did not create, calculate or submit it.", "SELF_APPROVAL_BLOCKED");
  const self = await ownEmployee(client, c);
  if (self) {
    const inRun = await qx(client, `SELECT 1 FROM tenant.hr_payslips WHERE payroll_run_id=$1 AND employee_id=$2`, [run.id, self.id]);
    if (inRun.rows[0]) throw new HrError(403, "You cannot approve a payroll that includes your own pay.", "SELF_APPROVAL_BLOCKED");
  }
  if (!approve) return returnPayrollRun(client, c, id, note);
  const cfg = await settings(client, c);
  const { rows } = await qx(client, `UPDATE tenant.hr_payroll_runs SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1 RETURNING *`, [run.id, c.userId]);
  await qx(client, `UPDATE tenant.hr_payslips SET status='approved', released_at=CASE WHEN $2='approval' THEN now() ELSE NULL END WHERE payroll_run_id=$1 AND status <> 'held'`, [run.id, cfg.payslip_release]);
  await qx(client, `UPDATE tenant.hr_overtime SET status='paid' WHERE payroll_run_id=$1 AND status='approved'`, [run.id]);
  await qx(client, `UPDATE tenant.hr_payroll_periods SET status='locked', locked_by=coalesce(locked_by,$2), locked_at=coalesce(locked_at,now()) WHERE id=$1 AND status='open'`, [run.period_id, c.userId]);
  if (PAYROLL_HOOKS.afterApprove) await PAYROLL_HOOKS.afterApprove({ client, c, run: rows[0] });
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.approved", { note: textOrNull(note, 300) });
  return rows[0];
}
export async function cancelPayroll(client, c, id, reason) {
  need(c, PREPARE);
  const run = await loadRun(client, c, id, true);
  if (!["draft", "calculated", "pending_approval", "approved"].includes(run.status)) throw new HrError(409, "A payroll that has been posted to accounting cannot be cancelled here.", "HR_RUN_STATE");
  if (run.status === "approved") need(c, APPROVE);
  if (!text(reason)) throw new HrError(400, "Give a reason for cancelling the payroll.", "HR_REASON_REQUIRED");
  await qx(client, `UPDATE tenant.hr_overtime SET payroll_run_id=NULL, status='approved' WHERE payroll_run_id=$1 AND status IN ('approved','paid')`, [run.id]);
  if (PAYROLL_HOOKS.afterCancel) await PAYROLL_HOOKS.afterCancel({ client, c, run, reason: text(reason, 300), keepRun: false });
  await qx(client, `UPDATE tenant.hr_payslips SET status='cancelled', released_at=NULL WHERE payroll_run_id=$1`, [run.id]);
  const { rows } = await qx(client, `UPDATE tenant.hr_payroll_runs SET status='cancelled', cancelled_by=$2, cancelled_at=now(), cancel_reason=$3 WHERE id=$1 RETURNING *`, [run.id, c.userId, text(reason, 500)]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.cancelled", { reason: text(reason, 300) });
  return rows[0];
}

export async function listPayrollExceptions(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.runId) { params.push(uuid(filters.runId, "Payroll run")); extra += ` AND x.payroll_run_id=$${params.length}`; }
  if (filters.open === true) extra += ` AND NOT x.resolved`;
  const { rows } = await qx(client, `SELECT x.*, r.payroll_number, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_payroll_exceptions x JOIN tenant.hr_payroll_runs r ON r.id=x.payroll_run_id LEFT JOIN tenant.hr_employees e ON e.id=x.employee_id WHERE x.organization_id=$1 AND x.company_id=$2${extra} ORDER BY x.resolved, x.severity, x.created_at DESC LIMIT 1000`, params);
  return rows;
}
export async function resolvePayrollException(client, c, id, note) {
  need(c, PREPARE);
  if (!text(note)) throw new HrError(400, "Say how the exception was resolved.", "HR_REASON_REQUIRED");
  const x = (await qx(client, `SELECT x.*, r.status AS run_status FROM tenant.hr_payroll_exceptions x JOIN tenant.hr_payroll_runs r ON r.id=x.payroll_run_id WHERE x.organization_id=$1 AND x.id=$2 FOR UPDATE OF x`, [c.organizationId, uuid(id, "Exception")])).rows[0];
  if (!x) throw new HrError(404, "Exception was not found.", "HR_EXCEPTION_NOT_FOUND");
  if (!["draft", "calculated"].includes(x.run_status)) throw new HrError(409, "Exceptions are resolved before the payroll is submitted.", "HR_RUN_STATE");
  if (x.resolved) throw new HrError(409, "That exception is already resolved.", "HR_EXCEPTION_STATE");
  // some errors cannot be waved through: they must be fixed at the source and the payroll recalculated
  if (x.code === "NO_COMPENSATION") throw new HrError(409, "Set the employee's pay, then recalculate. This cannot be waived.", "HR_EXCEPTION_UNWAIVABLE");
  if (x.code === "NEGATIVE_NET") {
    const held = await qx(client, `SELECT 1 FROM tenant.hr_payslips WHERE payroll_run_id=$1 AND employee_id=$2 AND status='held'`, [x.payroll_run_id, x.employee_id]);
    if (!held.rows[0]) throw new HrError(409, "Hold this employee's payment first (or fix the pay and recalculate). A negative net pay cannot be waived.", "HR_EXCEPTION_UNWAIVABLE");
  }
  return (await qx(client, `UPDATE tenant.hr_payroll_exceptions SET resolved=true, resolved_by=$2, resolved_at=now(), resolution_note=$3 WHERE id=$1 RETURNING *`, [x.id, c.userId, text(note, 500)])).rows[0];
}

// ---------------------------------------------------------------- reading runs and payslips
export async function listPayrollRuns(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra = ` AND r.status=$3`; }
  const { rows } = await qx(client, `SELECT r.*, (SELECT count(*) FROM tenant.hr_payroll_exceptions x WHERE x.payroll_run_id=r.id AND x.severity='error' AND NOT x.resolved)::int AS blocking, (SELECT count(*) FROM tenant.hr_payroll_exceptions x WHERE x.payroll_run_id=r.id AND x.severity='warning' AND NOT x.resolved)::int AS warnings FROM tenant.hr_payroll_runs r WHERE r.organization_id=$1 AND r.company_id=$2${extra} ORDER BY r.period_start DESC, r.created_at DESC LIMIT 500`, params);
  return rows;
}
export async function getPayrollRun(client, c, id) {
  needAny(c, VIEW);
  const run = await loadRun(client, c, id);
  const payslips = (await qx(client, `SELECT p.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_payslips p JOIN tenant.hr_employees e ON e.id=p.employee_id WHERE p.payroll_run_id=$1 ORDER BY e.employee_number`, [run.id])).rows;
  const exceptions = (await qx(client, `SELECT x.*, e.employee_number FROM tenant.hr_payroll_exceptions x LEFT JOIN tenant.hr_employees e ON e.id=x.employee_id WHERE x.payroll_run_id=$1 ORDER BY x.resolved, x.severity`, [run.id])).rows;
  const byComponent = (await qx(client, `SELECT l.component_code, l.component_name, l.component_type, sum(l.amount) AS amount, sum(l.employer_amount) AS employer FROM tenant.hr_payslip_lines l JOIN tenant.hr_payslips p ON p.id=l.payslip_id WHERE p.payroll_run_id=$1 GROUP BY 1,2,3 ORDER BY l.component_type, l.component_code`, [run.id])).rows;
  return { ...run, payslips, exceptions, byComponent };
}
export async function listPayslips(client, c, filters = {}) {
  needAny(c, ["hr_payroll.payslip.view", "hr_payroll.payroll.prepare", "hr_payroll.payroll.approve"]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.runId) { params.push(uuid(filters.runId, "Payroll run")); extra += ` AND p.payroll_run_id=$${params.length}`; }
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND p.employee_id=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND p.status=$${params.length}`; }
  const { rows } = await qx(client, `SELECT p.*, r.payroll_number, r.period_start, r.period_end, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id=p.payroll_run_id JOIN tenant.hr_employees e ON e.id=p.employee_id WHERE p.organization_id=$1 AND p.company_id=$2${extra} ORDER BY r.period_start DESC, e.employee_number LIMIT 1000`, params);
  return rows;
}
export async function getPayslip(client, c, id) {
  const own = await ownEmployee(client, c);
  const p = (await qx(client, `SELECT p.*, r.payroll_number, r.period_start, r.period_end, r.payment_date, r.status AS run_status, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, e.bank_details FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id=p.payroll_run_id JOIN tenant.hr_employees e ON e.id=p.employee_id WHERE p.organization_id=$1 AND p.id=$2`, [c.organizationId, uuid(id, "Payslip")])).rows[0];
  if (!p) throw new HrError(404, "Payslip was not found.", "HR_PAYSLIP_NOT_FOUND");
  const mine = Boolean(own && own.id === p.employee_id);
  if (mine) { if (!p.released_at || p.status === "cancelled") throw new HrError(404, "Payslip was not found.", "HR_PAYSLIP_NOT_FOUND"); }
  else needAny(c, ["hr_payroll.payslip.view", "hr_payroll.payroll.prepare", "hr_payroll.payroll.approve"]);
  const lines = (await qx(client, `SELECT component_code, component_name, component_type, component_kind, amount, taxable_amount, employer_amount FROM tenant.hr_payslip_lines WHERE payslip_id=$1 ORDER BY line_sequence`, [p.id])).rows;
  const { source_snapshot: _s, ...rest } = p;
  const bank = p.bank_details?.account_number ? { ...p.bank_details, account_number: `••••${String(p.bank_details.account_number).slice(-4)}` } : null;
  return { ...rest, bank_details: bank, lines, snapshot: mine ? undefined : p.source_snapshot };
}
export async function listMyPayslips(client, c) {
  const own = await ownEmployee(client, c);
  if (!own) throw new HrError(404, "Your user is not linked to an employee record. Ask HR to link it.", "HR_NO_EMPLOYEE_PROFILE");
  const { rows } = await qx(client, `SELECT p.id, p.payslip_number, p.gross_pay, p.total_deductions, p.net_pay, p.paid_days, p.status, p.released_at, r.period_start, r.period_end, r.payment_date, r.payroll_number FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id=p.payroll_run_id WHERE p.employee_id=$1 AND p.released_at IS NOT NULL AND p.status <> 'cancelled' ORDER BY r.period_start DESC LIMIT 60`, [own.id]);
  return rows;
}

// F424: the same inputs give the same payslips. Recompute every payslip and compare hashes.
export async function verifyPayrollDeterminism(client, c, id) {
  needAny(c, VIEW);
  const run = await loadRun(client, c, id);
  const cfg = await settings(client, c);
  const emps = await eligibleEmployees(client, c, run, null);
  const stored = new Map((await qx(client, `SELECT employee_id, calc_hash FROM tenant.hr_payslips WHERE payroll_run_id=$1`, [run.id])).rows.map((r) => [r.employee_id, r.calc_hash]));
  const mismatches = [];
  let checked = 0;
  for (const emp of emps) {
    if (!stored.has(emp.id)) continue;
    const r = await computeEmployee(client, c, run, emp, cfg);
    checked += 1;
    if (r.hash !== stored.get(emp.id)) mismatches.push(emp.employee_number);
  }
  return { checked, matches: mismatches.length === 0, mismatches };
}

export async function holdPayslip(client, c, id, reason) {
  need(c, PREPARE);
  if (!text(reason)) throw new HrError(400, "Give a reason for holding the payment.", "HR_REASON_REQUIRED");
  const p = (await qx(client, `SELECT p.*, r.status AS run_status FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id=p.payroll_run_id WHERE p.organization_id=$1 AND p.id=$2 FOR UPDATE OF p`, [c.organizationId, uuid(id, "Payslip")])).rows[0];
  if (!p) throw new HrError(404, "Payslip was not found.", "HR_PAYSLIP_NOT_FOUND");
  if (!["calculated", "pending_approval", "approved", "posted"].includes(p.run_status) || p.status === "held" || p.status === "paid") throw new HrError(409, "That payslip cannot be held now.", "HR_PAYSLIP_STATE");
  return (await qx(client, `UPDATE tenant.hr_payslips SET status='held', hold_reason=$2 WHERE id=$1 RETURNING *`, [p.id, text(reason, 300)])).rows[0];
}
export async function releasePayslipHold(client, c, id) {
  need(c, APPROVE);
  const p = (await qx(client, `SELECT p.*, r.status AS run_status FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id=p.payroll_run_id WHERE p.organization_id=$1 AND p.id=$2 FOR UPDATE OF p`, [c.organizationId, uuid(id, "Payslip")])).rows[0];
  if (!p || p.status !== "held") throw new HrError(409, "That payslip is not on hold.", "HR_PAYSLIP_STATE");
  const status = { approved: "approved", posted: "posted" }[p.run_status] ?? "calculated";
  return (await qx(client, `UPDATE tenant.hr_payslips SET status=$2, hold_reason=NULL WHERE id=$1 RETURNING *`, [p.id, status])).rows[0];
}

export async function getPayrollDashboard(client, c) {
  needAny(c, VIEW);
  const latest = (await qx(client, `SELECT * FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND status <> 'cancelled' ORDER BY period_start DESC, created_at DESC LIMIT 1`, [c.organizationId, c.companyId])).rows[0] ?? null;
  const counts = (await qx(client, `SELECT status, count(*)::int AS n FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 GROUP BY status`, [c.organizationId, c.companyId])).rows;
  const openExceptions = (await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_payroll_exceptions x JOIN tenant.hr_payroll_runs r ON r.id=x.payroll_run_id WHERE x.organization_id=$1 AND x.company_id=$2 AND NOT x.resolved AND r.status IN ('draft','calculated','pending_approval')`, [c.organizationId, c.companyId])).rows[0].n;
  const nextPeriod = (await qx(client, `SELECT p.* FROM tenant.hr_payroll_periods p WHERE p.organization_id=$1 AND p.company_id=$2 AND p.status <> 'closed' AND NOT EXISTS (SELECT 1 FROM tenant.hr_payroll_runs r WHERE r.period_id=p.id AND r.run_type='regular' AND r.status <> 'cancelled') ORDER BY p.period_start LIMIT 1`, [c.organizationId, c.companyId])).rows[0] ?? null;
  return { latestRun: latest, runsByStatus: Object.fromEntries(counts.map((r) => [r.status, r.n])), openExceptions, nextPeriodToRun: nextPeriod };
}
void has; void dateOrNull; void uuidOrNull; void seq;
