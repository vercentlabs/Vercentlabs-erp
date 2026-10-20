// HR MVP 40 (employee exit and the remaining attendance states): a missing check-out is INCOMPLETE, a correction waiting for a decision is
// PENDING_CORRECTION, late stays a flag next to present; corrections are decided by the manager or HR, never the person who asked, and add
// punches beside the originals; payroll stops on unresolved days and leaves out employees who are not payroll-eligible; an exit is accepted
// with a last working day (on notice, prorated pay, clearance checklist), completed only once cleared, can be withdrawn before that, and is
// never marked settled while the final payslip or a settlement item is unpaid.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:hr-exit-attendance     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(`file:///${ROOT}services/api/src/${path}`);

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the HR suite on the live database. Set SMOKE_DATABASE to a scratch database.");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();

let passed = 0;
const failures = [];
async function check(name, work) {
  await client.query("SAVEPOINT smoke_check");
  try {
    await work();
    await client.query("RELEASE SAVEPOINT smoke_check");
    passed += 1;
    console.log("  ok   ", name);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT smoke_check");
    failures.push(name);
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 5).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function refused(work, code) {
  await client.query("SAVEPOINT refused");
  try { await work(); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT refused"); if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  await client.query("RELEASE SAVEPOINT refused");
  throw new Error(`expected rejection ${code ?? ""}`);
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const tag = Math.random().toString(16).slice(2, 10);
  const registered = await registerOrganization(client, {
    fullName: "Smoke Owner", email: `hrexit-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `HR exit ${tag}`, countryCode: "IN", baseCurrency: "INR",
    timezone: "Asia/Kolkata",
  });
  const organizationId = registered.organizationId;
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
  async function contextFor(userId) {
    const { rows } = await client.query(
      `SELECT COALESCE(array_agg(DISTINCT role.slug), ARRAY[]::text[]) AS role_slugs,
              COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
         LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
        WHERE assignment.organization_id = $1 AND assignment.user_id = $2`, [organizationId, userId]);
    return { organizationId, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions };
  }
  async function addMember(roleSlug, name) {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status) VALUES (gen_random_uuid(), $1, $2, 'x', 'active') RETURNING id`,
      [`${name.split(" ")[0].toLowerCase()}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [organizationId, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`,
      [organizationId, id, roleSlug]);
    return contextFor(id);
  }
  const owner = await contextFor(registered.userId);
  const maker = await addMember("hr_manager", "Hema HR");
  const checker = await addMember("hr_manager", "Charu HR");
  const seller = await addMember("sales_representative", "Om Outsider");
  const raviUser = await addMember("employee", "Ravi Worker");
  const mohanUser = await addMember("employee", "Mohan Lead");
  const ashaUser = await addMember("employee", "Asha Leaver");
  const wf = await api("modules/hr-payroll/workforce.js");
  const time = await api("modules/hr-payroll/time.js");
  const comp = await api("modules/hr-payroll/compensation.js");
  const pay = await api("modules/hr-payroll/payroll.js");
  const st = await api("modules/hr-payroll/statutory/index.js");
  const pa = await api("modules/hr-payroll/accounting/index.js");
  const ex = await api("modules/hr-payroll/exit/index.js");
  const fix = await api("modules/hr-payroll/attendance/index.js");

  await comp.saveSalaryComponent(client, maker, { code: "BASIC", name: "Basic", componentType: "earning", componentKind: "basic" });
  await comp.saveSalaryComponent(client, maker, { code: "SPECIAL", name: "Special allowance", componentType: "earning" });
  const structure = await comp.createSalaryStructure(client, maker, { code: "STAFF", name: "Staff", lines: [{ componentCode: "BASIC", percentage: 50, percentOf: "CTC" }, { componentCode: "SPECIAL", isBalance: true }] });
  await comp.submitSalaryStructure(client, maker, structure.id);
  await comp.decideSalaryStructure(client, checker, structure.id, { approve: true, note: "" });
  const tdsRule = await st.createStatutoryRule(client, maker, { template: "TDS-NEW", effectiveFrom: "2026-04-01" });
  await st.verifyStatutoryRule(client, checker, tdsRule.id, { note: "Checked against the Finance Act" });
  const shift = await time.saveShift(client, maker, { code: "GEN", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60, graceMinutes: 10, workingDays: [1, 2, 3, 4, 5, 6, 7] });
  let n = 0;
  const skip = new Set();
  const employee = async (first, user, managerId = null) => {
    const e = await wf.saveEmployee(client, maker, { firstName: first, lastName: `Test${++n}`, joiningDate: "2026-09-01", employmentType: "permanent", noticePeriodDays: 30, ...(managerId ? { managerEmployeeId: managerId } : {}) });
    await wf.completeJoining(client, maker, e.id);
    await client.query(`UPDATE tenant.hr_employees SET user_id = $2, statutory_identifiers = '{"pf_applicable": false, "esic_applicable": false}'::jsonb, tax_identifiers = '{"pan": "ABCDE1234F", "regime": "new"}'::jsonb,
      bank_details = '{"account_number": "1234567890", "ifsc": "HDFC0000001"}'::jsonb WHERE id = $1`, [e.id, user.userId]);
    const proposed = await comp.proposeCompensation(client, maker, { employeeId: e.id, structureId: structure.id, annualCtc: 360000, effectiveFrom: "2026-09-01" });
    await comp.decideCompensation(client, checker, proposed.id, { approve: true, note: "" });
    await time.assignShift(client, maker, { employeeId: e.id, shiftId: shift.id, effectiveFrom: "2026-09-01" });
    return e;
  };
  const mohan = await employee("Mohan", mohanUser);
  const ravi = await employee("Ravi", raviUser, mohan.id);
  const asha = await employee("Asha", ashaUser, mohan.id);
  const present = async (e, exceptDays = []) => client.query(`INSERT INTO tenant.hr_attendance (organization_id, employee_id, attendance_date, status, source, created_by)
      SELECT $1, $2, d::date, 'present', 'manual', $3 FROM generate_series('2026-09-01'::date, '2026-09-30'::date, interval '1 day') d WHERE NOT (d::date = ANY($4::date[])) ON CONFLICT DO NOTHING`,
    [organizationId, e.id, owner.userId, exceptDays]);
  const punchAt = (e, iso, direction) => client.query(`INSERT INTO tenant.hr_attendance_punches (organization_id, employee_id, punched_at, direction, source, created_by) VALUES ($1,$2,$3,$4,'web',$5)`,
    [organizationId, e.id, iso, direction, owner.userId]);
  const day = async (e, date) => (await client.query(`SELECT * FROM tenant.hr_attendance WHERE employee_id = $1 AND attendance_date = $2`, [e.id, date])).rows[0];
  void skip;

  await check("E1. A day with a check-in 40 minutes late and no check-out is INCOMPLETE and flagged late; the original punch is kept", async () => {
    await punchAt(ravi, "2026-09-15T09:40:00+05:30", "in");
    const d = await time.recomputeDay(client, maker, ravi, "2026-09-15");
    assert(d.status === "incomplete" && d.late_minutes === 40 && (await day(ravi, "2026-09-15")).is_late === true, JSON.stringify([d.status, d.late_minutes]));
  });

  await check("E2. Ravi asks for the check-out to be corrected: the day is PENDING_CORRECTION; a second request is refused; he can't decide it; his manager approves — a regularized punch is added beside the original, the day is present and still late", async () => {
    await refused(() => fix.requestAttendanceCorrection(client, raviUser, { date: "2026-09-15", checkOut: "18:30" }), "HR_REASON_REQUIRED");
    await refused(() => fix.requestAttendanceCorrection(client, raviUser, { employeeId: mohan.id, date: "2026-09-15", checkOut: "18:30", reason: "x" }), "HR_FORBIDDEN");
    const r = await fix.requestAttendanceCorrection(client, raviUser, { date: "2026-09-15", checkOut: "18:30", reason: "Forgot to check out" });
    assert((await day(ravi, "2026-09-15")).status === "pending_correction", "pending correction");
    await refused(() => fix.requestAttendanceCorrection(client, raviUser, { date: "2026-09-15", checkOut: "18:00", reason: "again" }), "HR_CORRECTION_DUPLICATE");
    await refused(() => fix.decideAttendanceCorrection(client, raviUser, r.id, { approve: true }), "HR_FORBIDDEN");
    const mine = await fix.listAttendanceCorrections(client, mohanUser, { status: "pending" });
    assert(mine.length === 1 && mine[0].canDecide && mine[0].check_out === "18:30", JSON.stringify(mine));
    const done = await fix.decideAttendanceCorrection(client, mohanUser, r.id, { approve: true, note: "OK" });
    assert(done.status === "approved" && done.attendance.status === "present" && done.attendance.late_minutes === 40, JSON.stringify(done.attendance));
    const punches = (await client.query(`SELECT direction, source FROM tenant.hr_attendance_punches WHERE employee_id = $1 ORDER BY punched_at`, [ravi.id])).rows;
    assert(punches.length === 2 && punches[0].source === "web" && punches[1].source === "regularized", JSON.stringify(punches));
    await refused(() => fix.listAttendanceCorrections(client, seller, {}), "HR_FORBIDDEN");
  });

  await check("E3. HR can't decide a correction it asked for; a rejection needs a reason and puts the day back; an approval with both times makes the day present", async () => {
    const asked = await fix.requestAttendanceCorrection(client, maker, { employeeId: ravi.id, date: "2026-09-16", checkIn: "09:00", checkOut: "18:00", reason: "Biometric was down" });
    await refused(() => fix.decideAttendanceCorrection(client, maker, asked.id, { approve: true }), "HR_SELF_APPROVAL");
    await refused(() => fix.decideAttendanceCorrection(client, checker, asked.id, { approve: false }), "HR_REASON_REQUIRED");
    await fix.decideAttendanceCorrection(client, checker, asked.id, { approve: false, note: "No evidence" });
    assert((await day(ravi, "2026-09-16")).status === "absent", "back to absent");
    const again = await fix.requestAttendanceCorrection(client, maker, { employeeId: ravi.id, date: "2026-09-16", checkIn: "09:00", checkOut: "18:00", reason: "Gate register attached" });
    const ok = await fix.decideAttendanceCorrection(client, checker, again.id, { approve: true });
    assert(ok.attendance.status === "present" && ok.attendance.worked_minutes === 480 && ok.attendance.late_minutes === 0, JSON.stringify(ok.attendance));
  });

  let run;
  await check("E4. Payroll stops on an unresolved day (missing check-out) and leaves out an employee who isn't payroll-eligible (changed only with a reason)", async () => {
    await punchAt(ravi, "2026-09-17T09:00:00+05:30", "in");
    await time.recomputeDay(client, maker, ravi, "2026-09-17");
    await present(ravi, ["2026-09-15", "2026-09-16", "2026-09-17"]);
    await present(mohan);
    await present(asha);
    await refused(() => ex.setPayrollEligibility(client, maker, mohan.id, { eligible: false }), "HR_REASON_REQUIRED");
    await ex.setPayrollEligibility(client, maker, mohan.id, { eligible: false, reason: "Paid by the parent company" });
    await pay.generatePayrollPeriods(client, maker, { year: 2026 });
    const september = (await pay.listPayrollPeriods(client, maker, { year: "2026" })).find((p) => String(p.period_start).startsWith("2026-09"));
    run = await pay.startPayrollRun(client, maker, { periodId: september.id });
    await pay.runPayrollCalculation(client, maker, run.id);
    const ex1 = (await client.query(`SELECT code, severity FROM tenant.hr_payroll_exceptions WHERE payroll_run_id = $1 AND employee_id = $2`, [run.id, ravi.id])).rows;
    assert(ex1.some((x) => x.code === "UNRESOLVED_ATTENDANCE" && x.severity === "error"), JSON.stringify(ex1));
    const slips = (await client.query(`SELECT employee_id FROM tenant.hr_payslips WHERE payroll_run_id = $1`, [run.id])).rows.map((r) => r.employee_id);
    assert(!slips.includes(mohan.id) && slips.includes(ravi.id), "Mohan is left out");
    await refused(() => pay.submitPayrollRun(client, maker, run.id), "HR_RUN_BLOCKED");
    const r = await fix.requestAttendanceCorrection(client, raviUser, { date: "2026-09-17", checkOut: "18:00", reason: "Forgot" });
    await fix.decideAttendanceCorrection(client, mohanUser, r.id, { approve: true });
  });

  let exit;
  await check("E5. Asha resigns herself (she can't terminate herself; one open exit); HR accepts with last day 20 September: on notice, clearance raised; completing is refused until cleared, then she is separated", async () => {
    await refused(() => ex.startSeparation(client, ashaUser, { employeeId: asha.id, type: "termination", reason: "x" }), "HR_FORBIDDEN");
    exit = await ex.startSeparation(client, ashaUser, { employeeId: asha.id, type: "resignation", noticeDate: "2026-09-01", reason: "Moving cities" });
    assert(exit.status === "submitted" && String(exit.requested_last_day).length > 0, JSON.stringify(exit));
    await refused(() => ex.startSeparation(client, maker, { employeeId: asha.id, type: "resignation", reason: "again" }), "HR_EXIT_OPEN");
    await refused(() => ex.acceptSeparation(client, seller, exit.id, {}), "HR_FORBIDDEN");
    await ex.acceptSeparation(client, maker, exit.id, { lastWorkingDay: "2026-09-20", note: "Released early" });
    const e = (await client.query(`SELECT status, last_working_date::text AS lwd FROM tenant.hr_employees WHERE id = $1`, [asha.id])).rows[0];
    assert(e.status === "on_notice" && e.lwd === "2026-09-20", JSON.stringify(e));
    const tasks = (await client.query(`SELECT id, mandatory FROM tenant.hr_lifecycle_tasks WHERE employee_id = $1 AND kind = 'offboarding'`, [asha.id])).rows;
    assert(tasks.length === 5 && tasks.filter((t) => t.mandatory).length === 4, String(tasks.length));
    await refused(() => ex.completeSeparation(client, maker, exit.id, {}), "HR_EXIT_CLEARANCE_OPEN");
    for (const t of tasks.filter((x) => x.mandatory)) await wf.completeLifecycleTask(client, maker, t.id, {});
    const done = await ex.completeSeparation(client, maker, exit.id, { exitInterview: "Liked the team" });
    const after = (await client.query(`SELECT status, separation_date::text AS sd FROM tenant.hr_employees WHERE id = $1`, [asha.id])).rows[0];
    assert(done.status === "completed" && after.status === "separated" && after.sd === "2026-09-20", JSON.stringify(after));
    await refused(() => ex.settleSeparation(client, checker, exit.id, {}), "HR_SETTLEMENT_BLOCKED");
    await refused(() => fix.requestAttendanceCorrection(client, ashaUser, { date: "2026-09-10", checkIn: "09:00", reason: "x" }), "HR_EMPLOYEE_STATE");
  });

  await check("E6. The final payroll prorates Asha to 20 days and carries her settlement earning; settled only once the final payslip is paid; her records stay", async () => {
    const enc = await (await api("modules/hr-payroll/statutory/index.js")).createPayrollInput(client, maker, { employeeId: asha.id, type: "settlement_earning", amount: 5000, description: "Leave encashment, 5 days", month: "2026-09" });
    await st.decidePayrollInput(client, checker, enc.id, { approve: true, note: "" });
    await pay.runPayrollCalculation(client, maker, run.id);
    const slip = (await client.query(`SELECT * FROM tenant.hr_payslips WHERE payroll_run_id = $1 AND employee_id = $2`, [run.id, asha.id])).rows[0];
    assert(Number(slip.paid_days) === 20 && Number(slip.gross_pay) === 20000 + 5000, JSON.stringify([slip.paid_days, slip.gross_pay]));
    const blocked = (await ex.getSeparation(client, maker, exit.id)).settlement.blockers;
    assert(blocked.some((b) => /unpaid/.test(b)) && blocked.some((b) => /settlement item/.test(b)), JSON.stringify(blocked));
    await pay.submitPayrollRun(client, maker, run.id);
    await pay.decidePayrollRun(client, checker, run.id, { approve: true, note: "" });
    await pa.postPayrollRunToFinance(client, checker, run.id, { postingDate: "2026-09-30" });
    const bank = (await client.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND NOT is_group AND control_kind = 'bank' AND status = 'active' ORDER BY code LIMIT 1`, [organizationId])).rows[0];
    await refused(() => ex.settleSeparation(client, checker, exit.id, { notRequired: true, note: "nothing" }), "HR_SETTLEMENT_BLOCKED");
    await pa.recordSalaryPayment(client, checker, run.id, { paymentDate: "2026-09-30", paidFromAccountId: bank.id });
    await refused(() => ex.settleSeparation(client, raviUser, exit.id, {}), "HR_FORBIDDEN");
    const settled = await ex.settleSeparation(client, checker, exit.id, { note: "Final pay and encashment paid" });
    assert(settled.settlement_status === "settled" && settled.final_payslip_id === slip.id, JSON.stringify(settled));
    const kept = (await client.query(`SELECT (SELECT count(*) FROM tenant.hr_attendance WHERE employee_id = $1)::int AS days, (SELECT count(*) FROM tenant.hr_payslips WHERE employee_id = $1)::int AS slips`, [asha.id])).rows[0];
    assert(kept.days >= 20 && kept.slips === 1, JSON.stringify(kept));
    const mine = await ex.listSeparations(client, ashaUser, {});
    assert(mine.length === 1 && mine[0].settlementStatus === "settled", "she sees her own exit");
  });

  await check("E7. An exit withdrawn before completion: back to active, last day cleared, open clearance waived", async () => {
    const s = await ex.startSeparation(client, raviUser, { employeeId: ravi.id, type: "resignation", reason: "Offer elsewhere" });
    await ex.acceptSeparation(client, maker, s.id, { lastWorkingDay: "2026-11-30" });
    await refused(() => ex.completeSeparation(client, maker, s.id, {}), "HR_EXIT_EARLY");
    await refused(() => ex.withdrawSeparation(client, raviUser, s.id, {}), "HR_REASON_REQUIRED");
    await ex.withdrawSeparation(client, raviUser, s.id, { reason: "Counter-offer accepted" });
    const e = (await client.query(`SELECT status, last_working_date FROM tenant.hr_employees WHERE id = $1`, [ravi.id])).rows[0];
    const open = (await client.query(`SELECT count(*)::int AS n FROM tenant.hr_lifecycle_tasks WHERE employee_id = $1 AND kind = 'offboarding' AND status = 'open'`, [ravi.id])).rows[0].n;
    assert(e.status === "active" && e.last_working_date === null && open === 0, JSON.stringify(e));
    const panel = await ex.getEmployeeExit(client, maker, ravi.id);
    assert(panel.exit.status === "withdrawn" && panel.payrollEligible === true, JSON.stringify(panel.exit.status));
  });
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
