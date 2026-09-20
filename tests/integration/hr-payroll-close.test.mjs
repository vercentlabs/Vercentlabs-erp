// Real PostgreSQL integration test -- final settlement (F433), the bank transfer file (F436),
// posting payroll to accounting (F437) and reconciliation (F438).
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_HR, buildHrWorld, connectAdmin } from "./hr-test-kit.mjs";

const comp = await import("../../services/api/src/modules/hr-payroll/compensation.js");
const pay = await import("../../services/api/src/modules/hr-payroll/payroll.js");
const inp = await import("../../services/api/src/modules/hr-payroll/payroll-inputs.js");
const close = await import("../../services/api/src/modules/hr-payroll/payroll-close.js");
const { initializeAccountingCompany } = await import("../../services/api/src/modules/accounting/foundation.js");

const ROLES = {
  hrA: ALL_HR,
  hrB: ALL_HR,
  viewer: ["hr_payroll.view", "hr_payroll.employee.view"],
  emp: [],
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - b) < 0.02, `${msg}: expected ${b}, got ${a}`);

test("HR final settlement, bank file, accounting posting and reconciliation against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildHrWorld(admin, ROLES, "hrc");
  const { api, run, denied, sql, users, today } = w;
  const ids = {};
  const bank = { accountHolder: "Leaving Employee", accountNumber: "555566667777", ifsc: "ICIC0001234", bankName: "ICICI" };

  try {
    await run("hrA", (c, x) => api.saveHrSettings(c, x, { requireDocumentsForJoining: false, notice_recovery: true }));
    await sql(`UPDATE tenant.hr_payroll_settings SET notice_recovery=true WHERE organization_id=$1`, [w.orgId]);
    const comp1 = await run("hrA", (c, x) => comp.saveSalaryComponent(c, x, { code: "BASIC3", name: "Basic", componentType: "earning" }));
    const structure = await run("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "FS", name: "Simple", lines: [{ componentCode: comp1.code, isBalance: true }] }));
    await run("hrA", (c, x) => comp.submitSalaryStructure(c, x, structure.id));
    await run("hrB", (c, x) => comp.decideSalaryStructure(c, x, structure.id, { approve: true }));

    const leaveType = await run("hrA", (c, x) => api.saveLeaveType(c, x, { code: "ENC", name: "Encashable leave", paid: true, encashmentAllowed: true }));
    const employee = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: "Leaving", lastName: "Employee", workEmail: "leaving@co.test", employmentType: "permanent", joiningDate: "2024-01-06", bankDetails: bank, userId: users.emp, noticePeriodDays: 5 }));
    await run("hrA", (c, x) => api.completeJoining(c, x, employee.id));
    ids.employee = employee.id;
    const k = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: employee.id, structureId: structure.id, annualCtc: 1200000, effectiveFrom: "2024-01-06" }));
    await run("hrB", (c, x) => comp.decideCompensation(c, x, k.id, { approve: true }));
    // an unpaid leave balance to encash, and a loan to be recovered in full
    await run("hrA", (c, x) => api.adjustLeaveBalance(c, x, { employeeId: employee.id, leaveTypeId: leaveType.id, days: 10, note: "Opening balance" }));
    const loan = await run("emp", (c, x) => inp.requestLoan(c, x, { loanType: "advance", principal: 12000, installments: 4, firstDeductionMonth: today.slice(0, 7) + "-01" }));
    await run("hrB", (c, x) => inp.decideLoan(c, x, loan.id, { approve: true }));
    ids.loan = loan.id;
    // an approved, unpaid bonus that should fold into the settlement
    const bonus = await run("hrA", (c, x) => inp.createPayrollInput(c, x, { employeeId: employee.id, inputType: "bonus", amount: 4000, payMonth: today, description: "Farewell bonus" }));
    await run("hrB", (c, x) => inp.decidePayrollInput(c, x, bonus.id, { approve: true }));
    ids.bonus = bonus.id;

    await t.test("F394/F433: separation with short notice, then a final settlement is calculated with encashment, notice recovery, the loan and the bonus", async () => {
      const sep = await run("emp", (c, x) => api.initiateSeparation(c, x, { separationType: "resignation", reason: "New opportunity", noticeDate: today }));
      // accepted with a last working day earlier than the full notice period -> a shortfall to recover
      const lwd = today;
      await run("hrA", (c, x) => api.decideSeparation(c, x, sep.id, { approve: true, lastWorkingDay: lwd }));
      const tasks = await run("hrA", (c, x) => api.listLifecycleTasks(c, x, { employeeId: employee.id, kind: "offboarding" }));
      for (const tk of tasks) await run("hrA", (c, x) => api.completeLifecycleTask(c, x, tk.id, { note: "done" }));
      await run("hrA", (c, x) => api.completeSeparation(c, x, sep.id));
      assert.equal((await sql(`SELECT status FROM tenant.hr_employees WHERE id=$1`, [employee.id]))[0].status, "separated");

      await denied("viewer", (c, x) => close.calculateFinalSettlement(c, x, employee.id), 403);
      const settlement = await run("hrA", (c, x) => close.calculateFinalSettlement(c, x, employee.id));
      ids.settlement = settlement.id;
      assert.equal(settlement.status, "draft");
      const codes = settlement.lines.map((l) => l.code);
      assert.ok(codes.includes("LEAVE_ENCASH"));
      assert.ok(codes.includes("NOTICE_RECOVERY"), "the notice period was not fully served");
      assert.ok(codes.includes("LOAN_RECOVERY"));
      assert.ok(codes.includes("BONUS"));
      near(settlement.total_earnings, Math.round((100000 / 30) * 100) / 100 * 10 + 4000, "10 days' encashment at the daily rate, plus the bonus");
      near(settlement.total_recoveries, 12000 + Number(settlement.lines.find((l) => l.code === "NOTICE_RECOVERY").amount), "the loan plus the notice shortfall");
      // the bonus that fed into the settlement is withdrawn from the ordinary queue
      assert.equal((await sql(`SELECT status FROM tenant.hr_payroll_inputs WHERE id=$1`, [ids.bonus]))[0].status, "cancelled");
      await denied("hrA", (c, x) => close.calculateFinalSettlement(c, x, employee.id), 409, "HR_SETTLEMENT_OPEN");
    });

    await t.test("F433: the settlement is approved by someone else, never by the employee, then paid through a real payroll", async () => {
      await run("hrA", (c, x) => close.submitFinalSettlement(c, x, ids.settlement));
      await denied("hrA", (c, x) => close.decideFinalSettlement(c, x, ids.settlement, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await denied("hrB", (c, x) => close.decideFinalSettlement(c, x, ids.settlement, { approve: false }), 400, "HR_REASON_REQUIRED");
      const approved = await run("hrB", (c, x) => close.decideFinalSettlement(c, x, ids.settlement, { approve: true, note: "Checked" }));
      assert.equal(approved.status, "approved");
      const { settlement, payrollRunId } = await run("hrA", (c, x) => close.paySettlement(c, x, ids.settlement));
      assert.equal(settlement.status, "paid");
      ids.run = payrollRunId;
      const slips = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: payrollRunId }));
      assert.equal(slips.length, 1);
      const slip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips[0].id));
      near(Number(slip.gross_pay), Number(settlement.total_earnings), "settlement earnings become the payslip's gross");
      near(Number(slip.net_pay), Number(settlement.net_amount), "settlement net matches the payslip's net");
      // the loan is closed and its remaining schedule waived; the leave balance is used up
      assert.equal((await sql(`SELECT status, outstanding_principal FROM tenant.hr_loans WHERE id=$1`, [ids.loan]))[0].status, "closed");
      const bal = (await sql(`SELECT closing_balance FROM tenant.hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2`, [employee.id, leaveType.id]))[0];
      near(Number(bal.closing_balance), 0, "the encashed leave is used up");
      // paySettlement already submitted the run for approval
      await run("hrB", (c, x) => pay.decidePayrollRun(c, x, payrollRunId, { approve: true }));
    });

    await t.test("F436: a bank transfer file lists the beneficiary, is generated once, and is acknowledged with a UTR", async () => {
      await denied("viewer", (c, x) => close.generateBankFile(c, x, ids.run), 403);
      const file = await run("hrA", (c, x) => close.generateBankFile(c, x, ids.run));
      assert.equal(file.record_count, 1);
      near(Number(file.total_amount), Number((await run("hrA", (c, x) => pay.getPayrollRun(c, x, ids.run))).net_pay), "the file totals the run's net pay");
      assert.match(file.checksum, /^[0-9a-f]{64}$/);
      ids.bankFile = file.id;
      await denied("hrA", (c, x) => close.generateBankFile(c, x, ids.run), 409, "HR_BANK_FILE_EXISTS");
      const full = await run("hrA", (c, x) => close.getBankFile(c, x, file.id));
      assert.match(full.content, /555566667777/);
      assert.match(full.content, /ICIC0001234/);
      await denied("hrA", (c, x) => close.acknowledgeBankFile(c, x, file.id, ""), 400, "HR_REASON_REQUIRED");
      const ack = await run("hrA", (c, x) => close.acknowledgeBankFile(c, x, file.id, "UTR123456"));
      assert.equal(ack.status, "acknowledged");
      await denied("hrA", (c, x) => close.acknowledgeBankFile(c, x, file.id, "AGAIN"), 409, "HR_BANK_FILE_STATE");
    });

    await t.test("F437: posting to accounting is refused until the accounts are configured, then posts a balanced journal", async () => {
      await denied("hrA", (c, x) => close.postPayrollToAccounting(c, x, ids.run), 409, "HR_ACCOUNTING_NOT_CONFIGURED");
      await admin.query("BEGIN");
      await admin.query(`SELECT set_config('app.current_organization_id', $1, true)`, [w.orgId]);
      await admin.query(`INSERT INTO public.numbering_series(organization_id,entity_type,prefix) VALUES ($1,'journal_entry','JE-') ON CONFLICT DO NOTHING`, [w.orgId]);
      await admin.query(`INSERT INTO tenant.fiscal_periods(organization_id,company_id,name,fiscal_year,start_date,end_date,status) VALUES ($1,$2,'FY Current','FY-CURRENT',date_trunc('year',current_date)::date,(date_trunc('year',current_date)+interval '1 year - 1 day')::date,'open') ON CONFLICT DO NOTHING`, [w.orgId, w.companyId]);
      await initializeAccountingCompany(admin, { organizationId: w.orgId, companyId: w.companyId, userId: users.hrA });
      const ledger = (await admin.query(`SELECT id FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2`, [w.orgId, w.companyId])).rows[0];
      const expense = (await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='6200'`, [w.orgId, w.companyId, ledger.id])).rows[0];
      const payable = (await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='2400'`, [w.orgId, w.companyId, ledger.id])).rows[0];
      const statutory = (await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='2300'`, [w.orgId, w.companyId, ledger.id])).rows[0];
      await admin.query(`UPDATE tenant.hr_payroll_settings SET salary_expense_account_id=$2, salary_payable_account_id=$3, statutory_payable_account_id=$4 WHERE organization_id=$1`, [w.orgId, expense.id, payable.id, statutory.id]);
      await admin.query("COMMIT");

      await denied("viewer", (c, x) => close.postPayrollToAccounting(c, x, ids.run), 403);
      const posted = await run("hrA", (c, x) => close.postPayrollToAccounting(c, x, ids.run));
      assert.equal(posted.run.status, "posted");
      assert.ok(posted.journalEntryId);
      await denied("hrA", (c, x) => close.postPayrollToAccounting(c, x, ids.run), 409, "HR_RUN_ALREADY_POSTED");
      const [je] = await sql(`SELECT status FROM tenant.accounting_journal_entries WHERE id=$1`, [posted.journalEntryId]);
      assert.equal(je.status, "posted");
      const lines = await sql(`SELECT debit_amount, credit_amount, account_id FROM tenant.accounting_journal_lines WHERE journal_entry_id=$1`, [posted.journalEntryId]);
      const totalDebit = lines.reduce((n, l) => n + Number(l.debit_amount), 0);
      const totalCredit = lines.reduce((n, l) => n + Number(l.credit_amount), 0);
      near(totalDebit, totalCredit, "the journal balances");
      const [slipRun] = await sql(`SELECT gross_pay, net_pay FROM tenant.hr_payroll_runs WHERE id=$1`, [ids.run]);
      near(totalDebit, Number(slipRun.gross_pay), "the debit equals the settlement's gross pay");
    });

    await t.test("F438: reconciliation ties the payslips, the bank file and the journal together", async () => {
      await denied("viewer", (c, x) => close.getPayrollReconciliation(c, x, ids.run), 403);
      const rec = await run("hrA", (c, x) => close.getPayrollReconciliation(c, x, ids.run));
      assert.equal(rec.reconciled, true, JSON.stringify(rec.checks, null, 2));
      assert.equal(rec.bankFile.file_number, (await run("hrA", (c, x) => close.getBankFile(c, x, ids.bankFile))).file_number);
      assert.ok(rec.journal);
      near(rec.journal.debit, rec.journal.credit, "the journal ties out");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
