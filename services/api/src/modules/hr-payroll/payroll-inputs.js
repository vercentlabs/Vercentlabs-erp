// F428-F432: what is added to or taken from a payroll besides the structure -- bonus, incentives,
// reimbursements, loans and advances, arrears -- each with its own approval, and the hooks that
// bring approved items into a run exactly once.
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import {
  HrError, addDays, dateOrNull, dateRequired, has, need, needAny, nonNegative, oneOf, ownEmployee, positive, qx, recordEvent, round2, text, textOrNull, today, uuid, uuidOrNull,
} from "./common.js";
import { COMPENSATION_HOOKS, compensationOn, ensureSystemComponent } from "./compensation.js";
import { registerPayrollHook } from "./payroll.js";

const PREPARE = "hr_payroll.payroll.prepare";
const APPROVE = "hr_payroll.payroll.approve";
const monthStart = (d) => `${d.slice(0, 7)}-01`;

const KIND = {
  bonus: { code: "BONUS", name: "Bonus", type: "earning", kind: "bonus" },
  incentive: { code: "INCENTIVE", name: "Incentive", type: "earning", kind: "incentive" },
  allowance: { code: "ADHOC_ALLOW", name: "Additional allowance", type: "earning", kind: "allowance" },
  arrear: { code: "ARREARS", name: "Arrears", type: "earning", kind: "arrear" },
  settlement_earning: { code: "SETTLEMENT_PAY", name: "Settlement payment", type: "earning", kind: "other" },
  deduction: { code: "ADHOC_DED", name: "Deduction", type: "deduction", kind: "other" },
  recovery: { code: "RECOVERY", name: "Recovery", type: "deduction", kind: "other" },
  settlement_deduction: { code: "SETTLEMENT_REC", name: "Settlement recovery", type: "deduction", kind: "other" },
};

async function loadEmployee(client, c, id) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Employee")]);
  if (!rows[0]) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  return rows[0];
}
async function settings(client, c) {
  await qx(client, `INSERT INTO tenant.hr_payroll_settings(organization_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.organizationId, c.companyId]);
  return (await qx(client, `SELECT * FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId])).rows[0];
}

// ---------------------------------------------------------------- inputs (F428, F429)
export async function listPayrollInputs(client, c, filters = {}) {
  needAny(c, [PREPARE, APPROVE, "hr_payroll.reports.view"]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.type) { params.push(String(filters.type)); extra += ` AND i.input_type=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND i.status=$${params.length}`; }
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND i.employee_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT i.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_payroll_inputs i JOIN tenant.hr_employees e ON e.id=i.employee_id WHERE i.organization_id=$1 AND i.company_id=$2${extra} ORDER BY i.created_at DESC LIMIT 1000`, params);
  return rows;
}
export async function createPayrollInput(client, c, input) {
  need(c, PREPARE);
  const e = await loadEmployee(client, c, input.employeeId);
  if (!["active", "on_leave", "on_notice", "suspended"].includes(e.status)) throw new HrError(409, "Adjustments are for current employees. Use the final settlement for someone who has left.", "HR_EMPLOYEE_STATE");
  const type = oneOf(String(input.inputType), ["bonus", "incentive", "allowance", "deduction", "recovery"], "Adjustment type");
  const amount = positive(input.amount, "Amount");
  if (amount > 1e9) throw new HrError(400, "That amount is not plausible.", "HR_INPUT_INVALID");
  const month = monthStart(dateRequired(input.payMonth, "Pay month"));
  if (!text(input.description)) throw new HrError(400, "Say what the adjustment is for.", "HR_INPUT_INVALID");
  const locked = await qx(client, `SELECT payroll_number FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND run_type='regular' AND status IN ('approved','posted','paid') AND period_start <= $3::date + interval '1 month' - interval '1 day' AND period_end >= $3::date LIMIT 1`, [c.organizationId, c.companyId, month]);
  if (locked.rows[0]) throw new HrError(409, `${locked.rows[0].payroll_number} for that month is already approved. Choose the next month.`, "HR_PERIOD_LOCKED");
  await ensureSystemComponent(client, c, KIND[type].code, KIND[type].name, KIND[type].type, KIND[type].kind);
  const { rows } = await qx(client, `INSERT INTO tenant.hr_payroll_inputs(organization_id,company_id,employee_id,input_type,category,amount,taxable,description,pay_month,requested_by,component_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId, c.companyId, e.id, type, textOrNull(input.category, 60), amount, input.taxable !== false, text(input.description, 300), month, c.userId, KIND[type].code]);
  await recordEvent(client, c, "employee", e.id, `hr.input.${type}_requested`, { inputId: rows[0].id, amount });
  return rows[0];
}
// Many at once (typically incentives from a sales sheet). Each row stands alone: a bad row is
// reported, the good ones are created.
export async function bulkCreatePayrollInputs(client, c, input) {
  need(c, PREPARE);
  if (!Array.isArray(input.rows) || !input.rows.length) throw new HrError(400, "Give at least one row.", "HR_INPUT_INVALID");
  if (input.rows.length > 500) throw new HrError(400, "At most 500 rows at a time.", "HR_INPUT_INVALID");
  const results = [];
  for (const [index, row] of input.rows.entries()) {
    try {
      const emp = (await qx(client, `SELECT id FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND employee_number=$3`, [c.organizationId, c.companyId, text(row.employeeNumber, 30)])).rows[0];
      if (!emp) throw new HrError(404, `No employee ${text(row.employeeNumber, 30) || "(blank)"}.`, "HR_EMPLOYEE_NOT_FOUND");
      await qx(client, "SAVEPOINT bulk_row");
      try {
        const rec = await createPayrollInput(client, c, { employeeId: emp.id, inputType: input.inputType, amount: row.amount, payMonth: input.payMonth, description: row.description || input.description, category: input.category });
        await qx(client, "RELEASE SAVEPOINT bulk_row");
        results.push({ row: index + 1, ok: true, id: rec.id });
      } catch (e) {
        await qx(client, "ROLLBACK TO SAVEPOINT bulk_row");
        throw e;
      }
    } catch (e) {
      results.push({ row: index + 1, ok: false, error: e.message, code: e.code });
    }
  }
  return { created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
export async function decidePayrollInput(client, c, id, { approve, note }) {
  need(c, APPROVE);
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_payroll_inputs WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Adjustment")]);
  const i = rows[0];
  if (!i) throw new HrError(404, "Adjustment was not found.", "HR_INPUT_NOT_FOUND");
  if (i.status !== "pending_approval") throw new HrError(409, "Only an adjustment awaiting approval can be decided.", "HR_INPUT_STATE");
  const emp = (await qx(client, `SELECT user_id FROM tenant.hr_employees WHERE id=$1`, [i.employee_id])).rows[0];
  if (i.requested_by === c.userId || emp?.user_id === c.userId) throw new HrError(403, "An adjustment must be approved by someone other than the person who entered it, and never by the employee it is for.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_payroll_inputs SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 RETURNING *`, [i.id, approve ? "approved" : "rejected", c.userId, textOrNull(note)]);
  await recordEvent(client, c, "employee", i.employee_id, approve ? "hr.input.approved" : "hr.input.rejected", { inputId: i.id });
  return out.rows[0];
}
export async function cancelPayrollInput(client, c, id, reason) {
  need(c, PREPARE);
  if (!text(reason)) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_payroll_inputs SET status='cancelled', decision_note=$3 WHERE organization_id=$1 AND id=$2 AND status IN ('pending_approval','approved') AND payroll_run_id IS NULL RETURNING *`, [c.organizationId, uuid(id, "Adjustment"), text(reason, 300)]);
  if (!rows[0]) throw new HrError(409, "Only an adjustment not yet picked up by a payroll can be cancelled.", "HR_INPUT_STATE");
  return rows[0];
}

// ---------------------------------------------------------------- reimbursements (F430)
export async function listExpenseCategories(client, c) {
  needAny(c, ["hr_payroll.expense.manage", "hr_payroll.expense.approve", "hr_payroll.settings.manage", PREPARE]);
  return (await qx(client, `SELECT * FROM tenant.hr_expense_categories WHERE organization_id=$1 AND company_id=$2 ORDER BY code`, [c.organizationId, c.companyId])).rows;
}
export async function saveExpenseCategory(client, c, input) {
  need(c, "hr_payroll.settings.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 100);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new HrError(400, "A category needs a code and a name.", "HR_CATEGORY_INVALID");
  const limit = input.monthlyLimit === undefined || input.monthlyLimit === "" || input.monthlyLimit === null ? null : nonNegative(input.monthlyLimit, "Monthly limit");
  const receipt = input.receiptRequiredAbove === undefined || input.receiptRequiredAbove === "" || input.receiptRequiredAbove === null ? null : nonNegative(input.receiptRequiredAbove, "Receipt threshold");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.hr_expense_categories SET name=$4, monthly_limit=$5, receipt_required_above=$6, active=$7 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(input.id, "Category"), name, limit, receipt, input.active !== false]);
    if (!rows[0]) throw new HrError(404, "Category was not found.", "HR_CATEGORY_NOT_FOUND");
    return rows[0];
  }
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_expense_categories WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code]);
  if (dup.rows[0]) throw new HrError(409, `Category ${code} already exists.`, "HR_CATEGORY_DUPLICATE");
  return (await qx(client, `INSERT INTO tenant.hr_expense_categories(organization_id,company_id,code,name,monthly_limit,receipt_required_above,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [c.organizationId, c.companyId, code, name, limit, receipt, c.userId])).rows[0];
}
export async function listExpenses(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra += ` AND x.status=$${params.length}`; }
  if (filters.scope === "mine") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND x.employee_id=$${params.length}`;
  } else if (filters.scope === "team") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND e.manager_employee_id=$${params.length}`;
  } else needAny(c, ["hr_payroll.expense.manage", "hr_payroll.expense.approve", PREPARE]);
  const { rows } = await qx(client, `SELECT x.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, k.name AS category_name FROM tenant.hr_employee_expenses x JOIN tenant.hr_employees e ON e.id=x.employee_id LEFT JOIN tenant.hr_expense_categories k ON k.id=x.category_id WHERE x.organization_id=$1 AND x.company_id=$2${extra} ORDER BY x.expense_date DESC, x.created_at DESC LIMIT 1000`, params);
  return rows;
}
export async function saveExpense(client, c, input) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const isSelf = Boolean(own && own.id === employeeId);
  if (!isSelf) need(c, "hr_payroll.expense.manage");
  const e = await loadEmployee(client, c, employeeId);
  if (!["active", "on_leave", "on_notice"].includes(e.status)) throw new HrError(409, "Only a current employee can claim expenses.", "HR_EMPLOYEE_STATE");
  const cat = (await qx(client, `SELECT * FROM tenant.hr_expense_categories WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, uuid(input.categoryId, "Category")])).rows[0];
  if (!cat) throw new HrError(400, "Choose an expense category.", "HR_CATEGORY_NOT_FOUND");
  const amount = positive(input.amount, "Amount");
  const date = dateRequired(input.expenseDate, "Expense date");
  if (date > today()) throw new HrError(400, "An expense cannot be dated in the future.", "HR_EXPENSE_INVALID");
  if (date < addDays(today(), -120)) throw new HrError(400, "Expenses older than 120 days can no longer be claimed.", "HR_EXPENSE_TOO_OLD");
  if (cat.receipt_required_above !== null && amount > Number(cat.receipt_required_above) && !text(input.receiptReference)) throw new HrError(400, `A receipt is needed for ${cat.name} claims above ${cat.receipt_required_above}.`, "HR_EXPENSE_RECEIPT");
  if (cat.monthly_limit !== null) {
    const used = Number((await qx(client, `SELECT coalesce(sum(amount),0) AS a FROM tenant.hr_employee_expenses WHERE employee_id=$1 AND category_id=$2 AND status IN ('submitted','approved','reimbursed') AND date_trunc('month', expense_date)=date_trunc('month', $3::date)`, [e.id, cat.id, date])).rows[0].a);
    if (used + amount > Number(cat.monthly_limit)) throw new HrError(409, `${cat.name} is limited to ${cat.monthly_limit} a month; ${used} is already claimed.`, "HR_EXPENSE_LIMIT");
  }
  const number = await nextDocumentNumber(client, c, { documentType: "hr_expense", prefix: "EXP", padding: 6 });
  const cfg = await settings(client, c);
  const { rows } = await qx(client, `INSERT INTO tenant.hr_employee_expenses(organization_id,company_id,employee_id,expense_number,expense_date,category,description,currency_code,amount,base_amount,receipt_reference,status,submitted_at,category_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,'submitted',now(),$11,$12) RETURNING *`,
    [c.organizationId, c.companyId, e.id, number, date, cat.name, textOrNull(input.description, 500), cfg.default_currency_code, amount, textOrNull(input.receiptReference, 500), cat.id, c.userId]);
  await recordEvent(client, c, "employee", e.id, "hr.expense.submitted", { expenseId: rows[0].id, amount });
  return rows[0];
}
export async function decideExpense(client, c, id, { approve, note }) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employee_expenses WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Expense")]);
  const x = rows[0];
  if (!x) throw new HrError(404, "Expense was not found.", "HR_EXPENSE_NOT_FOUND");
  const e = await loadEmployee(client, c, x.employee_id);
  const own = await ownEmployee(client, c);
  const isManager = Boolean(own && e.manager_employee_id === own.id);
  if (!isManager && !has(c, "hr_payroll.expense.approve")) throw new HrError(403, "Only the reporting manager or HR can decide an expense.", "HR_FORBIDDEN");
  if (x.status !== "submitted") throw new HrError(409, "Only a submitted expense can be decided.", "HR_EXPENSE_STATE");
  if (e.user_id === c.userId || x.created_by === c.userId) throw new HrError(403, "You cannot approve your own expense.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_employee_expenses SET status=$2, approved_by=$3, approved_at=now(), rejection_reason=$4, updated_at=now() WHERE id=$1 RETURNING *`, [x.id, approve ? "approved" : "rejected", c.userId, approve ? null : text(note)]);
  await recordEvent(client, c, "employee", x.employee_id, approve ? "hr.expense.approved" : "hr.expense.rejected", { expenseId: x.id });
  return out.rows[0];
}

// ---------------------------------------------------------------- loans and advances (F431)
export function buildSchedule(principal, annualRate, n, firstMonth) {
  const r = annualRate / 1200;
  const emi = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
  const rows = [];
  let balance = principal;
  for (let k = 1; k <= n; k += 1) {
    const interest = round2(balance * r);
    let principalPart = k === n ? round2(balance) : round2(emi - interest);
    if (principalPart > balance) principalPart = round2(balance);
    const month = new Date(Date.UTC(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)) - 1 + (k - 1), 1)).toISOString().slice(0, 10);
    rows.push({ sequence: k, dueMonth: month, principal: principalPart, interest, amount: round2(principalPart + interest) });
    balance = round2(balance - principalPart);
  }
  return { emi: round2(emi), rows };
}
export async function listLoans(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra += ` AND l.status=$${params.length}`; }
  if (filters.scope === "mine") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND l.employee_id=$${params.length}`;
  } else needAny(c, [PREPARE, APPROVE, "hr_payroll.reports.view"]);
  const { rows } = await qx(client, `SELECT l.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, (SELECT count(*) FROM tenant.hr_loan_installments i WHERE i.loan_id=l.id AND i.status='deducted')::int AS paid_installments FROM tenant.hr_loans l JOIN tenant.hr_employees e ON e.id=l.employee_id WHERE l.organization_id=$1 AND l.company_id=$2${extra} ORDER BY l.created_at DESC LIMIT 500`, params);
  return rows;
}
export async function getLoan(client, c, id) {
  const own = await ownEmployee(client, c);
  const l = (await qx(client, `SELECT l.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_loans l JOIN tenant.hr_employees e ON e.id=l.employee_id WHERE l.organization_id=$1 AND l.id=$2`, [c.organizationId, uuid(id, "Loan")])).rows[0];
  if (!l) throw new HrError(404, "Loan was not found.", "HR_LOAN_NOT_FOUND");
  if (!(own && own.id === l.employee_id)) needAny(c, [PREPARE, APPROVE, "hr_payroll.reports.view"]);
  return { ...l, schedule: (await qx(client, `SELECT * FROM tenant.hr_loan_installments WHERE loan_id=$1 ORDER BY sequence`, [l.id])).rows };
}
export async function requestLoan(client, c, input) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const isSelf = Boolean(own && own.id === employeeId);
  if (!isSelf) need(c, PREPARE);
  const e = await loadEmployee(client, c, employeeId);
  if (!["active", "on_leave"].includes(e.status)) throw new HrError(409, "Only a current employee (not serving notice) can take a loan.", "HR_EMPLOYEE_STATE");
  const type = oneOf(String(input.loanType ?? "loan"), ["loan", "advance"], "Type");
  const principal = positive(input.principal, "Amount");
  const n = Math.trunc(positive(input.installments ?? 1, "Installments"));
  if (n > 120) throw new HrError(400, "At most 120 installments.", "HR_LOAN_INVALID");
  const rate = nonNegative(input.interestRate, "Interest rate");
  if (rate > 36) throw new HrError(400, "The interest rate is not plausible.", "HR_LOAN_INVALID");
  const first = monthStart(dateRequired(input.firstDeductionMonth, "First deduction month"));
  if (first <= monthStart(today()) && type === "loan") throw new HrError(400, "Deductions start from next month or later.", "HR_LOAN_INVALID");
  const comp = await compensationOn(client, e.id, today());
  const cfg = await settings(client, c);
  if (!comp) throw new HrError(409, "The employee has no approved pay yet, so a loan cannot be sized against it.", "HR_LOAN_NO_PAY");
  if (principal > Number(comp.monthly_gross) * Number(cfg.max_loan_multiple)) throw new HrError(409, `A loan is limited to ${cfg.max_loan_multiple} times the monthly gross (${round2(Number(comp.monthly_gross) * Number(cfg.max_loan_multiple))}).`, "HR_LOAN_LIMIT");
  const open = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_loans WHERE employee_id=$1 AND loan_type=$2 AND status IN ('pending_approval','active')`, [e.id, type]);
  if (open.rows[0].n > 0) throw new HrError(409, `There is already an open ${type} for this employee.`, "HR_LOAN_OPEN");
  const sched = buildSchedule(principal, rate, n, first);
  const number = await nextDocumentNumber(client, c, { documentType: "hr_loan", prefix: type === "advance" ? "ADV" : "LN", padding: 5 });
  const { rows } = await qx(client, `INSERT INTO tenant.hr_loans(organization_id,company_id,loan_number,employee_id,loan_type,principal,interest_rate,installments,emi,first_deduction_month,purpose,outstanding_principal,requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$6,$12) RETURNING *`,
    [c.organizationId, c.companyId, number, e.id, type, principal, rate, n, sched.emi, first, textOrNull(input.purpose, 300), c.userId]);
  for (const r of sched.rows) await qx(client, `INSERT INTO tenant.hr_loan_installments(organization_id,loan_id,sequence,due_month,principal_amount,interest_amount,amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [c.organizationId, rows[0].id, r.sequence, r.dueMonth, r.principal, r.interest, r.amount]);
  await recordEvent(client, c, "employee", e.id, "hr.loan.requested", { loanId: rows[0].id, principal });
  return { ...rows[0], schedule: sched.rows };
}
export async function decideLoan(client, c, id, { approve, note }) {
  need(c, APPROVE);
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_loans WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Loan")]);
  const l = rows[0];
  if (!l) throw new HrError(404, "Loan was not found.", "HR_LOAN_NOT_FOUND");
  if (l.status !== "pending_approval") throw new HrError(409, "Only a loan awaiting approval can be decided.", "HR_LOAN_STATE");
  const emp = (await qx(client, `SELECT user_id FROM tenant.hr_employees WHERE id=$1`, [l.employee_id])).rows[0];
  if (l.requested_by === c.userId || emp?.user_id === c.userId) throw new HrError(403, "A loan must be approved by someone other than the person who requested it, and never by the borrower.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_loans SET status=$2, approved_by=$3, approved_at=now(), decision_note=$4 WHERE id=$1 RETURNING *`, [l.id, approve ? "active" : "rejected", c.userId, textOrNull(note)]);
  await recordEvent(client, c, "employee", l.employee_id, approve ? "hr.loan.approved" : "hr.loan.rejected", { loanId: l.id });
  return out.rows[0];
}
export async function skipLoanInstallment(client, c, id, reason) {
  need(c, PREPARE);
  if (!text(reason)) throw new HrError(400, "Give a reason for skipping the installment.", "HR_REASON_REQUIRED");
  const i = (await qx(client, `SELECT i.*, l.status AS loan_status FROM tenant.hr_loan_installments i JOIN tenant.hr_loans l ON l.id=i.loan_id WHERE i.organization_id=$1 AND i.id=$2 FOR UPDATE OF i`, [c.organizationId, uuid(id, "Installment")])).rows[0];
  if (!i || i.status !== "scheduled" || i.payroll_run_id || i.loan_status !== "active") throw new HrError(409, "Only a scheduled installment not yet in a payroll can be skipped.", "HR_LOAN_STATE");
  // a skipped installment moves to the end of the schedule
  const last = (await qx(client, `SELECT max(sequence) AS s, max(due_month) AS m FROM tenant.hr_loan_installments WHERE loan_id=$1`, [i.loan_id])).rows[0];
  const nextMonth = new Date(Date.UTC(Number(String(last.m).slice(0, 4)), Number(String(last.m).slice(5, 7)), 1)).toISOString().slice(0, 10);
  await qx(client, `UPDATE tenant.hr_loan_installments SET status='skipped', note=$2 WHERE id=$1`, [i.id, text(reason, 300)]);
  await qx(client, `INSERT INTO tenant.hr_loan_installments(organization_id,loan_id,sequence,due_month,principal_amount,interest_amount,amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [c.organizationId, i.loan_id, Number(last.s) + 1, nextMonth, i.principal_amount, i.interest_amount, i.amount]);
  return (await getLoan(client, c, i.loan_id));
}
// Pay back early: all of it closes the loan; part of it is taken off the last installments.
export async function prepayLoan(client, c, id, input) {
  need(c, PREPARE);
  const l = (await qx(client, `SELECT * FROM tenant.hr_loans WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Loan")])).rows[0];
  if (!l || l.status !== "active") throw new HrError(409, "Only an active loan can be prepaid.", "HR_LOAN_STATE");
  let amount = positive(input.amount, "Amount");
  const outstanding = Number(l.outstanding_principal);
  if (amount > outstanding + 0.001) throw new HrError(400, `Only ${outstanding} is outstanding.`, "HR_LOAN_INVALID");
  const pending = (await qx(client, `SELECT * FROM tenant.hr_loan_installments WHERE loan_id=$1 AND status='scheduled' AND payroll_run_id IS NULL ORDER BY sequence DESC`, [l.id])).rows;
  const paidNow = amount;
  for (const inst of pending) {
    if (amount <= 0) break;
    if (amount >= Number(inst.principal_amount) - 0.001) { await qx(client, `UPDATE tenant.hr_loan_installments SET status='prepaid', note='Prepaid' WHERE id=$1`, [inst.id]); amount = round2(amount - Number(inst.principal_amount)); }
    else { await qx(client, `UPDATE tenant.hr_loan_installments SET principal_amount=principal_amount-$2, amount=amount-$2 WHERE id=$1`, [inst.id, amount]); amount = 0; }
  }
  const left = round2(outstanding - paidNow);
  await qx(client, `UPDATE tenant.hr_loans SET outstanding_principal=$2, status=CASE WHEN $2 <= 0.005 THEN 'closed' ELSE status END, closed_at=CASE WHEN $2 <= 0.005 THEN now() ELSE closed_at END WHERE id=$1`, [l.id, left]);
  await recordEvent(client, c, "employee", l.employee_id, "hr.loan.prepaid", { loanId: l.id, amount: paidNow });
  return getLoan(client, c, l.id);
}

// ---------------------------------------------------------------- arrears (F432)
// When pay is revised backwards in time, every payslip already approved under the old pay is compared
// with what the new pay would have produced. The shortfall becomes an arrear paid in the next
// payroll; an overpayment becomes a recovery awaiting approval. Each payslip is settled once.
export async function calculateArrears(client, c, employeeId) {
  need(c, PREPARE);
  const e = await loadEmployee(client, c, employeeId);
  const slips = (await qx(client, `SELECT p.id, p.paid_days, p.working_days, p.source_snapshot, r.period_start, r.period_end, r.payroll_number FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id=p.payroll_run_id WHERE p.employee_id=$1 AND p.status IN ('approved','posted','paid') AND r.run_type='regular' ORDER BY r.period_start`, [e.id])).rows;
  const created = [];
  for (const p of slips) {
    const should = await compensationOn(client, e.id, String(p.period_end));
    const seg = (p.source_snapshot?.compensation ?? []).slice(-1)[0];
    if (!should || !seg || should.id === seg.id) continue;
    const ratio = Number(p.working_days) > 0 ? Number(p.paid_days) / Number(p.working_days) : 0;
    const diff = round2((Number(should.monthly_gross) - Number(seg.monthlyGross)) * ratio);
    if (Math.abs(diff) < 0.01) continue;
    const kind = diff > 0 ? "arrear" : "recovery";
    const cfg = KIND[kind];
    await ensureSystemComponent(client, c, cfg.code, cfg.name, cfg.type, cfg.kind);
    const exists = await qx(client, `SELECT 1 FROM tenant.hr_payroll_inputs WHERE source_type='arrears' AND source_id=$1 AND component_code=$2 AND status <> 'cancelled'`, [p.id, cfg.code]);
    if (exists.rows[0]) continue;
    const { rows } = await qx(client, `INSERT INTO tenant.hr_payroll_inputs(organization_id,company_id,employee_id,input_type,category,amount,taxable,description,pay_month,status,requested_by,decided_by,decided_at,source_type,source_id,component_code)
      VALUES ($1,$2,$3,$4,'revision',$5,true,$6,$7,$8,$9,$10,$11,'arrears',$12,$13) RETURNING *`,
      [c.organizationId, c.companyId, e.id, kind, Math.abs(diff), `Pay revision effective ${should.effective_from}: ${p.payroll_number}`, monthStart(today()), diff > 0 ? "approved" : "pending_approval", c.userId, diff > 0 ? c.userId : null, diff > 0 ? new Date().toISOString() : null, p.id, cfg.code]);
    created.push(rows[0]);
  }
  if (created.length) await recordEvent(client, c, "employee", e.id, "hr.arrears.calculated", { count: created.length, total: round2(created.reduce((n, r) => n + (r.input_type === "arrear" ? Number(r.amount) : -Number(r.amount)), 0)) });
  return { employeeId: e.id, created: created.length, arrears: round2(created.filter((r) => r.input_type === "arrear").reduce((n, r) => n + Number(r.amount), 0)), recoveries: round2(created.filter((r) => r.input_type === "recovery").reduce((n, r) => n + Number(r.amount), 0)), inputs: created };
}
COMPENSATION_HOOKS.afterApprove = async ({ client, c, compensation }) => {
  if (String(compensation.effective_from) < today()) await calculateArrears(client, { ...c, permissions: [...(c.permissions ?? []), PREPARE] }, compensation.employee_id);
};

// ---------------------------------------------------------------- hooks into the engine
const line = (l) => l;
registerPayrollHook("earnings", async ({ client, run, employee }) => {
  const monthEnd = String(run.period_end);
  const lines = [];
  const data = { inputs: [], expenses: [] };
  const consumed = { inputIds: [], expenseIds: [] };
  if (run.run_type !== "regular" && run.run_type !== "final_settlement") return { lines, data, consumed };
  const inputs = (await qx(client, `SELECT * FROM tenant.hr_payroll_inputs WHERE employee_id=$1 AND status IN ('approved') AND (payroll_run_id IS NULL OR payroll_run_id=$2) AND pay_month <= $3 AND input_type IN ('bonus','incentive','allowance','arrear','settlement_earning') AND (($4='final_settlement') = (input_type IN ('settlement_earning'))) ORDER BY created_at, id`, [employee.id, run.id, monthEnd, run.run_type])).rows;
  const grouped = new Map();
  for (const i of inputs) {
    const cfg = KIND[i.input_type];
    const cur = grouped.get(cfg.code) ?? { code: cfg.code, name: cfg.name, type: "earning", kind: cfg.kind, amount: 0, taxable: 0 };
    cur.amount += Number(i.amount);
    if (i.taxable) cur.taxable += Number(i.amount);
    grouped.set(cfg.code, cur);
    consumed.inputIds.push(i.id);
    data.inputs.push([i.id, Number(i.amount)]);
  }
  for (const l of grouped.values()) lines.push(line({ ...l, amount: round2(l.amount), taxable: round2(l.taxable) }));
  if (run.run_type === "regular" || run.run_type === "final_settlement") {
    const ex = (await qx(client, `SELECT * FROM tenant.hr_employee_expenses WHERE employee_id=$1 AND status='approved' AND (payroll_run_id IS NULL OR payroll_run_id=$2) AND expense_date <= $3 ORDER BY expense_date, id`, [employee.id, run.id, monthEnd])).rows;
    if (ex.length) {
      const total = round2(ex.reduce((n, x) => n + Number(x.base_amount), 0));
      await ensureSystemComponent(client, { organizationId: employee.organization_id, companyId: employee.company_id, userId: run.created_by }, "REIMBURSEMENT", "Expense reimbursement", "earning", "reimbursement", { taxable: false });
      lines.push(line({ code: "REIMBURSEMENT", name: "Expense reimbursement", type: "earning", kind: "reimbursement", amount: total, taxable: 0 }));
      for (const x of ex) { consumed.expenseIds.push(x.id); data.expenses.push([x.id, Number(x.base_amount)]); }
    }
  }
  return { lines, data, consumed };
});

registerPayrollHook("deductions", async ({ client, run, employee, gross, alreadyDeducted, cfg, exceptions }) => {
  const lines = [];
  const data = { inputs: [], installments: [] };
  const consumed = { inputIds: [], installmentIds: [] };
  const monthEnd = String(run.period_end);
  const isSettlement = run.run_type === "final_settlement";
  // approved deductions and recoveries come off in full
  const inputs = (await qx(client, `SELECT * FROM tenant.hr_payroll_inputs WHERE employee_id=$1 AND status='approved' AND (payroll_run_id IS NULL OR payroll_run_id=$2) AND pay_month <= $3 AND input_type IN ('deduction','recovery','settlement_deduction') AND (($4='final_settlement') = (input_type='settlement_deduction')) ORDER BY created_at, id`, [employee.id, run.id, monthEnd, run.run_type])).rows;
  const grouped = new Map();
  for (const i of inputs) {
    const cfgK = KIND[i.input_type];
    const cur = grouped.get(cfgK.code) ?? { code: cfgK.code, name: cfgK.name, type: "deduction", kind: cfgK.kind, amount: 0, taxable: 0 };
    cur.amount += Number(i.amount);
    grouped.set(cfgK.code, cur);
    consumed.inputIds.push(i.id);
    data.inputs.push([i.id, Number(i.amount)]);
  }
  for (const l of grouped.values()) lines.push(line({ ...l, amount: round2(l.amount) }));
  if (isSettlement) return { lines, data, consumed };
  // loan installments, within the cap on total deductions
  const cap = round2(Number(gross) * (Number(cfg.max_deduction_percent) / 100));
  let room = round2(cap - Number(alreadyDeducted) - lines.reduce((n, l) => n + l.amount, 0));
  const due = (await qx(client, `SELECT i.*, l.loan_number FROM tenant.hr_loan_installments i JOIN tenant.hr_loans l ON l.id=i.loan_id WHERE l.employee_id=$1 AND l.status='active' AND i.status='scheduled' AND (i.payroll_run_id IS NULL OR i.payroll_run_id=$2) AND i.due_month <= $3 ORDER BY i.due_month, i.sequence`, [employee.id, run.id, monthEnd])).rows;
  let total = 0;
  let deferred = 0;
  for (const i of due) {
    if (Number(i.amount) <= room + 0.001) { total = round2(total + Number(i.amount)); room = round2(room - Number(i.amount)); consumed.installmentIds.push(i.id); data.installments.push([i.id, Number(i.amount)]); }
    else deferred += 1;
  }
  if (total > 0) lines.push(line({ code: "LOAN_EMI", name: "Loan / advance recovery", type: "deduction", kind: "loan", amount: total, taxable: 0 }));
  if (deferred > 0) exceptions.push({ code: "LOAN_DEFERRED", severity: "warning", message: `${deferred} loan installment(s) were left for a later payroll because deductions would exceed ${cfg.max_deduction_percent}% of gross.` });
  return { lines, data, consumed };
});

registerPayrollHook("afterPayslip", async ({ client, run, consumed }) => {
  const e = consumed?.earnings;
  const d = consumed?.deductions;
  if (e?.inputIds?.length) await qx(client, `UPDATE tenant.hr_payroll_inputs SET payroll_run_id=$2 WHERE id = ANY($1::uuid[])`, [e.inputIds, run.id]);
  if (e?.expenseIds?.length) await qx(client, `UPDATE tenant.hr_employee_expenses SET payroll_run_id=$2 WHERE id = ANY($1::uuid[])`, [e.expenseIds, run.id]);
  if (d?.inputIds?.length) await qx(client, `UPDATE tenant.hr_payroll_inputs SET payroll_run_id=$2 WHERE id = ANY($1::uuid[])`, [d.inputIds, run.id]);
  if (d?.installmentIds?.length) await qx(client, `UPDATE tenant.hr_loan_installments SET payroll_run_id=$2 WHERE id = ANY($1::uuid[])`, [d.installmentIds, run.id]);
});

registerPayrollHook("afterCancel", async ({ client, run, keepRun }) => {
  await qx(client, `UPDATE tenant.hr_payroll_inputs SET payroll_run_id=NULL, status='approved' WHERE payroll_run_id=$1 AND status IN ('approved','paid')`, [run.id]);
  await qx(client, `UPDATE tenant.hr_employee_expenses SET payroll_run_id=NULL, status='approved', payment_reference=NULL WHERE payroll_run_id=$1 AND status IN ('approved','reimbursed')`, [run.id]);
  await qx(client, `UPDATE tenant.hr_loan_installments SET payroll_run_id=NULL, status='scheduled' WHERE payroll_run_id=$1 AND status IN ('scheduled','deducted')`, [run.id]);
  await qx(client, `UPDATE tenant.hr_loans SET status='active', closed_at=NULL WHERE status='closed' AND id IN (SELECT DISTINCT loan_id FROM tenant.hr_loan_installments WHERE status='scheduled')`);
  void keepRun;
});

registerPayrollHook("afterApprove", async ({ client, run }) => {
  await qx(client, `UPDATE tenant.hr_payroll_inputs SET status='paid' WHERE payroll_run_id=$1 AND status='approved'`, [run.id]);
  await qx(client, `UPDATE tenant.hr_employee_expenses SET status='reimbursed', payment_reference=$2, updated_at=now() WHERE payroll_run_id=$1 AND status='approved'`, [run.id, run.payroll_number]);
  const done = (await qx(client, `UPDATE tenant.hr_loan_installments SET status='deducted' WHERE payroll_run_id=$1 AND status='scheduled' RETURNING loan_id, principal_amount`, [run.id])).rows;
  for (const d of done) await qx(client, `UPDATE tenant.hr_loans SET outstanding_principal=greatest(0, outstanding_principal - $2) WHERE id=$1`, [d.loan_id, d.principal_amount]);
  await qx(client, `UPDATE tenant.hr_loans SET status='closed', closed_at=now(), outstanding_principal=0 WHERE status='active' AND id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM tenant.hr_loan_installments i WHERE i.loan_id=tenant.hr_loans.id AND i.status IN ('scheduled','skipped'))`, [[...new Set(done.map((d) => d.loan_id))]]);
});
void dateOrNull; void uuidOrNull;
