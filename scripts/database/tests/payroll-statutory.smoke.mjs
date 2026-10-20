// HR & Payroll MVP 38 (statutory deductions and variable pay): statutory rules are verified, versioned families — a draft is never used, its
// author doesn't verify it, a new version ends the old one; payroll computes EPF (ceiling, EPS split), ESI (coverage by the contribution
// period's wage, rounded up), Professional Tax (the employee's state, February's override, the women's exemption) and TDS (new regime: YTD
// from payslips and opening figures, projection, standard deduction, rebate with marginal relief, cess); a missing rule, the old regime and
// surcharge are blocking exceptions, never a guess; variable pay is entered by one person, approved by another, paid once.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:payroll-statutory     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(`file:///${ROOT}services/api/src/${path}`);

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the payroll suite on the live database. Set SMOKE_DATABASE to a scratch database.");
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
    fullName: "Smoke Owner", email: `payroll-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `Payroll ${tag}`, countryCode: "IN", baseCurrency: "INR",
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
  const wf = await api("modules/hr-payroll/workforce.js");
  const comp = await api("modules/hr-payroll/compensation.js");
  const pay = await api("modules/hr-payroll/payroll.js");
  const st = await api("modules/hr-payroll/statutory/index.js");
  const pa = await api("modules/hr-payroll/accounting/index.js");

  // Pay: Basic 40% of CTC (PF wage), the rest special allowance.
  await comp.saveSalaryComponent(client, maker, { code: "BASIC", name: "Basic", componentType: "earning", componentKind: "basic", pfWage: true });
  await comp.saveSalaryComponent(client, maker, { code: "SPECIAL", name: "Special allowance", componentType: "earning" });
  const structure = await comp.createSalaryStructure(client, maker, { code: "STAFF", name: "Staff", lines: [{ componentCode: "BASIC", percentage: 40, percentOf: "CTC" }, { componentCode: "SPECIAL", isBalance: true }] });
  await comp.submitSalaryStructure(client, maker, structure.id);
  await comp.decideSalaryStructure(client, checker, structure.id, { approve: true, note: "" });
  let n = 0;
  const employee = async (first, ctc, statutory, tax, gender = "male") => {
    const e = await wf.saveEmployee(client, maker, { firstName: first, lastName: `Test${++n}`, joiningDate: "2026-09-01", employmentType: "permanent" });
    await wf.completeJoining(client, maker, e.id);
    await client.query(`UPDATE tenant.hr_employees SET statutory_identifiers = $2::jsonb, tax_identifiers = $3::jsonb, gender = $4 WHERE id = $1`, [e.id, JSON.stringify(statutory), JSON.stringify(tax), gender]);
    const proposed = await comp.proposeCompensation(client, maker, { employeeId: e.id, structureId: structure.id, annualCtc: ctc, effectiveFrom: "2026-09-01" });
    await comp.decideCompensation(client, checker, proposed.id, { approve: true, note: "" });
    await client.query(`INSERT INTO tenant.hr_attendance (organization_id, employee_id, attendance_date, status, source, created_by)
      SELECT $1, $2, d::date, 'present', 'manual', $3 FROM generate_series('2026-09-01'::date, '2026-09-30'::date, interval '1 day') d ON CONFLICT DO NOTHING`, [organizationId, e.id, owner.userId]);
    return e;
  };
  const anil = await employee("Anil", 2400000, { pf_applicable: true, pt_state: "MH" }, { pan: "ABCDE1234F", regime: "new" });
  const bina = await employee("Bina", 216000, { pf_applicable: false, pt_state: "MH" }, { pan: "BCDEA2345G", regime: "new" }, "female");
  const chetan = await employee("Chetan", 360000, { pt_state: "KA", esic_applicable: false }, { pan: "CDEAB3456H", regime: "new" });
  const devi = await employee("Devi", 1200000, { esic_applicable: false }, { pan: "DEABC4567J", regime: "old" }, "female");
  await pay.generatePayrollPeriods(client, maker, { year: 2026 });
  const september = (await pay.listPayrollPeriods(client, maker, { year: "2026" })).find((p) => String(p.period_start).startsWith("2026-09"));
  const run = await pay.startPayrollRun(client, maker, { periodId: september.id });
  const slipOf = async (empId) => {
    const slip = (await client.query(`SELECT * FROM tenant.hr_payslips WHERE payroll_run_id = $1 AND employee_id = $2`, [run.id, empId])).rows[0];
    const lines = slip ? (await client.query(`SELECT * FROM tenant.hr_payslip_lines WHERE payslip_id = $1`, [slip.id])).rows : [];
    const get = (code) => lines.find((l) => l.component_code === code);
    return { slip, lines, amount: (code) => Number(get(code)?.amount ?? 0), employer: (code) => Number(get(code)?.employer_amount ?? 0), detail: (code) => get(code)?.rule_detail };
  };
  const exceptionsOf = async (empId) => (await client.query(`SELECT code, severity FROM tenant.hr_payroll_exceptions WHERE payroll_run_id = $1 AND employee_id = $2`, [run.id, empId])).rows;
  const rules = {};

  await check("P1. Rules are verified versions: created as drafts from templates, never used until verified — by someone other than their author, citing what was checked; a draft is edited, an active one isn't", async () => {
    await refused(() => st.createStatutoryRule(client, seller, { template: "EPF", effectiveFrom: "2026-04-01" }), "HR_FORBIDDEN");
    for (const t of ["EPF", "ESI", "PT-MH", "TDS-NEW"]) rules[t] = await st.createStatutoryRule(client, maker, { template: t, effectiveFrom: "2026-04-01" });
    await refused(() => st.createStatutoryRule(client, maker, { statutoryType: "tds", regime: "old", effectiveFrom: "2026-04-01", configuration: {} }), "HR_STATUTORY_UNSUPPORTED");
    await pay.runPayrollCalculation(client, maker, run.id);
    assert((await exceptionsOf(anil.id)).some((x) => x.code === "STATUTORY_RULE_MISSING" && x.severity === "error"), "a draft is not used");
    await refused(() => st.verifyStatutoryRule(client, maker, rules.EPF.id, { note: "EPFO circular" }), "SELF_APPROVAL_BLOCKED");
    await refused(() => st.verifyStatutoryRule(client, checker, rules.EPF.id, {}), "HR_REASON_REQUIRED");
    for (const t of ["EPF", "ESI", "PT-MH", "TDS-NEW"]) await st.verifyStatutoryRule(client, checker, rules[t].id, { note: `Checked against the current ${t} notification` });
    await refused(() => st.updateStatutoryRule(client, maker, rules.EPF.id, { name: "x" }), "HR_STATUTORY_STATE");
    const list = await st.listStatutoryRules(client, maker, { status: "ACTIVE" });
    assert(list.length === 4 && list.every((r) => r.verifiedBy === "Charu HR"), JSON.stringify(list.map((r) => [r.family, r.verifiedBy])));
  });

  await check("P2. Anil (₹24 lakh, Maharashtra, PF): EPF ₹1,800 on the ₹15,000 ceiling with the employer's ₹1,250 EPS and ₹550 EPF, PT ₹200, TDS ₹11,700 a month on the new-regime projection, no ESI above the wage limit", async () => {
    await pay.runPayrollCalculation(client, maker, run.id);
    const s = await slipOf(anil.id);
    assert(Number(s.slip.gross_pay) === 200000, s.slip.gross_pay);
    assert(s.amount("EPF_EE") === 1800 && s.employer("EPS_ER") === 1250 && s.employer("EPF_ER") === 550, JSON.stringify([s.amount("EPF_EE"), s.employer("EPS_ER"), s.employer("EPF_ER")]));
    assert(s.amount("PT") === 200 && s.amount("ESI_EE") === 0, "PT and no ESI");
    const tds = s.detail("TDS");
    assert(s.amount("TDS") === 11700 && tds.remainingMonths === 7 && tds.taxableIncome === 1325000 && tds.total === 81900, JSON.stringify(tds));
    assert(Number(s.slip.net_pay) === 200000 - 1800 - 200 - 11700 && Number(s.slip.employer_contributions) === 1800, s.slip.net_pay);
    assert(s.slip.source_snapshot.statutory.epf.base === 15000, "the working is kept on the payslip");
  });

  await check("P3. Bina (₹18,000 a month): ESI ₹135 + employer ₹585 (rounded up), no PF; PT nil for a woman up to ₹25,000; no TDS below the threshold", async () => {
    const s = await slipOf(bina.id);
    assert(s.amount("ESI_EE") === 135 && s.employer("ESI_ER") === 585 && s.amount("EPF_EE") === 0, JSON.stringify([s.amount("ESI_EE"), s.employer("ESI_ER")]));
    assert(s.amount("PT") === 0 && s.amount("TDS") === 0, "no PT, no TDS");
  });

  await check("P4. A rule not in force is a blocking exception: Chetan works in Karnataka (no active PT-KA); Devi chose the old regime — the payroll can't be submitted until each is dealt with, never with a guessed figure", async () => {
    assert((await exceptionsOf(chetan.id)).some((x) => x.code === "STATUTORY_RULE_MISSING"), "PT-KA missing");
    assert((await exceptionsOf(devi.id)).some((x) => x.code === "TDS_OLD_REGIME"), "old regime");
    await refused(() => pay.submitPayrollRun(client, maker, run.id), "HR_RUN_BLOCKED");
    rules.KA = await st.createStatutoryRule(client, maker, { template: "PT-KA", effectiveFrom: "2026-04-01" });
    await st.verifyStatutoryRule(client, checker, rules.KA.id, { note: "Karnataka PT schedule" });
    const tds = await st.createPayrollInput(client, maker, { employeeId: devi.id, type: "deduction", code: "TDS", amount: 4500, month: "2026-09", description: "TDS under the old regime (Form 12BB)" });
    await st.decidePayrollInput(client, checker, tds.id, { approve: true });
    await pay.runPayrollCalculation(client, maker, run.id);
    assert(!(await exceptionsOf(chetan.id)).some((x) => x.severity === "error") && !(await exceptionsOf(devi.id)).some((x) => x.severity === "error"), "resolved");
    assert((await slipOf(chetan.id)).amount("PT") === 200 && (await slipOf(devi.id)).amount("TDS") === 4500, "PT-KA and the manual TDS");
  });

  await check("P5. Variable pay: entered by one person and approved by another, a rejection needs its reason, it is paid by its month's run (taxable, so TDS rises) and released when the run is recalculated without it; a used item isn't cancelled", async () => {
    const bonus = await st.createPayrollInput(client, maker, { employeeId: anil.id, type: "bonus", amount: 10000, month: "2026-09", description: "Festival bonus" });
    await refused(() => st.decidePayrollInput(client, maker, bonus.id, { approve: true }), "SELF_APPROVAL_BLOCKED");
    const odd = await st.createPayrollInput(client, maker, { employeeId: anil.id, type: "allowance", amount: 999, month: "2026-09", description: "Typo" });
    await refused(() => st.decidePayrollInput(client, checker, odd.id, { approve: false }), "HR_REASON_REQUIRED");
    await st.decidePayrollInput(client, checker, odd.id, { approve: false, note: "Not agreed" });
    await st.decidePayrollInput(client, checker, bonus.id, { approve: true });
    await pay.runPayrollCalculation(client, maker, run.id);
    const s = await slipOf(anil.id);
    assert(s.amount("BONUS") === 10000 && Number(s.slip.gross_pay) === 210000 && s.amount("TDS") > 11700, JSON.stringify([s.amount("BONUS"), s.amount("TDS")]));
    const used = (await client.query(`SELECT payroll_run_id FROM tenant.hr_payroll_inputs WHERE id = $1`, [bonus.id])).rows[0];
    assert(used.payroll_run_id === run.id, "the run is recorded");
    await refused(() => st.cancelPayrollInput(client, maker, bonus.id, { reason: "x" }), "HR_INPUT_STATE");
    assert(!(await slipOf(anil.id)).lines.some((l) => l.component_code === "ALLOWANCE"), "the rejected item isn't paid");
  });

  await check("P6. Opening year-to-date pay (a previous employer this year) raises the projection and counts the tax already deducted", async () => {
    await refused(() => st.saveYtdOpening(client, seller, { employeeId: anil.id, financialYear: "2026-27", gross: 1, taxable: 1, tds: 0 }), "HR_FORBIDDEN");
    await st.saveYtdOpening(client, maker, { employeeId: anil.id, financialYear: "2026-27", source: "PREVIOUS_EMPLOYER", employerName: "Old Co", gross: 500000, taxable: 500000, tds: 30000 });
    await pay.runPayrollCalculation(client, maker, run.id);
    const tds = (await slipOf(anil.id)).detail("TDS");
    assert(tds.ytdTaxable === 500000 && tds.ytdTds === 30000 && tds.projected === 500000 + 210000 * 7, JSON.stringify(tds));
    assert((await st.listYtdOpenings(client, maker, { financialYear: "2026-27" })).length === 1, "listed");
  });

  await check("P7. Versions over time: a verified new version ends the previous one the day before it starts; February's Maharashtra override (₹300); the rebate and its marginal relief at ₹12 lakh", async () => {
    const v2 = await st.createStatutoryRule(client, maker, { template: "PT-MH", effectiveFrom: "2027-01-01" });
    await st.verifyStatutoryRule(client, checker, v2.id, { note: "Same schedule, re-verified for 2027" });
    const versions = (await st.listStatutoryRules(client, maker)).filter((r) => r.family === "PT-MH");
    assert(versions.find((r) => r.version === 1).effectiveTo && String(versions.find((r) => r.version === 1).effectiveTo).startsWith("2026-12-31"), JSON.stringify(versions.map((r) => [r.version, r.effectiveTo])));
    const emp = (await client.query(`SELECT * FROM tenant.hr_employees WHERE id = $1`, [anil.id])).rows[0];
    const feb = await st.computeStatutory(client, owner, { emp, run: { id: randomUUID(), period_start: "2027-02-01", period_end: "2027-02-28" },
      lines: [{ code: "BASIC", type: "earning", amount: 80000, taxable: 80000, pfWage: true }, { code: "SPECIAL", type: "earning", amount: 120000, taxable: 120000 }] });
    assert(feb.lines.find((l) => l.code === "PT").amount === 300 && feb.detail.pt.rule === "PT-MH v2", JSON.stringify(feb.detail.pt));
    const cfg = st.PAYROLL_STATUTORY_TEMPLATES["TDS-NEW"].configuration;
    assert(st.incomeTax(cfg, 1200000).total === 0, "rebate up to ₹12 lakh");
    const relief = st.incomeTax(cfg, 1210000);
    assert(relief.tax === 10000 && relief.total === 10400, JSON.stringify(relief));
    assert(st.incomeTax(cfg, 1600000).total === Math.round(120000 * 1.04), "no rebate above the limit");
  });

  await check("P8. The run goes on: submitted once nothing blocks, approved by someone else; the calculation is deterministic; another approver's view of the payslip keeps the statutory working", async () => {
    await pay.submitPayrollRun(client, maker, run.id);
    await pay.decidePayrollRun(client, checker, run.id, { approve: true, note: "" });
    const verified = await pay.verifyPayrollDeterminism(client, checker, run.id);
    assert(verified && (verified.deterministic ?? verified.matches ?? verified.ok) !== false, JSON.stringify(verified));
    const s = await slipOf(anil.id);
    assert(s.slip.status === "approved" && s.detail("EPF_EE").rule === "EPF v1", "approved with its rule versions");
  });

  // ---- MVP 39: posting, payments, statutory deposits, closing, reports.
  const bank = (await client.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND NOT is_group AND control_kind = 'bank' AND status = 'active' ORDER BY code LIMIT 1`, [organizationId])).rows[0];
  const posting = async (runId) => (await client.query(`SELECT * FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = 'payroll_run' AND source_id = $2 AND status = 'POSTED'`, [organizationId, runId])).rows[0];
  const credited = async (entryId, key) => Number((await client.query(`SELECT COALESCE(sum(l.base_credit_amount), 0) AS q FROM tenant.accounting_journal_lines l
    JOIN tenant.accounting_account_mappings m ON m.account_id = l.account_id AND m.organization_id = l.organization_id AND m.mapping_key = $2 AND m.status = 'active' WHERE l.journal_entry_id = $1`, [entryId, key])).rows[0].q);
  const runRow = async (id) => (await client.query(`SELECT * FROM tenant.hr_payroll_runs WHERE id = $1`, [id])).rows[0];
  let live = run;
  await check("P9. Posting to Finance: no payment before posting; one journal (net pay to salaries payable, TDS / EPF / ESI / PT to their payables) posted once; unposting reverses it and cancels the run, and the corrected payroll is a new run", async () => {
    await refused(() => pa.recordSalaryPayment(client, checker, run.id, { paymentDate: "2026-09-30", paidFromAccountId: bank.id }), "HR_RUN_STATE");
    await refused(() => pa.postPayrollRunToFinance(client, seller, run.id, {}), "HR_FORBIDDEN");
    const posted = await pa.postPayrollRunToFinance(client, checker, run.id, { postingDate: "2026-09-30" });
    const again = await pa.postPayrollRunToFinance(client, checker, run.id, {});
    assert(posted.status === "posted" && again.replayed, JSON.stringify(posted));
    const entry = (await posting(run.id)).journal_entry_id;
    assert(await credited(entry, "salary_payable") === Number((await runRow(run.id)).net_pay), "net pay owed");
    const anilSlip = await slipOf(anil.id);
    assert(await credited(entry, "epf_payable") === anilSlip.amount("EPF_EE") + anilSlip.employer("EPF_ER") + anilSlip.employer("EPS_ER") && await credited(entry, "pt_payable") > 0, "statutory payables");
    const undone = await pa.unpostPayrollRun(client, checker, run.id, { reason: "Wrong bonus month" });
    assert(undone.status === "cancelled" && !(await posting(run.id)), "reversed and cancelled");
    live = await pay.startPayrollRun(client, maker, { periodId: september.id });
    await pay.runPayrollCalculation(client, maker, live.id);
    await pay.submitPayrollRun(client, maker, live.id);
    await pay.decidePayrollRun(client, checker, live.id, { approve: true, note: "" });
    await pa.postPayrollRunToFinance(client, checker, live.id, { postingDate: "2026-09-30" });
    assert(/-R2$/.test(live.payroll_number) && (await posting(live.id)), live.payroll_number);
  });

  await check("P10. Paying salaries: payslips published; a partial payment, a bank's rejection marked on one payslip, then the rest — each payment posts once, never more than owed; posted → partially paid → paid → closed; variable pay marked paid", async () => {
    const published = await pa.publishPayslips(client, checker, live.id);
    assert(published.published === 4, JSON.stringify(published));
    const slips = (await client.query(`SELECT * FROM tenant.hr_payslips WHERE payroll_run_id = $1 ORDER BY payslip_number`, [live.id])).rows;
    const [first, second] = slips;
    await refused(() => pa.recordSalaryPayment(client, checker, live.id, { paymentDate: "2026-09-30", paidFromAccountId: bank.id, payslipIds: [first.id], amounts: { [first.id]: Number(first.net_pay) + 1 } }), "HR_PAYMENT_INVALID");
    const part = await pa.recordSalaryPayment(client, checker, live.id, { paymentDate: "2026-09-30", paidFromAccountId: bank.id, payslipIds: [first.id], amounts: { [first.id]: 1000 }, idempotencyKey: `p-${tag}` });
    const replay = await pa.recordSalaryPayment(client, checker, live.id, { paymentDate: "2026-09-30", paidFromAccountId: bank.id, payslipIds: [first.id], amounts: { [first.id]: 1000 }, idempotencyKey: `p-${tag}` });
    assert(part.runStatus === "partially_paid" && replay.replayed, JSON.stringify(part));
    await pa.markPaymentException(client, checker, second.id, { reason: "Bank rejected: account closed" });
    assert((await client.query(`SELECT payment_status FROM tenant.hr_payslips WHERE id = $1`, [second.id])).rows[0].payment_status === "PAYMENT_EXCEPTION", "exception");
    await refused(() => pa.closePayrollRun(client, checker, live.id), "HR_RUN_STATE");
    const rest = await pa.recordSalaryPayment(client, checker, live.id, { paymentDate: "2026-10-01", paidFromAccountId: bank.id, reference: "NEFT batch 77" });
    assert(rest.runStatus === "paid", JSON.stringify(rest));
    const paidEntries = (await client.query(`SELECT count(*)::int AS n FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = 'salary_payment' AND status = 'POSTED'`, [organizationId])).rows[0].n;
    assert(paidEntries === 2, String(paidEntries));
    await pa.closePayrollRun(client, checker, live.id);
    assert((await runRow(live.id)).status === "closed", "closed");
    assert((await client.query(`SELECT status FROM tenant.hr_payroll_inputs WHERE employee_id = $1 AND input_type = 'bonus'`, [anil.id])).rows[0].status === "paid", "variable pay paid");
  });

  await check("P11. Statutory deposits: a month's EPF challan is limited to what its payrolls owe, posts once, and its number isn't reused for the same kind", async () => {
    const owed = await pa.statutoryOwed(client, owner, "epf", "2026-09-01");
    assert(owed.due > 0 && owed.paid === 0, JSON.stringify(owed));
    await refused(() => pa.recordStatutoryPayment(client, checker, { kind: "epf", month: "2026-09", challanNumber: "TRRN-1", paymentDate: "2026-10-15", paidFromAccountId: bank.id, amount: owed.due + 1 }), "HR_PAYMENT_EXCEEDS_DUE");
    const paid = await pa.recordStatutoryPayment(client, checker, { kind: "epf", month: "2026-09", challanNumber: "TRRN-1", paymentDate: "2026-10-15", paidFromAccountId: bank.id });
    assert(paid.amount === owed.due && paid.outstanding === 0, JSON.stringify(paid));
    await refused(() => pa.recordStatutoryPayment(client, checker, { kind: "epf", month: "2026-09", challanNumber: "TRRN-2", paymentDate: "2026-10-15", paidFromAccountId: bank.id, amount: 1 }), "HR_PAYMENT_EXCEEDS_DUE");
    const tdsOwed = await pa.statutoryOwed(client, owner, "tds", "2026-09-01");
    await pa.recordStatutoryPayment(client, checker, { kind: "tds", month: "2026-09", challanNumber: "ITNS281-9", paymentDate: "2026-10-07", paidFromAccountId: bank.id, amount: tdsOwed.outstanding });
    await refused(() => pa.recordStatutoryPayment(client, checker, { kind: "tds", month: "2026-09", challanNumber: "ITNS281-9", paymentDate: "2026-10-07", paidFromAccountId: bank.id, amount: 1 }));
  });

  await check("P12. The ten payroll reports: register, payslips, attendance/LWP, leave balances, payments (nothing outstanding), TDS / EPF / ESI / PT summaries, and payroll-to-GL agreeing with the journal", async () => {
    for (const kind of Object.keys(pa.PAYROLL_REPORTS)) assert(Array.isArray((await pa.getPayrollReport(client, checker, kind, { from: "2026-09", to: "2026-09" })).rows), kind);
    const gl = (await pa.getPayrollReport(client, checker, "gl", { from: "2026-09", to: "2026-09" })).rows;
    assert(gl.some((r) => r.payroll === live.payroll_number && r.reconciliation === "Agrees"), JSON.stringify(gl));
    const payments = (await pa.getPayrollReport(client, checker, "payments", { from: "2026-09", to: "2026-09" })).rows.find((r) => r.payroll === live.payroll_number);
    assert(payments && Number(payments.outstanding) === 0, JSON.stringify(payments));
    const tds = (await pa.getPayrollReport(client, checker, "tds", { from: "2026-09", to: "2026-09" })).rows;
    assert(tds.some((r) => Number(r.tds) > 11700), JSON.stringify(tds));
    const csv = await pa.exportPayrollReport(client, checker, "epf", { from: "2026-09", to: "2026-09" });
    assert(csv.body.split("\n")[0].includes("employee_epf"), csv.body.split("\n")[0]);
    await refused(() => pa.getPayrollReport(client, seller, "payroll_register"), "HR_FORBIDDEN");
  });
} finally {
  await client.query("ROLLBACK").catch(() => null);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed (transaction rolled back: the database is unchanged)`);
if (failures.length) process.exitCode = 1;
