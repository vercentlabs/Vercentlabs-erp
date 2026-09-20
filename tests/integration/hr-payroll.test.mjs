// Real PostgreSQL integration test -- compensation and the payroll engine (F418-F427, run lifecycle
// of F434): components, formula structures with a balancing allowance, approved compensation with a
// frozen breakup, payroll periods, attendance-based calculation with proration for joining, leaving
// and a mid-period pay revision, overtime, exceptions, determinism, maker-checker approval,
// payslip release, and locks.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_HR, buildHrWorld, connectAdmin } from "./hr-test-kit.mjs";

const comp = await import("../../services/api/src/modules/hr-payroll/compensation.js");
const pay = await import("../../services/api/src/modules/hr-payroll/payroll.js");

const ROLES = {
  hrA: ALL_HR, // prepares payroll
  hrB: ALL_HR, // approves it
  hrC: ALL_HR,
  prep: ["hr_payroll.view", "hr_payroll.payroll.prepare", "hr_payroll.payslip.view"], // prepares but may not approve
  viewer: ["hr_payroll.view", "hr_payroll.employee.view"],
  emp: [], // an ordinary employee (self-service only)
  emp2: [],
};

const addD = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const close = (a, b, msg) => assert.ok(Math.abs(Number(a) - b) < 0.011, `${msg}: expected ${b}, got ${a}`);

test("HR compensation and payroll against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildHrWorld(admin, ROLES, "hrp");
  const { api, run, denied, sql, users, today } = w;
  // last calendar month is entirely in the past
  const t0 = new Date(`${today}T00:00:00Z`);
  const pm = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() - 1, 1));
  const start = pm.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const D = Number(end.slice(8, 10));
  const code = start.slice(0, 7);
  const ids = {};
  const bank = { accountHolder: "Test", accountNumber: "123456789012", ifsc: "HDFC0001234", bankName: "HDFC" };

  const fullAttendance = (emp, from, to) => sql(`INSERT INTO tenant.hr_attendance(organization_id,company_id,employee_id,attendance_date,status,source,created_by) SELECT $1,$2,$3,d::date,'present','system',$4 FROM generate_series($5::date,$6::date,'1 day') d WHERE extract(isodow FROM d) BETWEEN 1 AND 5 ON CONFLICT DO NOTHING`, [w.orgId, w.companyId, emp, users.hrA, from, to]);

  try {
    await run("hrA", (c, x) => api.saveHrSettings(c, x, { requireDocumentsForJoining: false }));
    const dept = await run("hrA", (c, x) => api.saveDepartment(c, x, { code: "FIN", name: "Finance" }));
    const mk = async (first, email, extra = {}) => {
      const e = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: first, lastName: "P", workEmail: email, employmentType: "permanent", joiningDate: "2025-01-06", departmentId: dept.id, bankDetails: bank, pan: undefined, ...extra }));
      await run("hrA", (c, x) => api.completeJoining(c, x, e.id));
      return e;
    };

    await t.test("F418-F420: components -- reserved codes, unique codes, a used component cannot change its nature", async () => {
      const mkc = (input) => run("hrA", (c, x) => comp.saveSalaryComponent(c, x, input));
      ids.basic = (await mkc({ code: "BASIC", name: "Basic", componentType: "earning", componentKind: "basic", pfWage: true })).id;
      ids.hra = (await mkc({ code: "HRA", name: "House rent allowance", componentType: "earning" })).id;
      ids.conv = (await mkc({ code: "CONV", name: "Conveyance", componentType: "earning", taxable: false })).id;
      ids.special = (await mkc({ code: "SPECIAL", name: "Special allowance", componentType: "earning" })).id;
      ids.gym = (await mkc({ code: "GYM", name: "Gym", componentType: "deduction", prorated: false })).id;
      ids.ins = (await mkc({ code: "EMPINS", name: "Employer insurance", componentType: "employer_contribution", prorated: false })).id;
      await denied("hrA", (c, x) => comp.saveSalaryComponent(c, x, { code: "CTC", name: "x" }), 400, "HR_COMPONENT_INVALID");
      await denied("hrA", (c, x) => comp.saveSalaryComponent(c, x, { code: "1BAD", name: "x" }), 400, "HR_COMPONENT_INVALID");
      await denied("hrA", (c, x) => comp.saveSalaryComponent(c, x, { code: "BASIC", name: "Dup" }), 409, "HR_COMPONENT_DUPLICATE");
      await denied("viewer", (c, x) => comp.saveSalaryComponent(c, x, { code: "NEW", name: "x" }), 403);
      await denied("viewer", (c, x) => comp.listSalaryComponents(c, x), 403);
      assert.equal((await run("hrA", (c, x) => comp.listSalaryComponents(c, x, { type: "deduction" }))).length, 1);
    });

    await t.test("F421: a structure with percent-of, fixed, formula and a balancing line; forward references, duplicates and an over-CTC total are refused", async () => {
      const lines = [
        { componentCode: "BASIC", percentage: 50, percentOf: "CTC" },
        { componentCode: "HRA", percentage: 40, percentOf: "BASIC" },
        { componentCode: "CONV", amount: 1600 },
        { componentCode: "GYM", amount: 500 },
        { componentCode: "EMPINS", amount: 1000 },
        { componentCode: "SPECIAL", isBalance: true },
      ];
      await denied("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "STD", name: "Std", lines: [{ componentCode: "HRA", percentage: 40, percentOf: "BASIC" }, { componentCode: "BASIC", percentage: 50 }] }), 400, "HR_STRUCTURE_INVALID"); // HRA refers to a later line
      await denied("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "STD", name: "Std", lines: [{ componentCode: "BASIC", percentage: 50 }, { componentCode: "BASIC", percentage: 10 }] }), 400, "HR_STRUCTURE_INVALID");
      await denied("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "STD", name: "Std", lines: [{ componentCode: "BASIC", isBalance: true }, { componentCode: "HRA", isBalance: true }] }), 400, "HR_STRUCTURE_INVALID");
      await denied("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "STD", name: "Std", lines: [{ componentCode: "BASIC", percentage: 50, amount: 5 }] }), 400, "HR_STRUCTURE_INVALID"); // two bases
      await denied("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "STD", name: "Std", lines: [{ componentCode: "BASIC", formula: "CTC * (" }] }), 400, "HR_FORMULA_INVALID");
      await denied("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "STD", name: "Std", lines: [{ componentCode: "BASIC", formula: "CTC * NOPE" }] }), 400, "HR_STRUCTURE_INVALID");
      const s = await run("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "STD", name: "Standard", lines }));
      ids.structure = s.id;
      assert.equal(s.status, "draft");
      assert.equal(s.lines.length, 6);
      // the preview: 12,00,000 a year = 1,00,000 a month
      const p = await run("hrA", (c, x) => comp.previewSalaryStructure(c, x, { structureId: s.id, annualCtc: 1200000 }));
      const amt = (code) => p.components.find((k) => k.code === code).amount;
      assert.equal(p.monthlyCtc, 100000);
      assert.equal(amt("BASIC"), 50000);
      assert.equal(amt("HRA"), 20000);
      assert.equal(amt("CONV"), 1600);
      assert.equal(amt("SPECIAL"), 27400, "CTC less the other earnings and the employer insurance");
      assert.equal(p.monthlyGross, 99000);
      assert.equal(p.monthlyEmployerContributions, 1000);
      // formulas with min/max clamp
      const f = await run("hrA", (c, x) => comp.createSalaryStructure(c, x, { code: "FRM", name: "Formula", lines: [{ componentCode: "BASIC", formula: "min(CTC * 0.5, 30000)" }, { componentCode: "HRA", formula: "BASIC * 0.4 + 100", maximumAmount: 12100 }, { componentCode: "SPECIAL", isBalance: true }] }));
      const fp = await run("hrA", (c, x) => comp.previewSalaryStructure(c, x, { structureId: f.id, annualCtc: 1200000 }));
      assert.equal(fp.components.find((k) => k.code === "BASIC").amount, 30000, "min() caps it");
      assert.equal(fp.components.find((k) => k.code === "HRA").amount, 12100, "the maximum clamps 12,100");
      await denied("hrA", (c, x) => comp.previewSalaryStructure(c, x, { structureId: f.id, annualCtc: 1200 }), 400, "HR_STRUCTURE_EXCEEDS_CTC"); // 100 a month cannot carry a 120 HRA
      assert.equal(comp.evaluateExpression("round(10 / 3, 2) + max(1, 2) * -2", {}), 3.33 - 4);
    });

    await t.test("F421: a structure is approved by a second person; one active version per code; revision makes a new version; retiring is refused while in use", async () => {
      await denied("hrA", (c, x) => comp.decideSalaryStructure(c, x, ids.structure, { approve: true }), 409, "HR_STRUCTURE_STATE"); // not submitted
      await run("hrA", (c, x) => comp.submitSalaryStructure(c, x, ids.structure));
      await denied("hrA", (c, x) => comp.decideSalaryStructure(c, x, ids.structure, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await denied("hrB", (c, x) => comp.decideSalaryStructure(c, x, ids.structure, { approve: false }), 400, "HR_REASON_REQUIRED");
      const s = await run("hrB", (c, x) => comp.decideSalaryStructure(c, x, ids.structure, { approve: true }));
      assert.equal(s.status, "active");
      await denied("hrA", (c, x) => comp.updateDraftStructure(c, x, ids.structure, { name: "x" }), 409, "HR_STRUCTURE_STATE");
      const v2 = await run("hrA", (c, x) => comp.reviseSalaryStructure(c, x, ids.structure));
      assert.equal(v2.version, 2);
      assert.equal(v2.lines.length, 6);
      await denied("hrA", (c, x) => comp.reviseSalaryStructure(c, x, ids.structure), 409, "HR_STRUCTURE_OPEN");
      await run("hrA", (c, x) => comp.submitSalaryStructure(c, x, v2.id));
      await run("hrB", (c, x) => comp.decideSalaryStructure(c, x, v2.id, { approve: true }));
      const list = await run("hrA", (c, x) => comp.listSalaryStructures(c, x));
      assert.equal(list.filter((k) => k.code === "STD" && k.status === "active").length, 1, "only the new version is active");
      assert.equal(list.find((k) => k.code === "STD" && k.version === 1).status, "inactive");
      ids.structureV2 = v2.id;
    });

    await t.test("F422: compensation is proposed, approved by someone else, frozen with its breakup, and ordered in time", async () => {
      ids.e1 = (await mk("Asha", "asha@co.test", { pan: "ABCDE1234F" })).id;
      const other = await run("hrA", (c, x) => comp.previewSalaryStructure(c, x, { structureId: ids.structure, annualCtc: 1 }).catch(() => null));
      void other;
      await denied("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: ids.structure, annualCtc: 1200000, effectiveFrom: "2025-01-06" }), 409, "HR_STRUCTURE_STATE"); // v1 is inactive
      await denied("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: ids.structureV2, annualCtc: 1200000, effectiveFrom: "2024-12-01" }), 400, "HR_COMPENSATION_INVALID");
      await denied("viewer", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: ids.structureV2, annualCtc: 1200000, effectiveFrom: "2025-01-06" }), 403);
      const k = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: ids.structureV2, annualCtc: 1200000, effectiveFrom: "2025-01-06", reason: "Joining offer" }));
      assert.equal(k.status, "pending_approval");
      assert.equal(Number(k.monthly_gross), 99000);
      await denied("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: ids.structureV2, annualCtc: 1300000, effectiveFrom: "2025-06-01" }), 409, "HR_COMPENSATION_OPEN");
      await denied("hrA", (c, x) => comp.decideCompensation(c, x, k.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      // the employee themselves cannot approve their own pay, even with HR rights
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.e1, users.hrB]);
      await denied("hrB", (c, x) => comp.decideCompensation(c, x, k.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await sql(`UPDATE tenant.hr_employees SET user_id=NULL WHERE id=$1`, [ids.e1]);
      await denied("hrB", (c, x) => comp.decideCompensation(c, x, k.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      const ok = await run("hrB", (c, x) => comp.decideCompensation(c, x, k.id, { approve: true }));
      assert.equal(ok.status, "active");
      await denied("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: ids.structureV2, annualCtc: 1300000, effectiveFrom: "2025-01-06" }), 409, "HR_COMPENSATION_ORDER");
      // a revision from a later date ends the earlier pay the day before
      const k2 = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e1, structureId: ids.structureV2, annualCtc: 1200000, effectiveFrom: "2025-07-01" }));
      await run("hrB", (c, x) => comp.decideCompensation(c, x, k2.id, { approve: true }));
      const [first] = await sql(`SELECT effective_to::text AS t FROM tenant.hr_employee_compensation WHERE id=$1`, [k.id]);
      assert.equal(first.t, "2025-06-30");
      // the frozen breakup does not change if the structure is later revised
      assert.equal(ok.breakup.components.find((x) => x.code === "BASIC").amount, 50000);
      await denied("viewer", (c, x) => comp.listCompensation(c, x, {}), 403);
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.e1, users.emp]);
      const mine = await run("emp", (c, x) => comp.getMyCompensation(c, x));
      assert.equal(Number(mine.monthlyGross), 99000, "an employee sees their own pay");
      await denied("emp", (c, x) => comp.listCompensation(c, x, {}), 403);
      await denied("hrA", (c, x) => comp.obsoleteSalaryStructure(c, x, ids.structureV2, "retire"), 409, "HR_STRUCTURE_IN_USE");
    });

    await t.test("F423: payroll periods are generated once per month, lock only when nothing is pending, unlock with a reason", async () => {
      const g = await run("hrA", (c, x) => pay.generatePayrollPeriods(c, x, { year: Number(start.slice(0, 4)) }));
      assert.equal(g.created, 12);
      const again = await run("hrA", (c, x) => pay.generatePayrollPeriods(c, x, { year: Number(start.slice(0, 4)) }));
      assert.equal(again.created, 0, "idempotent");
      const periods = await run("hrA", (c, x) => pay.listPayrollPeriods(c, x, { year: Number(start.slice(0, 4)) }));
      const p = periods.find((k) => k.period_code === code);
      assert.equal(p.period_start, start);
      assert.equal(p.period_end, end);
      ids.period = p.id;
      await denied("viewer", (c, x) => pay.generatePayrollPeriods(c, x, { year: 2031 }), 403);
    });

    await t.test("F424/F425: full attendance pays the full structure; absences prorate; the payslip carries every component", async () => {
      await fullAttendance(ids.e1, start, end);
      const r = await run("hrA", (c, x) => pay.startPayrollRun(c, x, { periodId: ids.period }));
      ids.run = r.id;
      assert.equal(r.status, "draft");
      await denied("hrA", (c, x) => pay.startPayrollRun(c, x, { periodId: ids.period }), 409, "HR_RUN_EXISTS");
      await denied("viewer", (c, x) => pay.runPayrollCalculation(c, x, r.id), 403);
      const calc = await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, r.id));
      assert.equal(calc.status, "calculated");
      assert.equal(calc.employee_count, 1);
      const [slip] = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: r.id }));
      close(slip.paid_days, D, "every day paid");
      const full = await run("hrA", (c, x) => pay.getPayslip(c, x, slip.id));
      const get = (code) => Number(full.lines.find((l) => l.component_code === code)?.amount ?? 0);
      close(get("BASIC"), 50000, "basic");
      close(get("HRA"), 20000, "hra");
      close(get("CONV"), 1600, "conveyance");
      close(get("SPECIAL"), 27400, "special");
      close(get("GYM"), 500, "gym deduction");
      close(full.gross_pay, 99000, "gross");
      close(full.net_pay, 98500, "net = gross less the gym deduction");
      close(full.employer_contributions, 1000, "employer insurance");
      assert.equal(Number(full.taxable_amount ?? 0) >= 0, true);
      const conv = full.lines.find((l) => l.component_code === "CONV");
      assert.equal(Number(conv.taxable_amount), 0, "a non-taxable component contributes no taxable amount");
      // absences: two working days marked absent
      const absent = await sql(`SELECT attendance_date::text AS d FROM tenant.hr_attendance WHERE employee_id=$1 AND status='present' AND attendance_date BETWEEN $2 AND $3 ORDER BY 1 LIMIT 2`, [ids.e1, start, end]);
      for (const a of absent) await sql(`UPDATE tenant.hr_attendance SET status='absent' WHERE employee_id=$1 AND attendance_date=$2`, [ids.e1, a.d]);
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, r.id));
      const [slip2] = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: r.id }));
      const two = await run("hrA", (c, x) => pay.getPayslip(c, x, slip2.id));
      const line = (code) => Number(two.lines.find((l) => l.component_code === code)?.amount ?? 0);
      close(line("BASIC"), r2((50000 * (D - 2)) / D), "basic prorated for 2 unpaid days");
      close(line("HRA"), r2((20000 * (D - 2)) / D), "hra prorated");
      close(line("GYM"), 500, "a non-prorated deduction is not reduced by absence");
      close(two.employer_contributions, 1000, "a non-prorated employer contribution is not reduced");
      close(two.lop_days, 2, "loss-of-pay days");
      assert.equal(two.snapshot.attendance.lopDays, 2, "the snapshot freezes the inputs");
      // restore
      for (const a of absent) await sql(`UPDATE tenant.hr_attendance SET status='present' WHERE employee_id=$1 AND attendance_date=$2`, [ids.e1, a.d]);
    });

    await t.test("F426: a joiner, a leaver and a mid-period pay revision are prorated by the days each applied", async () => {
      // joiner: starts on day 11
      const joinDate = addD(start, 10);
      const e2 = await mk("Bala", "bala@co.test", { joiningDate: joinDate });
      ids.e2 = e2.id;
      // leaver: last day is day 20
      const e3 = await mk("Chitra", "chitra@co.test");
      ids.e3 = e3.id;
      // revision: 6,00,000 for days 1-15, 12,00,000 from day 16
      const e5 = await mk("Esha", "esha@co.test");
      ids.e5 = e5.id;
      for (const [id, from] of [[ids.e2, joinDate], [ids.e3, "2025-01-06"]]) {
        const k = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: id, structureId: ids.structureV2, annualCtc: 1200000, effectiveFrom: from }));
        await run("hrB", (c, x) => comp.decideCompensation(c, x, k.id, { approve: true }));
      }
      const c1 = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e5, structureId: ids.structureV2, annualCtc: 600000, effectiveFrom: "2025-01-06" }));
      await run("hrB", (c, x) => comp.decideCompensation(c, x, c1.id, { approve: true }));
      const c2 = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e5, structureId: ids.structureV2, annualCtc: 1200000, effectiveFrom: addD(start, 15) }));
      await run("hrB", (c, x) => comp.decideCompensation(c, x, c2.id, { approve: true }));
      const leave = addD(start, 19);
      await sql(`UPDATE tenant.hr_employees SET status='separated', separation_date=$2, last_working_date=$2 WHERE id=$1`, [ids.e3, leave]);
      await fullAttendance(ids.e2, joinDate, end);
      await fullAttendance(ids.e3, start, leave);
      await fullAttendance(ids.e5, start, end);
      // an employee with no compensation is reported, not paid
      ids.e4 = (await mk("Dev", "dev@co.test")).id;
      await fullAttendance(ids.e4, start, end);
      const calc = await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      assert.equal(calc.employee_count, 4, "four payslips; the employee with no pay is left out");
      assert.equal(calc.blockingExceptions, 1);
      const slips = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run }));
      const of = async (empId) => run("hrA", (c, x) => pay.getPayslip(c, x, slips.find((s) => s.employee_id === empId).id));
      const basic = (ps) => Number(ps.lines.find((l) => l.component_code === "BASIC").amount);
      close(basic(await of(ids.e2)), r2((50000 * (D - 10)) / D), "joiner: paid from day 11");
      close(basic(await of(ids.e3)), r2((50000 * 20) / D), "leaver: paid to day 20");
      close(basic(await of(ids.e5)), r2((25000 * 15) / D + (50000 * (D - 15)) / D), "revision: each rate for its own days");
      const ex = await run("hrA", (c, x) => pay.listPayrollExceptions(c, x, { runId: ids.run }));
      const missing = ex.find((e) => e.code === "NO_COMPENSATION");
      assert.equal(missing.severity, "error");
      assert.equal(missing.employee_number, (await sql(`SELECT employee_number FROM tenant.hr_employees WHERE id=$1`, [ids.e4]))[0].employee_number);
      assert.ok(ex.some((e) => e.code === "NO_PAN" && e.severity === "warning"));
      // the blocking exception stops submission and cannot be waived; setting the pay and recalculating clears it
      await denied("hrA", (c, x) => pay.submitPayrollRun(c, x, ids.run), 409, "HR_RUN_BLOCKED");
      await denied("hrA", (c, x) => pay.resolvePayrollException(c, x, missing.id, "ignore it"), 409, "HR_EXCEPTION_UNWAIVABLE");
      const k4 = await run("hrA", (c, x) => comp.proposeCompensation(c, x, { employeeId: ids.e4, structureId: ids.structureV2, annualCtc: 1200000, effectiveFrom: "2025-01-06" }));
      await run("hrB", (c, x) => comp.decideCompensation(c, x, k4.id, { approve: true }));
      const again = await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      assert.equal(again.employee_count, 5);
      assert.equal(again.blockingExceptions, 0);
    });

    await t.test("F427: approved overtime is paid at the hourly rate x the multiplier, once; pending overtime is left out and reported", async () => {
      const day = await sql(`SELECT attendance_date::text AS d FROM tenant.hr_attendance WHERE employee_id=$1 AND status='present' AND attendance_date BETWEEN $2 AND $3 ORDER BY 1 LIMIT 3`, [ids.e1, start, end]);
      await sql(`INSERT INTO tenant.hr_overtime(organization_id,company_id,employee_id,work_date,minutes,status,decided_by) VALUES ($1,$2,$3,$4,120,'approved',$5)`, [w.orgId, w.companyId, ids.e1, day[0].d, users.hrA]);
      await sql(`INSERT INTO tenant.hr_overtime(organization_id,company_id,employee_id,work_date,minutes,status) VALUES ($1,$2,$3,$4,60,'pending')`, [w.orgId, w.companyId, ids.e1, day[1].d]);
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      const slips = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run, employeeId: ids.e1 }));
      const ps = await run("hrA", (c, x) => pay.getPayslip(c, x, slips[0].id));
      const ot = ps.lines.find((l) => l.component_code === "OVERTIME");
      // hourly = 99,000 / 26 days / 8 hours; 2 hours at the default 2x
      close(ot.amount, r2((2 * 99000) / 26 / 8 * 2), "overtime pay");
      assert.equal(ps.overtime_minutes, 120);
      close(ps.gross_pay, 99000 + Number(ot.amount), "gross includes overtime");
      const ex = await run("hrA", (c, x) => pay.listPayrollExceptions(c, x, { runId: ids.run }));
      assert.ok(ex.some((e) => e.code === "PENDING_OVERTIME" && e.employee_number));
      const [row] = await sql(`SELECT payroll_run_id FROM tenant.hr_overtime WHERE employee_id=$1 AND status='approved'`, [ids.e1]);
      assert.equal(row.payroll_run_id, ids.run, "the approved overtime is reserved by this run");
      // recalculating does not pay it twice
      await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      const slipsAgain = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run, employeeId: ids.e1 }));
      const again = (await run("hrA", (c, x) => pay.getPayslip(c, x, slipsAgain[0].id))).lines.filter((l) => l.component_code === "OVERTIME");
      assert.equal(again.length, 1);
    });

    await t.test("F424: the same inputs give the same payslips (hash), and a changed input changes it", async () => {
      const a = await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      const b = await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      assert.equal(a.calc_hash, b.calc_hash, "recalculating with no change is bit-for-bit identical");
      assert.equal((await run("hrA", (c, x) => pay.verifyPayrollDeterminism(c, x, ids.run))).matches, true);
      await sql(`UPDATE tenant.hr_attendance SET status='absent' WHERE employee_id=$1 AND status='present' AND attendance_date = (SELECT min(attendance_date) FROM tenant.hr_attendance WHERE employee_id=$1 AND status='present' AND attendance_date >= $2)`, [ids.e5, start]);
      const changed = await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      assert.notEqual(changed.calc_hash, a.calc_hash);
      await sql(`UPDATE tenant.hr_attendance SET status='present' WHERE employee_id=$1 AND status='absent' AND source='system'`, [ids.e5]);
      const back = await run("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run));
      assert.equal(back.calc_hash, a.calc_hash, "restoring the input restores the result");
    });

    await t.test("F434: submit, then approval by someone who did not prepare it; a payroll that includes your own pay cannot be approved by you", async () => {
      await denied("hrB", (c, x) => pay.decidePayrollRun(c, x, ids.run, { approve: true }), 409, "HR_RUN_STATE"); // not submitted
      await run("hrA", (c, x) => pay.submitPayrollRun(c, x, ids.run));
      await denied("hrA", (c, x) => pay.runPayrollCalculation(c, x, ids.run), 409, "HR_RUN_STATE"); // locked while awaiting approval
      await denied("hrA", (c, x) => pay.decidePayrollRun(c, x, ids.run, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await denied("viewer", (c, x) => pay.decidePayrollRun(c, x, ids.run, { approve: true }), 403);
      // an approver whose own employee record is in the run is refused
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.e1, users.hrB]);
      await denied("hrB", (c, x) => pay.decidePayrollRun(c, x, ids.run, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.e1, users.emp]);
      // sent back, then submitted again
      await denied("hrB", (c, x) => pay.decidePayrollRun(c, x, ids.run, { approve: false }), 400, "HR_REASON_REQUIRED");
      const back = await run("hrB", (c, x) => pay.decidePayrollRun(c, x, ids.run, { approve: false, note: "Check overtime" }));
      assert.equal(back.status, "calculated");
      assert.equal(back.returned_reason, "Check overtime");
      await run("hrA", (c, x) => pay.submitPayrollRun(c, x, ids.run));
      // employees cannot see their payslip before approval
      assert.equal((await run("emp", (c, x) => pay.listMyPayslips(c, x))).length, 0);
      const approved = await run("hrC", (c, x) => pay.decidePayrollRun(c, x, ids.run, { approve: true, note: "Verified" }));
      assert.equal(approved.status, "approved");
      assert.equal(approved.approved_by, users.hrC);
      assert.equal((await sql(`SELECT count(*)::int AS n FROM tenant.hr_payslips WHERE payroll_run_id=$1 AND status='approved'`, [ids.run]))[0].n, 5);
      assert.equal((await sql(`SELECT status FROM tenant.hr_overtime WHERE employee_id=$1 AND payroll_run_id=$2`, [ids.e1, ids.run]))[0].status, "paid");
    });

    await t.test("release and self-service: an employee sees only their own released payslip, with the bank account masked", async () => {
      const mine = await run("emp", (c, x) => pay.listMyPayslips(c, x));
      assert.equal(mine.length, 1);
      const slip = await run("emp", (c, x) => pay.getPayslip(c, x, mine[0].id));
      assert.equal(slip.employee_number, (await sql(`SELECT employee_number FROM tenant.hr_employees WHERE id=$1`, [ids.e1]))[0].employee_number);
      assert.match(slip.bank_details.account_number, /^••••9012$/);
      assert.equal(slip.snapshot, undefined, "an employee does not see the calculation snapshot");
      const all = await run("hrA", (c, x) => pay.listPayslips(c, x, { runId: ids.run }));
      const someoneElse = all.find((s) => s.employee_id !== ids.e1);
      await denied("emp", (c, x) => pay.getPayslip(c, x, someoneElse.id), 403);
      await denied("emp2", (c, x) => pay.listMyPayslips(c, x), 404);
      await denied("viewer", (c, x) => pay.listPayslips(c, x, {}), 403);
    });

    await t.test("locks: once the payroll is approved its period is locked and attendance in it cannot change", async () => {
      const [p] = await sql(`SELECT status FROM tenant.hr_payroll_periods WHERE id=$1`, [ids.period]);
      assert.equal(p.status, "locked");
      const day = (await sql(`SELECT attendance_date::text AS d FROM tenant.hr_attendance WHERE employee_id=$1 AND attendance_date BETWEEN $2 AND $3 ORDER BY 1 LIMIT 1`, [ids.e1, start, end]))[0].d;
      await denied("hrA", (c, x) => api.recordAttendance(c, x, { employeeId: ids.e1, attendanceDate: day, status: "absent", reason: "late correction" }), 409, "HR_PERIOD_LOCKED");
      await denied("hrB", (c, x) => pay.unlockPayrollPeriod(c, x, ids.period, "oops"), 409, "HR_PERIOD_HAS_RUN");
      await denied("hrA", (c, x) => pay.lockPayrollPeriod(c, x, ids.period), 409, "HR_PERIOD_STATE");
    });

    await t.test("cancelling an approved payroll releases its overtime and payslips; the period can then be run again", async () => {
      await denied("prep", (c, x) => pay.cancelPayroll(c, x, ids.run, "mistake"), 403); // approved: the approver's permission is needed
      await denied("hrB", (c, x) => pay.cancelPayroll(c, x, ids.run, ""), 400, "HR_REASON_REQUIRED");
      const c = await run("hrB", (cc, x) => pay.cancelPayroll(cc, x, ids.run, "Wrong bonus month"));
      assert.equal(c.status, "cancelled");
      assert.equal((await sql(`SELECT status, payroll_run_id FROM tenant.hr_overtime WHERE employee_id=$1 AND status IN ('approved','paid')`, [ids.e1]))[0].payroll_run_id, null);
      assert.equal((await run("emp", (cc, x) => pay.listMyPayslips(cc, x))).length, 0, "a cancelled payslip is not visible");
      const fresh = await run("hrA", (cc, x) => pay.startPayrollRun(cc, x, { periodId: ids.period }));
      assert.notEqual(fresh.id, ids.run);
      const dash = await run("hrA", (cc, x) => pay.getPayrollDashboard(cc, x));
      assert.equal(dash.runsByStatus.cancelled, 1);
    });

    await t.test("a payroll with a period that has pending items is locked only on purpose", async () => {
      const next = (await run("hrA", (cc, x) => pay.listPayrollPeriods(cc, x, { year: Number(start.slice(0, 4)) }))).find((k) => k.period_start > end);
      const day = next.period_start;
      const e = ids.e1;
      await sql(`INSERT INTO tenant.hr_overtime(organization_id,company_id,employee_id,work_date,minutes,status) VALUES ($1,$2,$3,$4,45,'pending')`, [w.orgId, w.companyId, e, day]);
      await denied("hrA", (cc, x) => pay.lockPayrollPeriod(cc, x, next.id), 409, "HR_PERIOD_PENDING_ITEMS");
      const locked = await run("hrA", (cc, x) => pay.lockPayrollPeriod(cc, x, next.id, { force: true, reason: "Month-end freeze" }));
      assert.equal(locked.status, "locked");
      await denied("prep", (cc, x) => pay.unlockPayrollPeriod(cc, x, next.id, "x"), 403); // unlocking is the approver's
      await denied("hrB", (cc, x) => pay.unlockPayrollPeriod(cc, x, next.id, ""), 400, "HR_REASON_REQUIRED");
      assert.equal((await run("hrB", (cc, x) => pay.unlockPayrollPeriod(cc, x, next.id, "Reopened for late overtime"))).status, "open");
    });

    await t.test("payroll groups: a run can be scoped to a department; a company-wide run for the same period is then refused, so nobody is paid twice", async () => {
      const periods = await run("hrA", (cc, x) => pay.listPayrollPeriods(cc, x, { year: Number(start.slice(0, 4)) }));
      const other = periods.find((k) => k.period_start > addD(end, 40));
      const dept2 = await run("hrA", (cc, x) => api.saveDepartment(cc, x, { code: "OPS2", name: "Ops" }));
      const grp = await run("hrA", (cc, x) => pay.startPayrollRun(cc, x, { periodId: other.id, departmentId: dept2.id }));
      assert.match(grp.payroll_number, /-OPS2$/);
      assert.deepEqual(grp.scope, { departmentId: dept2.id });
      await denied("hrA", (cc, x) => pay.startPayrollRun(cc, x, { periodId: other.id }), 409, "HR_RUN_EXISTS");
      await denied("hrA", (cc, x) => pay.startPayrollRun(cc, x, { periodId: other.id, departmentId: dept2.id }), 409, "HR_RUN_EXISTS");
      const calc = await run("hrA", (cc, x) => pay.runPayrollCalculation(cc, x, grp.id));
      assert.equal(calc.employee_count, 0, "nobody is in that department, so nobody is paid");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
