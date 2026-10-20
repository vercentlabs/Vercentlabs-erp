// Finance MVP F3 (posting engine): payroll postings and the module-to-GL checks, against a scratch database.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-postings     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { randomUUID } from "node:crypto";
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
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the Finance suite on the live database. Set SMOKE_DATABASE to a scratch database.");
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
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 4).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function rejects(work, code) {
  await client.query("SAVEPOINT smoke_reject");
  try { await work(); } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT smoke_reject");
    if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  await client.query("RELEASE SAVEPOINT smoke_reject");
  throw new Error(`expected rejection ${code ?? ""}`);
}

const { registerOrganization } = await api("core/organization/registration.js");
const accounting = await api("modules/accounting/index.js");

async function contextFor(organizationId, userId) {
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
  const { rows } = await client.query(
    `SELECT COALESCE(array_agg(DISTINCT role.slug) FILTER (WHERE role.slug IS NOT NULL), ARRAY[]::text[]) AS role_slugs,
            COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id AND role.status = 'active'
       LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
      WHERE assignment.organization_id = $1 AND assignment.user_id = $2 AND assignment.status = 'active'`, [organizationId, userId]);
  return { organizationId, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions };
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const tag = Math.random().toString(16).slice(2, 10);
  const registered = await registerOrganization(client, {
    fullName: "Payroll Owner", email: `pst-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Postings ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const owner = await contextFor(org, registered.userId);
  const readOnlyId = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, 'Viewer', 'x', 'active', now()) RETURNING id`,
    [`viewer-${tag}@example.test`])).rows[0].id;
  await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, readOnlyId]);
  await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = 'read_only'`, [org, readOnlyId]);
  const viewer = await contextFor(org, readOnlyId);
  await contextFor(org, owner.userId);
  const today = accounting.localToday();
  const sales = (await client.query("INSERT INTO public.departments (organization_id, name, code, status) VALUES ($1, 'Sales', 'SAL', 'active') RETURNING id", [org])).rows[0].id;
  const ops = (await client.query("INSERT INTO public.departments (organization_id, name, code, status) VALUES ($1, 'Operations', 'OPS', 'active') RETURNING id", [org])).rows[0].id;
  const accountBy = async (where, values = []) => (await client.query(`SELECT id, code FROM tenant.accounting_accounts WHERE organization_id = $1 AND NOT is_group AND ${where} ORDER BY code LIMIT 1`, [org, ...values])).rows[0];
  const bank = await accountBy("control_kind = 'bank'");
  const rent = await accountBy("code = '6600'");
  const advances = await accountBy("account_class = 'asset' AND control_kind IS NULL");
  const mapped = async (key) => (await client.query("SELECT account_id FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND mapping_key = $2 AND status = 'active' LIMIT 1", [org, key])).rows[0].account_id;
  const balance = async (accountId) => Number((await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS b FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed') WHERE line.organization_id = $1 AND line.account_id = $2`,
    [org, accountId])).rows[0].b);
  const run = (overrides = {}) => ({
    payrollRunId: overrides.payrollRunId ?? randomUUID(), number: overrides.number ?? "PAY-2026-10", postingDate: today, period: "Oct 2026",
    lines: [{ departmentId: sales, gross: "400000", employerEpf: "28800", employerEsi: "0" }, { departmentId: ops, gross: "100000", employerEpf: "7200", employerEsi: "3250" }],
    deductions: { tds: "25000", employeeEpf: "36000", employeeEsi: "750", pt: "1000" }, otherDeductions: [{ accountId: advances.id, amount: "5000", description: "Salary advance recovered" }],
    netPay: "432250", ...overrides,
  });

  await check("the catalogue lists the payroll events and the Payroll and Fixed assets posting accounts, all chosen for a new company", async () => {
    const coverage = await accounting.getPostingCoverage(client, owner);
    for (const key of ["payroll_run", "salary_payment", "statutory_payment"]) assert(coverage.some((row) => row.postingEvent === key && row.module === "Payroll"), key);
    const list = await accounting.listPostingAccounts(client, owner);
    const payroll = list.items.filter((item) => item.group === "Payroll");
    assert(payroll.length === 7 && payroll.every((item) => item.state === "ok"), JSON.stringify(payroll.map((item) => [item.key, item.state])));
    assert(list.items.some((item) => item.group === "Fixed assets" && item.key === "asset_disposal_gain" && item.state === "ok"), "disposal gain default");
    assert(list.items.find((item) => item.key === "withholding_tax").label === "TDS payable (suppliers)", "supplier TDS is told apart from salary TDS");
  });

  let posted;
  const runId = randomUUID();
  await check("a payroll run posts once: gross by department, employer contributions, and net pay, TDS, EPF, ESI, PT and the advance owed", async () => {
    const journal = await accounting.postPayrollRun(client, owner, run({ payrollRunId: runId }), { internal: true });
    posted = journal;
    assert(journal.entry.status === "posted", journal.entry.status);
    const lines = journal.lines;
    const debit = (accountId, departmentId) => lines.filter((line) => line.account_id === accountId && (!departmentId || line.department_id === departmentId)).reduce((t, l) => t + Number(l.debit_amount), 0);
    const credit = (accountId) => lines.filter((line) => line.account_id === accountId).reduce((t, l) => t + Number(l.credit_amount), 0);
    assert(debit(await mapped("salary_expense"), sales) === 400000 && debit(await mapped("salary_expense"), ops) === 100000, "gross by department");
    assert(debit(await mapped("employer_contribution_expense")) === 39250, "employer EPF + ESI");
    assert(credit(await mapped("salary_payable")) === 432250, "net pay");
    assert(credit(await mapped("tds_payable")) === 25000 && credit(await mapped("pt_payable")) === 1000, "TDS and PT");
    assert(credit(await mapped("epf_payable")) === 72000 && credit(await mapped("esi_payable")) === 4000, "EPF and ESI both shares");
    assert(credit(advances.id) === 5000, "advance recovered");
    const posting = (await client.query("SELECT status, source_module FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = 'payroll_run' AND source_id = $2", [org, runId])).rows[0];
    assert(posting.status === "POSTED" && posting.source_module === "payroll", JSON.stringify(posting));
  });

  await check("the same run can't post twice; a run whose deductions don't add up is refused, never plugged", async () => {
    await rejects(() => accounting.postPayrollRun(client, owner, run({ payrollRunId: runId }), { internal: true }), "ACCOUNTING_DUPLICATE_POSTING");
    const error = await rejects(() => accounting.postPayrollRun(client, owner, run({ netPay: "432249" }), { internal: true }), "ACCOUNTING_PAYROLL_UNBALANCED");
    assert(/out by 1\.0+/.test(error.message), error.message);
    await rejects(() => accounting.postPayrollRun(client, owner, run({ deductions: { tds: "-5" } }), { internal: true }), "ACCOUNTING_PAYROLL_INVALID");
  });

  await check("a missing payroll account stops the posting with a plain message naming it", async () => {
    await client.query("UPDATE tenant.accounting_account_mappings SET status = 'inactive' WHERE organization_id = $1 AND mapping_key = 'pt_payable'", [org]);
    const error = await rejects(() => accounting.postPayrollRun(client, owner, run(), { internal: true }));
    assert(/professional tax payable/i.test(error.message), error.message);
    await client.query("UPDATE tenant.accounting_account_mappings SET status = 'active' WHERE organization_id = $1 AND mapping_key = 'pt_payable'", [org]);
  });

  await check("a person posts payroll only with the journal-posting permission", async () => {
    await rejects(() => accounting.postPayrollRun(client, viewer, run()));
    await contextFor(org, owner.userId);
    const journal = await accounting.postPayrollRun(client, owner, run({ number: "PAY-2026-10-B" }));
    assert(journal.entry.status === "posted", "owner may post");
  });

  await check("salaries are paid from a bank account (never an expense account) and the payable falls to zero", async () => {
    await rejects(() => accounting.postSalaryPayment(client, owner, { paymentId: randomUUID(), number: "SAL-PAY-1", paymentDate: today, amount: "432250", paidFromAccountId: rent.id }, { internal: true }),
      "ACCOUNTING_PAYROLL_INVALID");
    await accounting.postSalaryPayment(client, owner, { paymentId: randomUUID(), number: "SAL-PAY-1", paymentDate: today, amount: "432250", paidFromAccountId: bank.id, payrollRunNumber: "PAY-2026-10" },
      { internal: true });
    assert(await balance(await mapped("salary_payable")) === -432250, "the second run (PAY-2026-10-B) is still owed");
  });

  await check("statutory dues are paid by challan: EPF payable falls by the amount paid; an unknown kind is refused", async () => {
    const epf = await mapped("epf_payable");
    const before = await balance(epf);
    await accounting.postStatutoryPayment(client, owner, { paymentId: randomUUID(), number: "EPF-CHLN-2210", kind: "epf", paymentDate: today, amount: "72000", paidFromAccountId: bank.id }, { internal: true });
    assert(await balance(epf) === before + 72000, `EPF ${before} → ${await balance(epf)}`);
    await rejects(() => accounting.postStatutoryPayment(client, owner, { paymentId: randomUUID(), number: "X", kind: "gst", paymentDate: today, amount: "1", paidFromAccountId: bank.id }, { internal: true }),
      "ACCOUNTING_PAYROLL_INVALID");
  });

  await check("a payroll posting is corrected by reversal, then the revised run posts as its own revision (the original can't be journalled again)", async () => {
    await accounting.reversePayrollPosting(client, owner, { event: "payroll_run", sourceId: runId, reason: "Wrong attendance for Operations" }, { internal: true });
    const posting = (await client.query("SELECT status FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = 'payroll_run' AND source_id = $2 ORDER BY created_at", [org, runId])).rows;
    assert(posting[0].status === "REVERSED", posting[0].status);
    await rejects(() => accounting.postPayrollRun(client, owner, run({ payrollRunId: runId, number: "PAY-2026-10" }), { internal: true }), "ACCOUNTING_PAYROLL_REVERSED");
    const again = await accounting.postPayrollRun(client, owner, run({ payrollRunId: randomUUID(), number: "PAY-2026-10 rev 2" }), { internal: true });
    assert(again.entry.status === "posted" && again.entry.id !== posted.entry.id, "re-posted");
    await rejects(() => accounting.reversePayrollPosting(client, viewer, { event: "payroll_run", sourceId: runId, reason: "No" }));
    await contextFor(org, owner.userId);
  });

  await check("sub-ledgers vs books: customers and suppliers agree; payroll dues are listed; stock and GRNI are 'not used' without perpetual inventory", async () => {
    const books = await accounting.getModuleReconciliation(client, owner);
    const of = (key) => books.checks.find((entry) => entry.key === key);
    assert(of("receivable").status === "ok" && of("payable").status === "ok", "parties agree");
    assert(of("stock").status === "not_applicable" && of("grni").status === "not_applicable", `${of("stock").status} ${of("grni").status}`);
    assert(of("assets").status === "ok" && of("assets").count === 0, "no asset event lacks an entry");
    const dues = of("payroll");
    assert(dues.status === "info" && dues.items.some((item) => item.label === "TDS on salaries" && item.amount === 50000), JSON.stringify(dues.items));
    assert(books.agree === true, "everything agrees");
    const viewerBooks = await accounting.getModuleReconciliation(client, viewer);
    assert(viewerBooks.checks.length === books.checks.length, "a viewer reads the checks");
    await contextFor(org, owner.userId);
  });

  await check("asset disposal: a category without its own gain / loss accounts uses the company's defaults", async () => {
    const { disposalAccountsFor } = await api("modules/assets/asset-disposal/dx-commands.js");
    const accounts = await disposalAccountsFor(client, { id: randomUUID(), category_id: randomUUID(), organization_id: org });
    assert(accounts.gainLoss === await mapped("asset_disposal_gain") && accounts.loss === await mapped("asset_disposal_loss"), JSON.stringify(accounts));
    assert(accounts.asset === null, "the asset account itself has no default");
  });

  await check("with perpetual inventory, stock is compared with the inventory accounts, and an entry booked to inventory with no stock behind it shows as a difference", async () => {
    await client.query(`INSERT INTO tenant.procurement_settings (organization_id, post_receipt_accrual) VALUES ($1, true)
                        ON CONFLICT (organization_id) DO UPDATE SET post_receipt_accrual = true`, [org]);
    let books = await accounting.getModuleReconciliation(client, owner);
    const stock = () => books.checks.find((entry) => entry.key === "stock");
    assert(stock().status === "ok" && stock().ledger === 0 && stock().subledger === 0, JSON.stringify(stock()));
    assert(books.checks.find((entry) => entry.key === "grni").status === "ok", "GRNI agrees at nil");
    const inventory = await accountBy("control_kind = 'inventory' AND code = '1300'");
    const ledger = await accounting.getPrimaryLedger(client, owner);
    const journalId = (await client.query("SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND journal_type = 'general' LIMIT 1", [org])).rows[0].id;
    const entry = await accounting.createJournalEntry(client, owner, { ledgerId: ledger.id, journalId, accountingDate: today, description: "Stray stock entry",
      lines: [{ accountId: inventory.id, debit: "1500" }, { accountId: bank.id, credit: "1500" }] }, { internal: true });
    await accounting.postJournalEntry(client, owner, entry.entry.id, { internal: true, allowDraft: true });
    books = await accounting.getModuleReconciliation(client, owner);
    assert(stock().status === "difference" && stock().difference === 1500 && books.agree === false, JSON.stringify(stock()));
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
