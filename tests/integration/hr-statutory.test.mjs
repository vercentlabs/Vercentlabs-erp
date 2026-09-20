// Real PostgreSQL integration test -- statutory compliance (F439-F447): PF, ESIC, professional tax
// (slab), TDS (slab, simplified), labour welfare fund, each configured (not hard-coded) and picked up
// by the payroll engine automatically; gratuity on a final settlement; and the statutory/compliance
// reports.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_HR, buildHrWorld, connectAdmin } from "./hr-test-kit.mjs";

const comp = await import("../../services/api/src/modules/hr-payroll/compensation.js");
const pay = await import("../../services/api/src/modules/hr-payroll/payroll.js");
const close = await import("../../services/api/src/modules/hr-payroll/payroll-close.js");
const stat = await import("../../services/api/src/modules/hr-payroll/statutory.js");

const ROLES = {
  hrA: ALL_HR,
  hrB: ALL_HR,
  viewer: ["hr_payroll.view", "hr_payroll.employee.view"],
};
const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - b) < 0.02, `${msg}: expected ${b}, got ${a}`);

test("HR statutory compliance against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildHrWorld(admin, ROLES, "hrs");
  const { api, run, denied, sql, users, today } = w;
  const t0 = new Date(`${today}T00:00:00Z`);
  const pm = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() - 1, 1));
  const start = pm.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const code = start.slice(0, 7);
  const ids = {};
  const fullAttendance = (emp) => sql(`INSERT INTO tenant.hr_attendance(organization_id,company_id,employee_id,attendance_date,status,source,created_by) SELECT $1,$2,$3,d::date,'present','system',$4 FROM generate_series($5::date,$6::date,'1 day') d WHERE extract(isodow FROM d) BETWEEN 1 AND 5 ON CONFLICT DO NOTHING`, [w.orgId, w.companyId, emp, users.hrA, start, end]);

  try {
    await run("hrA", (c, x) => api.saveHrSettings(c, x, { requireDocumentsForJoining: false }));
    const basic = await run("hrA", (c, x) => comp.saveSalaryComponent(c, x, { code: "BASICS", name: "Basic", componentType: "earning", componentKind: "basic", pfWage: true }));
    const special = await run("hrA", (c, x) => comp.saveSalaryComponent(c, x, { code: "SPECIALS", name: "Special", componentType: "earning" }));
    const structure = await run("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "STAT", name: "Statutory test", lines: [{ componentCode: basic.code, percentage: 60 }, { componentCode: special.code, isBalance: true }] }));
    await run("hrA", (c, x) => comp.submitSalaryStructure(c, x, structure.id));
    await run("hrB", (c, x) => comp.decideSalaryStructure(c, x, structure.id, { approve: true }));

    // low earner: basic wage stays under the PF/ESIC ceilings we configure below
    const recentJoin = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10); // just over a year: not gratuity-eligible
    const low = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: "Low", lastName: "Earner", workEmail: "low@co.test", employmentType: "permanent", joiningDate: recentJoin, pan: "ABCDE1234F" }));
    await run("hrA", (c, x) => api.completeJoining(c, x, low.id));
    await sql(`UPDATE tenant.hr_employees SET address='{"state":"Maharashtra"}'::jsonb WHERE id=$1`, [low.id]);
    const k1 = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: low.id, structureId: structure.id, annualCtc: 180000, effectiveFrom: recentJoin }));
    await run("hrB", (c, x) => comp.decideCompensation(c, x, k1.id, { approve: true }));
    // high earner: above both ceilings, and with enough annual income to owe TDS
    const high = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: "High", lastName: "Earner", workEmail: "high@co.test", employmentType: "permanent", joiningDate: "2018-01-06", pan: "PQRSX9876K" }));
    await run("hrA", (c, x) => api.completeJoining(c, x, high.id));
    await sql(`UPDATE tenant.hr_employees SET address='{"state":"Maharashtra"}'::jsonb WHERE id=$1`, [high.id]);
    const k2 = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: high.id, structureId: structure.id, annualCtc: 2400000, effectiveFrom: "2018-01-06" }));
    await run("hrB", (c, x) => comp.decideCompensation(c, x, k2.id, { approve: true }));
    ids.low = low.id;
    ids.high = high.id;
    await fullAttendance(low.id);
    await fullAttendance(high.id);

    await t.test("F439/F440: PF and ESIC are configured (not hard-coded), wage-ceilinged, and apply only below the ESIC ceiling", async () => {
      await denied("viewer", (c, x) => stat.saveStatutoryComponent(c, x, { code: "X", name: "X", statutoryType: "pf", employeeRate: 12, employerRate: 12, effectiveFrom: "2020-01-01" }), 403);
      await denied("hrA", (c, x) => stat.saveStatutoryComponent(c, x, { code: "BADPF", name: "Bad", statutoryType: "pf" }), 400, "HR_STATUTORY_INVALID");
      const pf = await run("hrA", (c, x) => stat.saveStatutoryComponent(c, x, { code: "PF", name: "Provident Fund", statutoryType: "pf", calculationBasis: "percentage_of_wage", wageBasis: "pf_wage", employeeRate: 12, employerRate: 12, wageCeiling: 15000, effectiveFrom: "2020-01-01", dueDay: 15 }));
      const esic = await run("hrA", (c, x) => stat.saveStatutoryComponent(c, x, { code: "ESIC", name: "ESIC", statutoryType: "esi", calculationBasis: "percentage_of_wage", wageBasis: "esic_wage", employeeRate: 0.75, employerRate: 3.25, wageCeiling: 21000, effectiveFrom: "2020-01-01", dueDay: 15 }));
      ids.pf = pf.id;
      ids.esic = esic.id;
      const listed = await run("hrA", (c, x) => stat.listStatutoryComponents(c, x, {}));
      assert.equal(listed.filter((r) => r.statutory_type === "pf").length, 1);

      const period = (await run("hrA", (c, x) => pay.generatePayrollPeriods(c, x, { year: Number(start.slice(0, 4)) })), (await run("hrA", (c, x) => pay.listPayrollPeriods(c, x, { year: Number(start.slice(0, 4)) }))).find((p) => p.period_code === code));
      const runRow = await run("hrA", (c, x) => pay.startPayrollRun(c, x, { periodId: period.id }));
      ids.run = runRow.id;
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, runRow.id));
      const slips = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: runRow.id }));
      const lowSlip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips.find((s) => s.employee_id === ids.low).id));
      const highSlip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips.find((s) => s.employee_id === ids.high).id));
      const get = (slip, code2) => Number(slip.lines.find((l) => l.component_code === code2)?.amount ?? 0);
      const getEmployer = (slip, code2) => Number(slip.lines.find((l) => l.component_code === code2)?.employer_amount ?? 0);
      // low earner: basic = 60% of 15000 = 9000, under the 15000 PF ceiling -> PF on the actual wage
      near(get(lowSlip, "PF_EE"), 9000 * 0.12, "low earner's PF is on the actual (sub-ceiling) basic");
      near(getEmployer(lowSlip, "PF_ER"), 9000 * 0.12, "matching employer PF");
      // low earner's gross (15000) is under the ESIC ceiling (21000) -> ESIC applies
      near(get(lowSlip, "ESIC_EE"), 15000 * 0.0075, "ESIC on the low earner's full gross");
      // high earner: basic = 60% of 200000 = 120000, capped at the 15000 PF ceiling
      near(get(highSlip, "PF_EE"), 15000 * 0.12, "the high earner's PF is capped at the wage ceiling");
      // high earner's gross (200000) is far above the ESIC ceiling -> no ESIC at all
      assert.equal(get(highSlip, "ESIC_EE"), 0, "no ESIC above the wage ceiling");
      assert.equal(getEmployer(highSlip, "ESIC_ER"), 0);
    });

    await t.test("F441/F446: professional tax is a state-configured slab, matched by which bracket the salary falls in", async () => {
      const pt = await run("hrA", (c, x) => stat.saveStatutoryComponent(c, x, { code: "PT-MH", name: "Professional Tax", statutoryType: "professional_tax", calculationBasis: "slab", wageBasis: "gross", state: "Maharashtra", effectiveFrom: "2020-01-01", dueDay: 20 }));
      await run("hrA", (c, x) => stat.setStatutorySlab(c, x, { statutoryComponentId: pt.id, sequence: 1, fromAmount: 0, toAmount: 7500, flatAmount: 0 }));
      await run("hrA", (c, x) => stat.setStatutorySlab(c, x, { statutoryComponentId: pt.id, sequence: 2, fromAmount: 7500, toAmount: 10000, flatAmount: 175 }));
      await run("hrA", (c, x) => stat.setStatutorySlab(c, x, { statutoryComponentId: pt.id, sequence: 3, fromAmount: 10000, toAmount: null, flatAmount: 200 }));
      const again = await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      assert.equal(again.status, "calculated");
      const slips = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run }));
      const lowSlip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips.find((s) => s.employee_id === ids.low).id));
      const highSlip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips.find((s) => s.employee_id === ids.high).id));
      const get = (slip, code2) => Number(slip.lines.find((l) => l.component_code === code2)?.amount ?? 0);
      near(get(lowSlip, "PT"), 200, "the low earner's gross (15000) falls in the top slab");
      near(get(highSlip, "PT"), 200, "the high earner is in the top slab too");
      // an employee outside Maharashtra is unaffected
      const other = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: "Other", lastName: "State", workEmail: "other@co.test", employmentType: "permanent", joiningDate: "2020-01-06" }));
      await run("hrA", (c, x) => api.completeJoining(c, x, other.id));
      await sql(`UPDATE tenant.hr_employees SET address='{"state":"Kerala"}'::jsonb WHERE id=$1`, [other.id]);
      const k3 = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: other.id, structureId: structure.id, annualCtc: 180000, effectiveFrom: "2020-01-06" }));
      await run("hrB", (c, x) => comp.decideCompensation(c, x, k3.id, { approve: true }));
      await fullAttendance(other.id);
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      const slips2 = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run }));
      const otherSlip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips2.find((s) => s.employee_id === other.id).id));
      assert.equal(get(otherSlip, "PT"), 0, "professional tax is scoped to the state it is configured for");
    });

    await t.test("F442: a simplified TDS slab is computed on annualised taxable gross; the low earner owes nothing, the high earner does", async () => {
      const tds = await run("hrA", (c, x) => stat.saveStatutoryComponent(c, x, { code: "TDS", name: "Income tax (TDS)", statutoryType: "tds", calculationBasis: "slab", wageBasis: "gross", effectiveFrom: "2020-01-01", dueDay: 7 }));
      await run("hrA", (c, x) => stat.setStatutorySlab(c, x, { statutoryComponentId: tds.id, sequence: 1, fromAmount: 0, toAmount: 300000, flatAmount: 0, ratePercent: 0 }));
      await run("hrA", (c, x) => stat.setStatutorySlab(c, x, { statutoryComponentId: tds.id, sequence: 2, fromAmount: 300000, toAmount: 700000, flatAmount: 0, ratePercent: 5 }));
      await run("hrA", (c, x) => stat.setStatutorySlab(c, x, { statutoryComponentId: tds.id, sequence: 3, fromAmount: 700000, toAmount: null, flatAmount: 0, ratePercent: 10 }));
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      const slips = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run }));
      const lowSlip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips.find((s) => s.employee_id === ids.low).id));
      const highSlip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips.find((s) => s.employee_id === ids.high).id));
      const get = (slip, code2) => Number(slip.lines.find((l) => l.component_code === code2)?.amount ?? 0);
      assert.equal(get(lowSlip, "TDS"), 0, "annual income of 180000 is under the nil slab");
      // high earner: annualised taxable gross ~2,400,000; marginal slabs: 3-7L@5%=20000, >7L@10% of 1,700,000=170000 -> annual 190000, monthly 15833.33
      near(get(highSlip, "TDS"), 190000 / 12, "the marginal slab total, divided across the year");
      // no PAN on file -> TDS is not computed (a real compliance flag, not silently zero-taxed)
      await sql(`UPDATE tenant.hr_employees SET tax_identifiers='{}'::jsonb WHERE id=$1`, [ids.high]);
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      const slips2 = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run }));
      const noPan = await run("hrA", (c, x) => pay.getPayslip(c, x, slips2.find((s) => s.employee_id === ids.high).id));
      assert.equal(get(noPan, "TDS"), 0);
      const ex = await run("hrA", (c, x) => pay.listPayrollExceptions(c, x, { runId: ids.run }));
      assert.ok(ex.some((e) => e.code === "NO_PAN"));
      await sql(`UPDATE tenant.hr_employees SET tax_identifiers='{"pan":"PQRSX9876K"}'::jsonb WHERE id=$1`, [ids.high]);
    });

    await t.test("F443: labour welfare fund is a flat amount, employee and employer, by state", async () => {
      const lwf = await run("hrA", (c, x) => stat.saveStatutoryComponent(c, x, { code: "LWF-MH", name: "Labour Welfare Fund", statutoryType: "labor_welfare", calculationBasis: "flat_amount", state: "Maharashtra", employeeFlatAmount: 12, employerFlatAmount: 36, effectiveFrom: "2020-01-01" }));
      ids.lwf = lwf.id;
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      const slips = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run }));
      const lowSlip = await run("hrA", (c, x) => pay.getPayslip(c, x, slips.find((s) => s.employee_id === ids.low).id));
      const get = (slip, code2) => Number(slip.lines.find((l) => l.component_code === code2)?.amount ?? 0);
      const getEmployer = (slip, code2) => Number(slip.lines.find((l) => l.component_code === code2)?.employer_amount ?? 0);
      near(get(lowSlip, "LWF_EE"), 12, "a flat employee amount");
      near(getEmployer(lowSlip, "LWF_ER"), 36, "a flat employer amount");
    });

    await t.test("F445/F447: the statutory report totals PF/ESIC/PT/LWF/TDS across the run; the compliance report aggregates the month with due dates", async () => {
      await run("hrA", (c, x) => pay.submitPayrollRun(c, x, ids.run));
      await run("hrB", (c, x) => pay.decidePayrollRun(c, x, ids.run, { approve: true }));
      await denied("viewer", (c, x) => stat.getStatutoryReport(c, x, ids.run), 403);
      const report = await run("hrA", (c, x) => stat.getStatutoryReport(c, x, ids.run));
      assert.ok(report.totals.pfEmployee > 0);
      assert.ok(report.totals.esicEmployee > 0);
      assert.ok(report.totals.pt > 0);
      assert.ok(report.totals.lwfEmployee > 0);
      assert.ok(report.totals.tds > 0);
      assert.equal(report.employees.length, 3);
      const compliance = await run("hrA", (c, x) => stat.getComplianceReport(c, x, { year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) }));
      assert.deepEqual(compliance.totals, report.totals);
      assert.ok(compliance.dueDates.some((d) => d.type === "pf"));
      assert.ok(compliance.dueDates.find((d) => d.type === "pf").dueDate);
    });

    await t.test("F444: gratuity is added to a final settlement only once five years are served, capped at the ceiling", async () => {
      // the low earner joined recently: not eligible
      const sepLow = await run("hrA", (c, x) => api.initiateSeparation(c, x, { employeeId: ids.low, separationType: "resignation", reason: "x", noticeDate: today }));
      await run("hrA", (c, x) => api.decideSeparation(c, x, sepLow.id, { approve: true, lastWorkingDay: today }));
      for (const tk of await run("hrA", (c, x) => api.listLifecycleTasks(c, x, { employeeId: ids.low, kind: "offboarding" }))) await run("hrA", (c, x) => api.completeLifecycleTask(c, x, tk.id, { note: "done" }));
      await run("hrA", (c, x) => api.completeSeparation(c, x, sepLow.id));
      const s1 = await run("hrA", (c, x) => close.calculateFinalSettlement(c, x, ids.low));
      assert.ok(!s1.lines.some((l) => l.code === "GRATUITY"), "under five years of service: not eligible");

      // the high earner joined years ago: eligible
      const sepHigh = await run("hrA", (c, x) => api.initiateSeparation(c, x, { employeeId: ids.high, separationType: "resignation", reason: "x", noticeDate: today }));
      await run("hrA", (c, x) => api.decideSeparation(c, x, sepHigh.id, { approve: true, lastWorkingDay: today }));
      for (const tk of await run("hrA", (c, x) => api.listLifecycleTasks(c, x, { employeeId: ids.high, kind: "offboarding" }))) await run("hrA", (c, x) => api.completeLifecycleTask(c, x, tk.id, { note: "done" }));
      await run("hrA", (c, x) => api.completeSeparation(c, x, sepHigh.id));
      const s2 = await run("hrA", (c, x) => close.calculateFinalSettlement(c, x, ids.high));
      const gratuityLine = s2.lines.find((l) => l.code === "GRATUITY");
      assert.ok(gratuityLine, "five or more years: eligible for gratuity");
      assert.ok(gratuityLine.amount > 0);
      const records = await run("hrA", (c, x) => stat.listGratuityRecords(c, x, { employeeId: ids.high }));
      assert.ok(records.some((r) => r.record_type === "settlement"));
      // a standalone estimate while still employed works too
      const est = await run("hrA", (c, x) => stat.estimateGratuity(c, x, ids.low));
      assert.equal(est.eligible, false);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
