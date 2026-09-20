// Real PostgreSQL integration test -- payroll inputs (F428-F432): bonus/incentive/deduction
// adjustments with maker-checker, bulk creation, expense categories and claims with manager
// approval, loans/advances with an EMI schedule, cap on total deductions, prepayment, and arrears
// from a backdated pay revision -- each consumed by the payroll engine exactly once.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_HR, buildHrWorld, connectAdmin } from "./hr-test-kit.mjs";

const comp = await import("../../services/api/src/modules/hr-payroll/compensation.js");
const pay = await import("../../services/api/src/modules/hr-payroll/payroll.js");
const inp = await import("../../services/api/src/modules/hr-payroll/payroll-inputs.js");

const ROLES = {
  hrA: ALL_HR,
  hrB: ALL_HR,
  mgr: [],
  emp: [],
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const close = (a, b, msg) => assert.ok(Math.abs(Number(a) - b) < 0.02, `${msg}: expected ${b}, got ${a}`);

test("HR payroll inputs against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildHrWorld(admin, ROLES, "hri");
  const { api, run, denied, sql, users, today } = w;
  const t0 = new Date(`${today}T00:00:00Z`);
  const pm = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() - 1, 1));
  const start = pm.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const D = Number(end.slice(8, 10));
  const code = start.slice(0, 7);
  const ids = {};
  const bank = { accountHolder: "Test", accountNumber: "111122223333", ifsc: "HDFC0001234", bankName: "HDFC" };
  const fullAttendance = (emp, from, to) => sql(`INSERT INTO tenant.hr_attendance(organization_id,company_id,employee_id,attendance_date,status,source,created_by) SELECT $1,$2,$3,d::date,'present','system',$4 FROM generate_series($5::date,$6::date,'1 day') d WHERE extract(isodow FROM d) BETWEEN 1 AND 5 ON CONFLICT DO NOTHING`, [w.orgId, w.companyId, emp, users.hrA, from, to]);

  try {
    await run("hrA", (c, x) => api.saveHrSettings(c, x, { requireDocumentsForJoining: false }));
    const st = await run("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "PI", name: "Simple", lines: [{ componentCode: "BASIC2", isBalance: true }] }).catch(() => null));
    // components need creating first
    await run("hrA", (c, x) => comp.saveSalaryComponent(c, x, { code: "BASIC2", name: "Basic", componentType: "earning" }));
    const s = st ?? (await run("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "PI", name: "Simple", lines: [{ componentCode: "BASIC2", isBalance: true }] })));
    await run("hrA", (c, x) => comp.submitSalaryStructure(c, x, s.id));
    await run("hrB", (c, x) => comp.decideSalaryStructure(c, x, s.id, { approve: true }));

    const mk = async (first, email, userId, managerId) => {
      const e = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: first, lastName: "I", workEmail: email, employmentType: "permanent", joiningDate: "2025-01-06", bankDetails: bank, pan: undefined, userId, managerEmployeeId: managerId }));
      await run("hrA", (c, x) => api.completeJoining(c, x, e.id));
      return e;
    };
    ids.mgr = (await mk("Ravi", "ravi@co.test", users.mgr)).id;
    ids.e1 = (await mk("Nisha", "nisha@co.test", users.emp, ids.mgr)).id;
    const k = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: s.id, annualCtc: 1200000, effectiveFrom: "2025-01-06" }));
    await run("hrB", (c, x) => comp.decideCompensation(c, x, k.id, { approve: true }));
    const km = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.mgr, structureId: s.id, annualCtc: 1200000, effectiveFrom: "2025-01-06" }));
    await run("hrB", (c, x) => comp.decideCompensation(c, x, km.id, { approve: true }));
    await fullAttendance(ids.e1, start, end);
    await fullAttendance(ids.mgr, start, end);

    await t.test("F428/F429: bonus/incentive/deduction inputs need maker-checker; a locked month is refused", async () => {
      await denied("hrA", (c, x) => inp.createPayrollInput(c, x, { employeeId: ids.e1, inputType: "bonus", amount: 5000, payMonth: start }), 400, "HR_INPUT_INVALID");
      const b = await run("hrA", (c, x) => inp.createPayrollInput(c, x, { employeeId: ids.e1, inputType: "bonus", amount: 5000, payMonth: start, description: "Diwali bonus" }));
      assert.equal(b.status, "pending_approval");
      await denied("hrA", (c, x) => inp.decidePayrollInput(c, x, b.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await denied("hrB", (c, x) => inp.decidePayrollInput(c, x, b.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      const ok = await run("hrB", (c, x) => inp.decidePayrollInput(c, x, b.id, { approve: true }));
      assert.equal(ok.status, "approved");
      ids.bonus = ok.id;
      const ded = await run("hrA", (c, x) => inp.createPayrollInput(c, x, { employeeId: ids.e1, inputType: "deduction", amount: 1000, payMonth: start, description: "Uniform cost" }));
      await run("hrB", (c, x) => inp.decidePayrollInput(c, x, ded.id, { approve: true }));
      ids.ded = ded.id;
      const listed = await run("hrA", (c, x) => inp.listPayrollInputs(c, x, { status: "approved" }));
      assert.ok(listed.some((r) => r.id === ids.bonus));
      const cancel = await run("hrA", (c, x) => inp.createPayrollInput(c, x, { employeeId: ids.e1, inputType: "incentive", amount: 200, payMonth: start, description: "x" }));
      await denied("hrA", (c, x) => inp.cancelPayrollInput(c, x, cancel.id, ""), 400, "HR_REASON_REQUIRED");
      assert.equal((await run("hrA", (c, x) => inp.cancelPayrollInput(c, x, cancel.id, "duplicate"))).status, "cancelled");
    });

    await t.test("F429: many incentives at once, keyed by employee number; a bad row does not stop the good ones", async () => {
      const empNumber = (await sql(`SELECT employee_number FROM tenant.hr_employees WHERE id=$1`, [ids.e1]))[0].employee_number;
      const bulk = await run("hrA", (c, x) => inp.bulkCreatePayrollInputs(c, x, { inputType: "incentive", payMonth: start, description: "Sales incentive", rows: [{ employeeNumber: empNumber, amount: 3000 }, { employeeNumber: "NOPE-999", amount: 500 }] }));
      assert.equal(bulk.created, 1);
      assert.equal(bulk.failed, 1);
      assert.equal(bulk.results[1].ok, false);
      ids.incentiveRows = bulk.results.filter((r) => r.ok).map((r) => r.id);
      for (const id of ids.incentiveRows) await run("hrB", (c, x) => inp.decidePayrollInput(c, x, id, { approve: true }));
    });

    await t.test("F430: expense categories, a claim within limit, receipt required above a threshold, manager approval (never self)", async () => {
      const cat = await run("hrA", (c, x) => inp.saveExpenseCategory(c, x, { code: "TRVL", name: "Travel", monthlyLimit: 10000, receiptRequiredAbove: 2000 }));
      await denied("emp", (c, x) => inp.saveExpense(c, x, { categoryId: cat.id, amount: 3000, expenseDate: today }), 400, "HR_EXPENSE_RECEIPT");
      const claim = await run("emp", (c, x) => inp.saveExpense(c, x, { categoryId: cat.id, amount: 1500, expenseDate: end, description: "Cab fare" }));
      assert.equal(claim.status, "submitted");
      await denied("emp", (c, x) => inp.saveExpense(c, x, { categoryId: cat.id, amount: 9000, expenseDate: end, receiptReference: "ref-1" }), 409, "HR_EXPENSE_LIMIT");
      await denied("emp", (c, x) => inp.decideExpense(c, x, claim.id, { approve: true }), 403);
      await denied("mgr", (c, x) => inp.decideExpense(c, x, claim.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      const approved = await run("mgr", (c, x) => inp.decideExpense(c, x, claim.id, { approve: true }));
      assert.equal(approved.status, "approved");
      ids.claim = claim.id;
      const mine = await run("emp", (c, x) => inp.listExpenses(c, x, { scope: "mine" }));
      assert.ok(mine.some((r) => r.id === claim.id));
      await denied("emp", (c, x) => inp.listExpenses(c, x, {}), 403);
    });

    await t.test("F431: a loan is capped at a multiple of monthly gross, scheduled with EMIs, approved by someone else, never by the borrower", async () => {
      await denied("emp", (c, x) => inp.requestLoan(c, x, { loanType: "advance", principal: 900000, installments: 10, firstDeductionMonth: start }), 409, "HR_LOAN_LIMIT");
      const loan = await run("emp", (c, x) => inp.requestLoan(c, x, { loanType: "advance", principal: 60000, interestRate: 12, installments: 6, firstDeductionMonth: start }));
      assert.equal(loan.schedule.length, 6);
      close(loan.schedule.reduce((n, r) => n + r.principal, 0), 60000, "installments sum to the principal");
      ids.loan = loan.id;
      await denied("emp", (c, x) => inp.requestLoan(c, x, { loanType: "advance", principal: 5000, installments: 2, firstDeductionMonth: start }), 409, "HR_LOAN_OPEN");
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.e1, users.hrB]);
      await denied("hrB", (c, x) => inp.decideLoan(c, x, loan.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.e1, users.emp]);
      await denied("hrB", (c, x) => inp.decideLoan(c, x, loan.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      const active = await run("hrB", (c, x) => inp.decideLoan(c, x, loan.id, { approve: true }));
      assert.equal(active.status, "active");
      // skip the first installment: it moves to the end
      const full = await run("hrA", (c, x) => inp.getLoan(c, x, loan.id));
      // skip a later installment (not the first, which the payroll test below needs to still be due)
      const skip = await run("hrA", (c, x) => inp.skipLoanInstallment(c, x, full.schedule[1].id, "Employee on unpaid leave that month"));
      assert.equal(skip.schedule.length, 7, "a skipped installment is rescheduled at the end");
      assert.equal(skip.schedule.filter((r) => r.status === "skipped").length, 1);
    });

    await t.test("F424-F432: the payroll picks up approved bonus, deduction, incentives, the reimbursement and the loan EMI, each exactly once", async () => {
      const period = (await run("hrA", (c, x) => pay.generatePayrollPeriods(c, x, { year: Number(start.slice(0, 4)) })), (await run("hrA", (c, x) => pay.listPayrollPeriods(c, x, { year: Number(start.slice(0, 4)) }))).find((p) => p.period_code === code));
      const r = await run("hrA", (c, x) => pay.startPayrollRun(c, x, { periodId: period.id }));
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, r.id));
      const slips = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: r.id, employeeId: ids.e1 }));
      const full = await run("hrA", (c, x) => pay.getPayslip(c, x, slips[0].id));
      const get = (code2) => Number(full.lines.find((l) => l.component_code === code2)?.amount ?? 0);
      close(get("BONUS"), 5000, "bonus");
      close(get("INCENTIVE"), 3000, "the one good bulk incentive row");
      close(get("ADHOC_DED"), 1000, "the uniform deduction");
      close(get("REIMBURSEMENT"), 1500, "the approved travel claim");
      const emi = full.lines.find((l) => l.component_code === "LOAN_EMI");
      assert.ok(emi && Number(emi.amount) > 0, "the first (unskipped) loan installment is deducted");
      close(full.gross_pay, 100000 + 5000 + 3000 + 1500, "gross includes bonus, incentive and the non-taxable reimbursement");
      // recalculating does not double the one-off items
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, r.id));
      const rerun = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: r.id, employeeId: ids.e1 }));
      const again = await run("hrA", (c, x) => pay.getPayslip(c, x, rerun[0].id));
      close(Number(again.lines.find((l) => l.component_code === "BONUS").amount), 5000, "still exactly once after recalculation");
      await denied("hrA", (c, x) => inp.cancelPayrollInput(c, x, ids.bonus, "changed my mind"), 409, "HR_INPUT_STATE"); // already picked up by a run
      ids.run = r.id;
      // approving pays the bonus/incentive/deduction, reimburses the expense, and deducts the loan installment
      await run("hrA", (c, x) => pay.submitPayrollRun(c, x, r.id));
      await run("hrB", (c, x) => pay.decidePayrollRun(c, x, r.id, { approve: true }));
      assert.equal((await sql(`SELECT status FROM tenant.hr_payroll_inputs WHERE id=$1`, [ids.bonus]))[0].status, "paid");
      assert.equal((await sql(`SELECT status FROM tenant.hr_employee_expenses WHERE id=$1`, [ids.claim]))[0].status, "reimbursed");
      const [inst] = await sql(`SELECT status FROM tenant.hr_loan_installments WHERE loan_id=$1 ORDER BY sequence LIMIT 1`, [ids.loan]);
      assert.ok(["skipped", "deducted"].includes(inst.status));
    });

    await t.test("F432: a backdated pay rise creates an arrear for the already-approved payslip", async () => {
      // give the employee a second, later month of approved pay so a backdated revision has something to compare
      const rise = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: s.id, annualCtc: 1800000, effectiveFrom: start }));
      const decided = await run("hrB", (c, x) => comp.decideCompensation(c, x, rise.id, { approve: true }));
      void decided;
      const inputs = await run("hrA", (c, x) => inp.listPayrollInputs(c, x, { type: "arrear" }));
      const mine = inputs.find((r) => r.employee_id === ids.e1 && r.source_type === "arrears");
      assert.ok(mine, "an arrear was raised for the payslip already approved under the old pay");
      assert.equal(mine.status, "approved", "arrears in the employee's favour need no approval");
      close(Number(mine.amount), 50000, "the difference between the old and new monthly gross");
    });
    await t.test("F431: prepaying a loan reduces or closes it; cancelling the payroll returns everything to its prior state", async () => {
      const before = await run("hrA", (c, x) => inp.getLoan(c, x, ids.loan));
      const outstanding = Number(before.outstanding_principal);
      const prepaid = await run("hrA", (c, x) => inp.prepayLoan(c, x, ids.loan, { amount: outstanding }));
      assert.equal(prepaid.status, "closed");
      close(prepaid.outstanding_principal, 0, "fully prepaid");
      // cancelling the payroll releases the inputs, the reimbursement and the loan deduction
      await run("hrB", (c, x) => pay.cancelPayroll(c, x, ids.run, "Recheck bonus figures"));
      assert.equal((await sql(`SELECT status FROM tenant.hr_payroll_inputs WHERE id=$1`, [ids.bonus]))[0].status, "approved");
      assert.equal((await sql(`SELECT status FROM tenant.hr_employee_expenses WHERE id=$1`, [ids.claim]))[0].status, "approved");
    });

  } finally {
    await w.cleanup();
    await admin.end();
  }
});
