// F410-F414, F416-F417: leave types, policies, balances through an append-only ledger, accrual,
// year-end carry forward, leave requests with balance/notice/overlap rules, and approval.
import {
  HrError, addDays, dateOrNull, dateRequired, has, hasAny, need, needAny, nonNegative, oneOf, ownEmployee, qx, recordEvent, round2, text, textOrNull, today, uuid, uuidOrNull,
} from "./common.js";
import { assertDateOpen, loadDayContext, recomputeDay } from "./time.js";

const LIVE = ["active", "on_leave", "on_notice"];
const MANAGE = "hr_payroll.leave.manage";
const APPROVE = "hr_payroll.leave.approve";
const VIEW = [MANAGE, APPROVE, "hr_payroll.employee.view", "hr_payroll.employee.manage", "hr_payroll.reports.view"];
const r4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

async function settings(client, c) {
  await qx(client, `INSERT INTO tenant.hr_payroll_settings(organization_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.organizationId, c.companyId]);
  return (await qx(client, `SELECT * FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId])).rows[0];
}
async function loadEmployee(client, c, id) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Employee")]);
  if (!rows[0]) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  return rows[0];
}
const pad = (n) => String(n).padStart(2, "0");
export function leaveYearOf(date, startMonth = 1) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= startMonth ? y : y - 1;
}
export const leaveYearRange = (year, startMonth = 1) => ({ start: `${year}-${pad(startMonth)}-01`, end: addDays(`${year + 1}-${pad(startMonth)}-01`, -1) });
const daysIn = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
const monthEnd = (ymd) => addDays(`${Number(ymd.slice(5, 7)) === 12 ? Number(ymd.slice(0, 4)) + 1 : ymd.slice(0, 4)}-${pad(Number(ymd.slice(5, 7)) === 12 ? 1 : Number(ymd.slice(5, 7)) + 1)}-01`, -1);
const addMonths = (ymd, n) => {
  const t = Number(ymd.slice(0, 4)) * 12 + (Number(ymd.slice(5, 7)) - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`;
};

// ---------------------------------------------------------------- leave types (F410)
export async function listLeaveTypes(client, c) {
  needAny(c, ["hr_payroll.view", ...VIEW]);
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 ORDER BY code`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveLeaveType(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 20).toUpperCase();
  const name = text(input.name, 80);
  if (!/^[A-Z0-9_-]{1,20}$/.test(code) || !name) throw new HrError(400, "A leave type needs a code (letters and digits) and a name.", "HR_LEAVE_TYPE_INVALID");
  const paid = input.paid !== false;
  const carry = input.carryForwardAllowed === true;
  const maxCarry = nonNegative(input.maxCarryForward, "Maximum carry forward");
  if (carry && maxCarry <= 0) throw new HrError(400, "A type that carries forward needs a carry-forward limit above zero.", "HR_LEAVE_TYPE_INVALID");
  const maxConsecutive = input.maxConsecutiveDays === undefined || input.maxConsecutiveDays === "" || input.maxConsecutiveDays === null ? null : Number(input.maxConsecutiveDays);
  if (maxConsecutive !== null && !(maxConsecutive > 0)) throw new HrError(400, "Maximum consecutive days must be above zero.", "HR_LEAVE_TYPE_INVALID");
  const values = [name, paid, carry, maxCarry, input.encashmentAllowed === true, input.requiresAttachment === true, input.halfDayAllowed !== false, Math.trunc(nonNegative(input.minNoticeDays, "Notice")), maxConsecutive, input.allowNegativeBalance === true,
    oneOf(String(input.applicableGender ?? "any"), ["any", "female", "male"], "Applicable to"), input.countsWeekends === true, input.active !== false];
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.hr_leave_types SET name=$4, paid=$5, carry_forward_allowed=$6, max_carry_forward=$7, encashment_allowed=$8, requires_attachment=$9, half_day_allowed=$10, min_notice_days=$11, max_consecutive_days=$12, allow_negative_balance=$13, applicable_gender=$14, counts_weekends=$15, active=$16 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Leave type"), ...values]);
    if (!rows[0]) throw new HrError(404, "Leave type was not found.", "HR_LEAVE_TYPE_NOT_FOUND");
    return rows[0];
  }
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code]);
  if (dup.rows[0]) throw new HrError(409, `Leave type ${code} already exists.`, "HR_LEAVE_TYPE_DUPLICATE");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_leave_types(organization_id,company_id,code,name,paid,carry_forward_allowed,max_carry_forward,encashment_allowed,requires_attachment,half_day_allowed,min_notice_days,max_consecutive_days,allow_negative_balance,applicable_gender,counts_weekends,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [c.organizationId, c.companyId, code, ...values, c.userId]);
  return rows[0];
}

// ---------------------------------------------------------------- policies (F411)
export async function listLeavePolicies(client, c) {
  needAny(c, ["hr_payroll.view", ...VIEW]);
  const { rows } = await qx(client, `SELECT p.*, (SELECT count(*) FROM tenant.hr_employees e WHERE e.leave_policy_id=p.id AND e.status <> 'separated')::int AS employees,
      coalesce((SELECT json_agg(json_build_object('id',en.id,'leaveTypeId',en.leave_type_id,'code',t.code,'name',t.name,'annualDays',en.annual_days,'accrualFrequency',en.accrual_frequency,'maxBalance',en.max_balance,'carryForwardLimit',en.carry_forward_limit,'eligibleAfterDays',en.eligible_after_days) ORDER BY t.code) FROM tenant.hr_leave_policy_entries en JOIN tenant.hr_leave_types t ON t.id=en.leave_type_id WHERE en.policy_id=p.id),'[]'::json) AS entries
    FROM tenant.hr_leave_policies p WHERE p.organization_id=$1 AND p.company_id=$2 ORDER BY p.code`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveLeavePolicy(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 20).toUpperCase();
  const name = text(input.name, 80);
  if (!/^[A-Z0-9_-]{1,20}$/.test(code) || !name) throw new HrError(400, "A policy needs a code and a name.", "HR_POLICY_INVALID");
  const types = Array.isArray(input.employmentTypes) ? input.employmentTypes : typeof input.employmentTypes === "string" && input.employmentTypes ? input.employmentTypes.split(",").map((s) => s.trim()) : [];
  for (const t of types) oneOf(t, ["permanent", "contract", "intern", "consultant", "part_time", "temporary"], "Employment type");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.hr_leave_policies SET name=$4, employment_types=$5::text[], active=$6 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(input.id, "Policy"), name, types, input.active !== false]);
    if (!rows[0]) throw new HrError(404, "Policy was not found.", "HR_POLICY_NOT_FOUND");
    return rows[0];
  }
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_leave_policies WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code]);
  if (dup.rows[0]) throw new HrError(409, `Policy ${code} already exists.`, "HR_POLICY_DUPLICATE");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_leave_policies(organization_id,company_id,code,name,employment_types,created_by) VALUES ($1,$2,$3,$4,$5::text[],$6) RETURNING *`, [c.organizationId, c.companyId, code, name, types, c.userId]);
  return rows[0];
}
export async function setPolicyEntry(client, c, input) {
  need(c, MANAGE);
  const p = (await qx(client, `SELECT id FROM tenant.hr_leave_policies WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.policyId, "Policy")])).rows[0];
  if (!p) throw new HrError(404, "Policy was not found.", "HR_POLICY_NOT_FOUND");
  const t = (await qx(client, `SELECT * FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, uuid(input.leaveTypeId, "Leave type")])).rows[0];
  if (!t) throw new HrError(400, "Leave type was not found or is inactive.", "HR_LEAVE_TYPE_NOT_FOUND");
  if (!t.paid) throw new HrError(400, "Unpaid leave does not carry an entitlement. It is available to everyone without a balance.", "HR_POLICY_INVALID");
  const annual = nonNegative(input.annualDays, "Annual days");
  const frequency = oneOf(String(input.accrualFrequency ?? "monthly"), ["upfront", "monthly", "quarterly", "yearly", "none"], "Accrual");
  const maxBalance = input.maxBalance === undefined || input.maxBalance === "" || input.maxBalance === null ? null : nonNegative(input.maxBalance, "Maximum balance");
  const cf = nonNegative(input.carryForwardLimit, "Carry forward limit");
  if (cf > 0 && !t.carry_forward_allowed) throw new HrError(400, `${t.name} does not allow carry forward. Enable it on the leave type first.`, "HR_POLICY_INVALID");
  if (maxBalance !== null && maxBalance < annual && frequency === "upfront") throw new HrError(400, "The maximum balance is below the annual entitlement.", "HR_POLICY_INVALID");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_leave_policy_entries(organization_id,policy_id,leave_type_id,annual_days,accrual_frequency,max_balance,carry_forward_limit,eligible_after_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (policy_id,leave_type_id) DO UPDATE SET annual_days=EXCLUDED.annual_days, accrual_frequency=EXCLUDED.accrual_frequency, max_balance=EXCLUDED.max_balance, carry_forward_limit=EXCLUDED.carry_forward_limit, eligible_after_days=EXCLUDED.eligible_after_days RETURNING *`,
    [c.organizationId, p.id, t.id, annual, frequency, maxBalance, cf, Math.trunc(nonNegative(input.eligibleAfterDays, "Eligibility"))]);
  return rows[0];
}
export async function removePolicyEntry(client, c, id) {
  need(c, MANAGE);
  const { rows } = await qx(client, `DELETE FROM tenant.hr_leave_policy_entries WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, uuid(id, "Entry")]);
  if (!rows[0]) throw new HrError(404, "Entry was not found.", "HR_POLICY_ENTRY_NOT_FOUND");
  return rows[0];
}
export async function assignLeavePolicy(client, c, input) {
  need(c, MANAGE);
  const p = (await qx(client, `SELECT * FROM tenant.hr_leave_policies WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, uuid(input.policyId, "Policy")])).rows[0];
  if (!p) throw new HrError(404, "Policy was not found or is inactive.", "HR_POLICY_NOT_FOUND");
  const ids = Array.isArray(input.employeeIds) ? input.employeeIds.map((x) => uuid(x, "Employee")) : input.employeeId ? [uuid(input.employeeId, "Employee")] : null;
  const params = [c.organizationId, c.companyId, p.id, LIVE];
  let where = `organization_id=$1 AND company_id=$2 AND status = ANY($4::text[])`;
  if (ids) { params.push(ids); where += ` AND id = ANY($5::uuid[])`; }
  else if (p.employment_types.length) { params.push(p.employment_types); where += ` AND employment_type = ANY($5::text[])`; }
  else throw new HrError(400, "Choose the employees, or give the policy the employment types it covers.", "HR_POLICY_INVALID");
  const { rows } = await qx(client, `UPDATE tenant.hr_employees SET leave_policy_id=$3, updated_at=now() WHERE ${where} RETURNING id`, params);
  await recordEvent(client, c, "leave_policy", p.id, "hr.leave_policy.assigned", { employees: rows.length });
  return { assigned: rows.length, employeeIds: rows.map((r) => r.id) };
}
async function policyEntries(client, c, employee) {
  let policyId = employee.leave_policy_id;
  if (!policyId) {
    policyId = (await qx(client, `SELECT id FROM tenant.hr_leave_policies WHERE organization_id=$1 AND company_id=$2 AND active AND $3 = ANY(employment_types) ORDER BY code LIMIT 1`, [c.organizationId, c.companyId, employee.employment_type])).rows[0]?.id;
  }
  if (!policyId) return [];
  return (await qx(client, `SELECT en.*, t.code AS type_code, t.name AS type_name, t.carry_forward_allowed, t.max_carry_forward FROM tenant.hr_leave_policy_entries en JOIN tenant.hr_leave_types t ON t.id=en.leave_type_id WHERE en.policy_id=$1 AND t.active`, [policyId])).rows;
}

// ---------------------------------------------------------------- ledger and balances (F412)
async function post(client, c, e) {
  const days = r4(e.days);
  const ins = await qx(client, `INSERT INTO tenant.hr_leave_ledger(organization_id,company_id,employee_id,leave_type_id,leave_year,entry_type,days,period_key,reference_id,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id`,
    [c.organizationId, c.companyId, e.employeeId, e.leaveTypeId, e.year, e.type, days, e.periodKey ?? null, e.referenceId ?? null, textOrNull(e.note, 300), c.userId]);
  if (!ins.rows[0]) return false;
  const open = e.type === "opening" || (e.type === "carry_forward" && days > 0) ? days : 0;
  const accrued = e.type === "accrual" ? days : 0;
  const used = e.type === "usage" ? -days : e.type === "reversal" ? -days : 0;
  const adjusted = ["adjustment", "lapse", "encashment"].includes(e.type) || (e.type === "carry_forward" && days < 0) ? days : 0;
  await qx(client,
    `INSERT INTO tenant.hr_leave_balances(organization_id,company_id,employee_id,leave_type_id,leave_year,opening_balance,accrued,used,adjusted,closing_balance)
     VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$6::numeric+$7::numeric+$9::numeric-$8::numeric)
     ON CONFLICT (employee_id,leave_type_id,leave_year) DO UPDATE SET
       opening_balance=tenant.hr_leave_balances.opening_balance+$6::numeric, accrued=tenant.hr_leave_balances.accrued+$7::numeric, used=tenant.hr_leave_balances.used+$8::numeric, adjusted=tenant.hr_leave_balances.adjusted+$9::numeric,
       closing_balance=(tenant.hr_leave_balances.opening_balance+$6::numeric)+(tenant.hr_leave_balances.accrued+$7::numeric)+(tenant.hr_leave_balances.adjusted+$9::numeric)-(tenant.hr_leave_balances.used+$8::numeric), updated_at=now()`,
    [c.organizationId, c.companyId, e.employeeId, e.leaveTypeId, e.year, open, accrued, used, adjusted]);
  return true;
}
async function balanceOf(client, employeeId, typeId, year) {
  const b = (await qx(client, `SELECT closing_balance FROM tenant.hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND leave_year=$3`, [employeeId, typeId, year])).rows[0];
  return b ? Number(b.closing_balance) : 0;
}
async function pendingDays(client, employeeId, typeId, year, exceptId = null) {
  return Number((await qx(client, `SELECT coalesce(sum(days),0) AS d FROM tenant.hr_leave_requests WHERE employee_id=$1 AND leave_type_id=$2 AND leave_year=$3 AND status='submitted' AND ($4::uuid IS NULL OR id <> $4::uuid)`, [employeeId, typeId, year, exceptId])).rows[0].d);
}

export async function listLeaveBalances(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const cfg = await settings(client, c);
  const year = filters.leaveYear ? Math.trunc(Number(filters.leaveYear)) : leaveYearOf(today(), cfg.leave_year_start_month);
  const params = [c.organizationId, c.companyId, year];
  let extra = "";
  if (filters.mine === true || !hasAny(c, VIEW)) {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra = ` AND b.employee_id=$4`;
  } else if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra = ` AND b.employee_id=$4`; }
  const { rows } = await qx(client,
    `SELECT b.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, t.code AS type_code, t.name AS type_name,
       coalesce((SELECT sum(r.days) FROM tenant.hr_leave_requests r WHERE r.employee_id=b.employee_id AND r.leave_type_id=b.leave_type_id AND r.leave_year=b.leave_year AND r.status='submitted'),0) AS pending
     FROM tenant.hr_leave_balances b JOIN tenant.hr_employees e ON e.id=b.employee_id JOIN tenant.hr_leave_types t ON t.id=b.leave_type_id
     WHERE b.organization_id=$1 AND b.company_id=$2 AND b.leave_year=$3${extra} ORDER BY e.employee_number, t.code LIMIT 2000`, params);
  return rows.map((r) => ({ ...r, available: r4(Number(r.closing_balance) - Number(r.pending)) }));
}
export async function getLeaveLedger(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(filters.employeeId ?? own?.id, "Employee");
  if (!(own && own.id === employeeId)) needAny(c, VIEW);
  const params = [c.organizationId, employeeId];
  let extra = "";
  if (filters.leaveTypeId) { params.push(uuid(filters.leaveTypeId, "Leave type")); extra += ` AND l.leave_type_id=$${params.length}`; }
  if (filters.leaveYear) { params.push(Math.trunc(Number(filters.leaveYear))); extra += ` AND l.leave_year=$${params.length}`; }
  const { rows } = await qx(client, `SELECT l.*, t.code AS type_code FROM tenant.hr_leave_ledger l JOIN tenant.hr_leave_types t ON t.id=l.leave_type_id WHERE l.organization_id=$1 AND l.employee_id=$2${extra} ORDER BY l.created_at, l.id LIMIT 1000`, params);
  return rows;
}
export async function adjustLeaveBalance(client, c, input) {
  need(c, MANAGE);
  const e = await loadEmployee(client, c, input.employeeId);
  const t = (await qx(client, `SELECT * FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.leaveTypeId, "Leave type")])).rows[0];
  if (!t) throw new HrError(404, "Leave type was not found.", "HR_LEAVE_TYPE_NOT_FOUND");
  const days = Number(input.days);
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 365) throw new HrError(400, "Give the days to add or remove (not zero).", "HR_ADJUST_INVALID");
  if (!text(input.note)) throw new HrError(400, "Say why the balance is being adjusted.", "HR_REASON_REQUIRED");
  const cfg = await settings(client, c);
  const year = input.leaveYear ? Math.trunc(Number(input.leaveYear)) : leaveYearOf(today(), cfg.leave_year_start_month);
  if (!t.allow_negative_balance && (await balanceOf(client, e.id, t.id, year)) + days < 0) throw new HrError(409, "That would take the balance below zero.", "HR_BALANCE_NEGATIVE");
  await post(client, c, { employeeId: e.id, leaveTypeId: t.id, year, type: "adjustment", days, note: text(input.note, 300) });
  await recordEvent(client, c, "employee", e.id, "hr.leave.adjusted", { type: t.code, days, note: text(input.note, 300) });
  return (await qx(client, `SELECT * FROM tenant.hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND leave_year=$3`, [e.id, t.id, year])).rows[0];
}

// ---------------------------------------------------------------- accrual (F413)
export async function runLeaveAccrual(client, c, input = {}) {
  need(c, MANAGE);
  const cfg = await settings(client, c);
  const asOf = dateOrNull(input.asOf, "As of") ?? today();
  const year = leaveYearOf(asOf, cfg.leave_year_start_month);
  const { start: yStart, end: yEnd } = leaveYearRange(year, cfg.leave_year_start_month);
  const params = [c.organizationId, c.companyId, LIVE];
  let extra = "";
  if (input.employeeId) { params.push(uuid(input.employeeId, "Employee")); extra = ` AND id=$4`; }
  const emps = (await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND status = ANY($3::text[]) AND joining_date <= '${asOf}'${extra} ORDER BY employee_number`, params)).rows;
  let credited = 0;
  let totalDays = 0;
  const touched = new Set();
  for (const emp of emps) {
    const entries = await policyEntries(client, c, emp);
    const lastDay = emp.last_working_date ?? null;
    for (const en of entries) {
      if (en.accrual_frequency === "none" || Number(en.annual_days) <= 0) continue;
      const periods = [];
      if (en.accrual_frequency === "monthly" || en.accrual_frequency === "quarterly") {
        const step = en.accrual_frequency === "monthly" ? 1 : 3;
        for (let s = yStart; s <= asOf && s <= yEnd; s = addMonths(s, step)) {
          const e2 = addDays(addMonths(s, step), -1);
          periods.push({ key: step === 1 ? s.slice(0, 7) : `${s.slice(0, 4)}-Q${Math.floor(((Number(s.slice(5, 7)) - cfg.leave_year_start_month + 12) % 12) / 3) + 1}`, from: s, to: e2, amount: Number(en.annual_days) / (12 / step) });
        }
      } else periods.push({ key: en.accrual_frequency === "upfront" ? "upfront" : String(year), from: yStart, to: yEnd, amount: Number(en.annual_days) });
      for (const p of periods) {
        const from = p.from > emp.joining_date ? p.from : emp.joining_date;
        const to = lastDay && lastDay < p.to ? lastDay : p.to;
        if (to < from) continue;
        if (daysIn(emp.joining_date, p.to) - 1 < Number(en.eligible_after_days)) continue;
        const fraction = daysIn(from, to) / daysIn(p.from, p.to);
        let amount = r4(p.amount * fraction);
        let note = `${en.type_code} ${p.key}`;
        if (en.max_balance !== null) {
          const room = Number(en.max_balance) - (await balanceOf(client, emp.id, en.leave_type_id, year));
          if (amount > room) { amount = Math.max(0, r4(room)); note += " (capped at the maximum balance)"; }
        }
        const done = await post(client, c, { employeeId: emp.id, leaveTypeId: en.leave_type_id, year, type: "accrual", days: amount, periodKey: p.key, note });
        if (done && amount > 0) { credited += 1; totalDays += amount; touched.add(emp.id); }
      }
    }
  }
  await recordEvent(client, c, "leave_accrual", c.companyId, "hr.leave.accrual_run", { asOf, credited, employees: touched.size });
  return { asOf, leaveYear: year, employeesProcessed: emps.length, credits: credited, totalDays: r4(totalDays) };
}

// ---------------------------------------------------------------- carry forward (F414)
export async function runYearEndCarryForward(client, c, input = {}) {
  need(c, MANAGE);
  const cfg = await settings(client, c);
  const fromYear = Math.trunc(Number(input.leaveYear ?? leaveYearOf(today(), cfg.leave_year_start_month) - 1));
  const { end } = leaveYearRange(fromYear, cfg.leave_year_start_month);
  if (end >= today()) throw new HrError(409, `Leave year ${fromYear} ends on ${end}. Carry forward runs after the year has ended.`, "HR_YEAR_NOT_ENDED");
  const rows = (await qx(client, `SELECT b.*, t.carry_forward_allowed, t.max_carry_forward, e.status FROM tenant.hr_leave_balances b JOIN tenant.hr_leave_types t ON t.id=b.leave_type_id JOIN tenant.hr_employees e ON e.id=b.employee_id WHERE b.organization_id=$1 AND b.company_id=$2 AND b.leave_year=$3 AND e.status <> 'separated' AND b.closing_balance > 0`, [c.organizationId, c.companyId, fromYear])).rows;
  let carried = 0;
  let lapsed = 0;
  let processed = 0;
  for (const b of rows) {
    const emp = await loadEmployee(client, c, b.employee_id);
    const entry = (await policyEntries(client, c, emp)).find((x) => x.leave_type_id === b.leave_type_id);
    const limit = entry ? Number(entry.carry_forward_limit) : Number(b.max_carry_forward);
    const closing = Number(b.closing_balance);
    const carry = b.carry_forward_allowed ? Math.min(closing, limit) : 0;
    const drop = r4(closing - carry);
    if (carry > 0) {
      const a = await post(client, c, { employeeId: b.employee_id, leaveTypeId: b.leave_type_id, year: fromYear, type: "carry_forward", days: -carry, periodKey: "cf-out", note: `Carried to ${fromYear + 1}` });
      if (a) {
        await post(client, c, { employeeId: b.employee_id, leaveTypeId: b.leave_type_id, year: fromYear + 1, type: "carry_forward", days: carry, periodKey: "cf-in", note: `Carried from ${fromYear}` });
        carried += carry;
      }
    }
    if (drop > 0) {
      const l = await post(client, c, { employeeId: b.employee_id, leaveTypeId: b.leave_type_id, year: fromYear, type: "lapse", days: -drop, periodKey: "lapse", note: `Lapsed at the end of ${fromYear}` });
      if (l) lapsed += drop;
    }
    processed += 1;
  }
  await recordEvent(client, c, "leave_carry_forward", c.companyId, "hr.leave.carry_forward_run", { fromYear, carried, lapsed });
  return { leaveYear: fromYear, balancesProcessed: processed, carriedForward: r4(carried), lapsed: r4(lapsed) };
}

// ---------------------------------------------------------------- requests (F416, F417)
async function computeLeave(client, c, employee, type, cfg, { startDate, endDate, startHalf, endHalf }) {
  const ctx = await loadDayContext(client, c, employee, startDate, endDate);
  const all = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) all.push({ date: d, ...ctx.classify(d) });
  const working = all.filter((d) => d.kind === "working");
  if (!working.length && !type.counts_weekends) return { days: 0, breakdown: [] };
  const firstWorking = working[0]?.date;
  const lastWorking = working[working.length - 1]?.date;
  const breakdown = [];
  for (const d of all) {
    let portion = 0;
    if (d.kind === "working") portion = 1;
    else if (type.counts_weekends) portion = 1;
    else if (cfg.sandwich_rule && firstWorking && lastWorking && d.date > firstWorking && d.date < lastWorking) portion = 1; // off day sandwiched between leave days
    if (portion === 0) continue;
    if (d.date === startDate && startHalf) portion = 0.5;
    if (d.date === endDate && endHalf && !(startDate === endDate && startHalf)) portion = 0.5;
    breakdown.push({ date: d.date, portion, half: portion === 0.5 ? (d.date === startDate && startHalf ? "second" : "first") : null });
  }
  return { days: r4(breakdown.reduce((n, b) => n + b.portion, 0)), breakdown };
}

async function validateRequest(client, c, employee, type, cfg, input, { forHr, exceptId = null, approval = false }) {
  const startDate = dateRequired(input.startDate, "Start date");
  const endDate = dateRequired(input.endDate ?? input.startDate, "End date");
  if (endDate < startDate) throw new HrError(400, "The end date is before the start date.", "HR_LEAVE_INVALID");
  if (startDate < employee.joining_date) throw new HrError(400, "That is before the employee joined.", "HR_LEAVE_INVALID");
  if (!LIVE.includes(employee.status)) throw new HrError(409, "Only a current employee can take leave.", "HR_EMPLOYEE_STATE");
  const lastDay = employee.last_working_date ?? employee.separation_date;
  if (lastDay && endDate > lastDay) throw new HrError(400, `Leave cannot extend past the last working day (${lastDay}).`, "HR_LEAVE_INVALID");
  if (daysIn(startDate, endDate) > 366) throw new HrError(400, "A single request cannot span more than a year.", "HR_LEAVE_INVALID");
  const startHalf = input.startHalf === true;
  const endHalf = input.endHalf === true;
  if ((startHalf || endHalf) && !type.half_day_allowed) throw new HrError(400, `${type.name} cannot be taken in half days.`, "HR_LEAVE_HALF_DAY");
  const gender = String(employee.gender ?? "").toLowerCase();
  if (type.applicable_gender !== "any" && !gender.startsWith(type.applicable_gender.charAt(0))) throw new HrError(409, `${type.name} is not available for this employee.`, "HR_LEAVE_NOT_APPLICABLE");
  const back = forHr ? 30 : 7;
  if (!approval && startDate < addDays(today(), -back)) throw new HrError(400, `Leave can be applied for at most ${back} days after the fact.`, "HR_LEAVE_TOO_OLD");
  const notice = Math.round((Date.parse(startDate) - Date.parse(today())) / 86400000);
  if (!approval && !forHr && notice >= 0 && notice < type.min_notice_days) throw new HrError(409, `${type.name} needs ${type.min_notice_days} day(s) notice.`, "HR_LEAVE_NOTICE");
  if (type.requires_attachment && !text(input.attachmentReference)) throw new HrError(400, `${type.name} needs a supporting document.`, "HR_LEAVE_ATTACHMENT");
  const { days, breakdown } = await computeLeave(client, c, employee, type, cfg, { startDate, endDate, startHalf, endHalf });
  if (days <= 0) throw new HrError(400, "That range has no working days to take leave on.", "HR_LEAVE_NO_DAYS");
  if (type.max_consecutive_days !== null && days > Number(type.max_consecutive_days)) throw new HrError(409, `${type.name} is limited to ${type.max_consecutive_days} consecutive day(s).`, "HR_LEAVE_MAX_CONSECUTIVE");
  const overlap = await qx(client, `SELECT 1 FROM tenant.hr_leave_requests WHERE employee_id=$1 AND status IN ('submitted','approved') AND start_date <= $3 AND end_date >= $2 AND ($4::uuid IS NULL OR id <> $4::uuid) LIMIT 1`, [employee.id, startDate, endDate, exceptId]);
  if (overlap.rows[0]) throw new HrError(409, "The employee already has leave in that period.", "HR_LEAVE_OVERLAP");
  const lockedRun = (await qx(client, `SELECT payroll_number FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND status IN ('approved','posted') AND period_start <= $4 AND period_end >= $3 LIMIT 1`, [c.organizationId, c.companyId, startDate, endDate])).rows[0];
  if (lockedRun) throw new HrError(409, `Those dates fall in payroll ${lockedRun.payroll_number}, which is already approved.`, "HR_PERIOD_LOCKED");
  const year = leaveYearOf(startDate, cfg.leave_year_start_month);
  if (type.paid) {
    const spanYears = new Set(breakdown.map((b) => leaveYearOf(b.date, cfg.leave_year_start_month)));
    for (const y of spanYears) {
      const need2 = breakdown.filter((b) => leaveYearOf(b.date, cfg.leave_year_start_month) === y).reduce((n, b) => n + b.portion, 0);
      const entries = await policyEntries(client, c, employee);
      const inPolicy = entries.some((x) => x.leave_type_id === type.id);
      const bal = (await balanceOf(client, employee.id, type.id, y)) - (await pendingDays(client, employee.id, type.id, y, exceptId));
      if (!type.allow_negative_balance && (!inPolicy && bal <= 0)) throw new HrError(409, `The employee's leave policy does not include ${type.name}.`, "HR_LEAVE_NOT_IN_POLICY");
      if (!type.allow_negative_balance && need2 > bal + 1e-9) throw new HrError(409, `${type.name}: ${r4(need2)} day(s) requested, ${r4(Math.max(bal, 0))} available.`, "HR_LEAVE_INSUFFICIENT_BALANCE");
    }
  }
  return { startDate, endDate, startHalf, endHalf, days, breakdown, year };
}

export async function applyLeave(client, c, input) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const employee = await loadEmployee(client, c, employeeId);
  const isSelf = Boolean(own && own.id === employee.id);
  const forHr = has(c, MANAGE);
  if (!isSelf && !forHr) throw new HrError(403, "You can only apply for your own leave.", "HR_FORBIDDEN");
  const type = (await qx(client, `SELECT * FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, uuid(input.leaveTypeId, "Leave type")])).rows[0];
  if (!type) throw new HrError(400, "Leave type was not found or is inactive.", "HR_LEAVE_TYPE_NOT_FOUND");
  const cfg = await settings(client, c);
  const v = await validateRequest(client, c, employee, type, cfg, input, { forHr: forHr && !isSelf });
  const { rows } = await qx(client,
    `INSERT INTO tenant.hr_leave_requests(organization_id,company_id,employee_id,leave_type_id,start_date,end_date,days,reason,attachment_reference,status,submitted_at,created_by,start_half,end_half,leave_year) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted',now(),$10,$11,$12,$13) RETURNING *`,
    [c.organizationId, c.companyId, employee.id, type.id, v.startDate, v.endDate, v.days, textOrNull(input.reason, 1000), textOrNull(input.attachmentReference, 500), c.userId, v.startHalf, v.endHalf, v.year]);
  await recordEvent(client, c, "employee", employee.id, "hr.leave.requested", { requestId: rows[0].id, days: v.days, type: type.code });
  return rows[0];
}

async function markAttendance(client, c, employee, request, breakdown, type) {
  for (const b of breakdown) {
    await qx(client,
      `INSERT INTO tenant.hr_attendance(organization_id,company_id,employee_id,attendance_date,status,source,notes,leave_request_id,half_day_part,created_by) VALUES ($1,$2,$3,$4,$5,'system',$6,$7,$8,$9)
       ON CONFLICT (employee_id,attendance_date) DO UPDATE SET status=EXCLUDED.status, source='system', notes=EXCLUDED.notes, leave_request_id=EXCLUDED.leave_request_id, half_day_part=EXCLUDED.half_day_part, late_minutes=0, early_exit_minutes=0, overtime_minutes=0, updated_at=now()`,
      [c.organizationId, c.companyId, employee.id, b.date, b.portion === 1 ? "leave" : "half_day", `Leave ${type.code}`, request.id, b.half, c.userId]);
    await qx(client, `DELETE FROM tenant.hr_overtime WHERE employee_id=$1 AND work_date=$2 AND status='pending'`, [employee.id, b.date]);
  }
}

export async function decideLeave(client, c, id, { approve, note }) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_leave_requests WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Leave request")]);
  const r = rows[0];
  if (!r) throw new HrError(404, "Leave request was not found.", "HR_LEAVE_NOT_FOUND");
  const employee = await loadEmployee(client, c, r.employee_id);
  const own = await ownEmployee(client, c);
  const isManager = Boolean(own && employee.manager_employee_id === own.id);
  if (!isManager && !has(c, APPROVE)) throw new HrError(403, "Only the reporting manager or HR can decide leave.", "HR_FORBIDDEN");
  if (r.status !== "submitted") throw new HrError(409, "Only a submitted request can be decided.", "HR_LEAVE_STATE");
  if (employee.user_id === c.userId || r.created_by === c.userId) throw new HrError(403, "You cannot decide your own leave request.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting the leave.", "HR_REASON_REQUIRED");
  if (!approve) {
    const out = await qx(client, `UPDATE tenant.hr_leave_requests SET status='rejected', approved_by=$2, approved_at=now(), rejection_reason=$3, updated_at=now() WHERE id=$1 RETURNING *`, [r.id, c.userId, text(note)]);
    await recordEvent(client, c, "employee", employee.id, "hr.leave.rejected", { requestId: r.id });
    return out.rows[0];
  }
  const type = (await qx(client, `SELECT * FROM tenant.hr_leave_types WHERE id=$1`, [r.leave_type_id])).rows[0];
  const cfg = await settings(client, c);
  const v = await validateRequest(client, c, employee, type, cfg, { startDate: String(r.start_date), endDate: String(r.end_date), startHalf: r.start_half, endHalf: r.end_half, attachmentReference: r.attachment_reference || "on file" }, { forHr: true, exceptId: r.id, approval: true });
  if (type.paid) {
    const byYear = new Map();
    for (const b of v.breakdown) {
      const y = leaveYearOf(b.date, cfg.leave_year_start_month);
      byYear.set(y, (byYear.get(y) ?? 0) + b.portion);
    }
    for (const [y, d] of byYear) await post(client, c, { employeeId: employee.id, leaveTypeId: type.id, year: y, type: "usage", days: -d, referenceId: r.id, note: `${type.code} ${r.start_date}` });
  }
  await markAttendance(client, c, employee, r, v.breakdown, type);
  const out = await qx(client, `UPDATE tenant.hr_leave_requests SET status='approved', approved_by=$2, approved_at=now(), balance_deducted=$3, days=$4, updated_at=now() WHERE id=$1 RETURNING *`, [r.id, c.userId, type.paid, v.days]);
  await recordEvent(client, c, "employee", employee.id, "hr.leave.approved", { requestId: r.id, days: v.days });
  return out.rows[0];
}

export async function cancelLeave(client, c, id, reason) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_leave_requests WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Leave request")]);
  const r = rows[0];
  if (!r) throw new HrError(404, "Leave request was not found.", "HR_LEAVE_NOT_FOUND");
  const employee = await loadEmployee(client, c, r.employee_id);
  const own = await ownEmployee(client, c);
  const isSelf = Boolean(own && own.id === employee.id);
  const isManager = Boolean(own && employee.manager_employee_id === own.id);
  if (!isSelf && !isManager && !has(c, MANAGE)) throw new HrError(403, "You cannot cancel this leave.", "HR_FORBIDDEN");
  if (!["submitted", "approved"].includes(r.status)) throw new HrError(409, "Only a submitted or approved request can be cancelled.", "HR_LEAVE_STATE");
  if (!text(reason)) throw new HrError(400, "Give a reason for cancelling.", "HR_REASON_REQUIRED");
  if (r.status === "approved") {
    if (String(r.end_date) < today() && !has(c, MANAGE)) throw new HrError(409, "Leave that has already been taken can only be cancelled by HR.", "HR_LEAVE_PAST");
    const lockedRun = (await qx(client, `SELECT payroll_number FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND status IN ('approved','posted') AND period_start <= $4 AND period_end >= $3 LIMIT 1`, [c.organizationId, c.companyId, r.start_date, r.end_date])).rows[0];
    if (lockedRun) throw new HrError(409, `Those dates fall in payroll ${lockedRun.payroll_number}, which is already approved.`, "HR_PERIOD_LOCKED");
    const used = (await qx(client, `SELECT leave_year, -sum(days) AS d FROM tenant.hr_leave_ledger WHERE reference_id=$1 AND entry_type='usage' GROUP BY leave_year`, [r.id])).rows;
    for (const u of used) await post(client, c, { employeeId: employee.id, leaveTypeId: r.leave_type_id, year: u.leave_year, type: "reversal", days: Number(u.d), referenceId: r.id, periodKey: `rev-${r.id}-${u.leave_year}`, note: `Cancelled: ${text(reason, 200)}` });
    const days = (await qx(client, `SELECT attendance_date FROM tenant.hr_attendance WHERE leave_request_id=$1`, [r.id])).rows;
    await qx(client, `UPDATE tenant.hr_attendance SET leave_request_id=NULL, half_day_part=NULL WHERE leave_request_id=$1`, [r.id]);
    for (const d of days) {
      if (d.attendance_date > today()) await qx(client, `DELETE FROM tenant.hr_attendance WHERE employee_id=$1 AND attendance_date=$2 AND source='system'`, [employee.id, d.attendance_date]);
      else await recomputeDay(client, c, employee, d.attendance_date);
    }
  }
  const out = await qx(client, `UPDATE tenant.hr_leave_requests SET status='cancelled', cancelled_by=$2, cancelled_at=now(), cancel_reason=$3, updated_at=now() WHERE id=$1 RETURNING *`, [r.id, c.userId, text(reason, 500)]);
  await recordEvent(client, c, "employee", employee.id, "hr.leave.cancelled", { requestId: r.id });
  return out.rows[0];
}

export async function listLeaveRequests(client, c, filters = {}) {
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
  if (filters.employeeId && filters.scope !== "mine") { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND r.employee_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT r.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, t.code AS type_code, t.name AS type_name, t.paid FROM tenant.hr_leave_requests r JOIN tenant.hr_employees e ON e.id=r.employee_id JOIN tenant.hr_leave_types t ON t.id=r.leave_type_id WHERE r.organization_id=$1 AND r.company_id=$2${extra} ORDER BY r.start_date DESC, r.created_at DESC LIMIT 1000`, params);
  return rows;
}

export async function getLeaveCalendar(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const from = dateOrNull(filters.from, "From") ?? today();
  const to = dateOrNull(filters.to, "To") ?? addDays(from, 30);
  const params = [c.organizationId, c.companyId, from, to];
  let extra = "";
  if (!hasAny(c, VIEW)) {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra = ` AND (e.manager_employee_id=$5 OR e.id=$5)`;
  }
  const { rows } = await qx(client, `SELECT r.id, r.start_date, r.end_date, r.days, r.status, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, t.code AS type_code FROM tenant.hr_leave_requests r JOIN tenant.hr_employees e ON e.id=r.employee_id JOIN tenant.hr_leave_types t ON t.id=r.leave_type_id WHERE r.organization_id=$1 AND r.company_id=$2 AND r.status IN ('approved','submitted') AND r.start_date <= $4 AND r.end_date >= $3${extra} ORDER BY r.start_date`, params);
  return rows;
}

export async function getLeaveDashboard(client, c) {
  needAny(c, VIEW);
  const pending = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_leave_requests WHERE organization_id=$1 AND company_id=$2 AND status='submitted'`, [c.organizationId, c.companyId]);
  const today_ = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_leave_requests WHERE organization_id=$1 AND company_id=$2 AND status='approved' AND start_date <= current_date AND end_date >= current_date`, [c.organizationId, c.companyId]);
  const onLeave = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_leave_requests WHERE organization_id=$1 AND company_id=$2 AND status='approved' AND start_date > current_date AND start_date <= current_date + 14`, [c.organizationId, c.companyId]);
  return { pendingApprovals: pending.rows[0].n, onLeaveToday: today_.rows[0].n, startingWithin14Days: onLeave.rows[0].n };
}
void uuidOrNull; void round2;
