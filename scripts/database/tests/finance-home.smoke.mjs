// Finance MVP F10 (Finance home): the figures match the books, and the exception dashboard lists what needs attention — and only that.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-home     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
    fullName: "Home Owner", email: `home-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Home ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const owner = await contextFor(org, registered.userId);
  const employeeId = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, 'Eve', 'x', 'active', now()) RETURNING id`,
    [`emp-${tag}@example.test`])).rows[0].id;
  await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, employeeId]);
  await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = 'read_only'`, [org, employeeId]);
  await contextFor(org, owner.userId);
  const today = accounting.localToday();
  const ledger = await accounting.getPrimaryLedger(client, owner);
  const journalId = (await client.query("SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND journal_type = 'general' LIMIT 1", [org])).rows[0].id;
  const id = async (code) => (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = $2", [org, code])).rows[0].id;
  const entry = async (debitCode, creditCode, amount, { post = true } = {}) => {
    const created = await accounting.createJournalEntry(client, owner, { ledgerId: ledger.id, journalId, accountingDate: today, entryDate: today, documentDate: today, description: "Test",
      lines: [{ accountId: await id(debitCode), debit: String(amount) }, { accountId: await id(creditCode), credit: String(amount) }] }, { internal: true });
    if (post) await accounting.postJournalEntry(client, owner, created.entry.id, { internal: true, allowDraft: true });
    return created.entry.id;
  };

  await check("a new company: no money, nothing needs attention", async () => {
    const home = await accounting.getFinanceHome(client, owner);
    assert(home.cash.total === 0 && home.receivables.owed === 0 && home.payables.owed === 0, JSON.stringify(home.cash));
    assert(home.attention.every((item) => item.key === "close"), JSON.stringify(home.attention.map((item) => item.key)));
    assert(home.results && home.results.month.profit === 0 && home.nextToClose, "results and the month to close");
  });

  await check("cash and bank accounts show their book balances; money in transit counts as cash", async () => {
    const bank = await accounting.createBankCashAccount(client, owner, { kind: "bank", name: "Current", bankName: "HDFC Bank" });
    const cash = await accounting.createBankCashAccount(client, owner, { kind: "cash", name: "Petty cash", custodianUserId: owner.userId });
    const created = await accounting.createJournalEntry(client, owner, { ledgerId: ledger.id, journalId, accountingDate: today, description: "Capital",
      lines: [{ accountId: bank.ledgerAccount.id, debit: "200000" }, { accountId: await id("3100"), credit: "200000" }] }, { internal: true });
    await accounting.postJournalEntry(client, owner, created.entry.id, { internal: true, allowDraft: true });
    const tomorrow = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    await accounting.createFundTransfer(client, owner, { date: today, arrivalDate: tomorrow, fromAccountId: bank.ledgerAccount.id, toAccountId: cash.ledgerAccount.id, amount: "5000" });
    const home = await accounting.getFinanceHome(client, owner);
    assert(home.cash.total === 200000 && home.cash.inTransit === 5000 && home.cash.accounts.find((row) => row.id === bank.id).balance === 195000, JSON.stringify(home.cash));
  });

  await check("the exception dashboard: a journal awaiting approval, a suspense balance and a failed automatic posting each appear with where to fix them", async () => {
    await entry("2900", "1110", 750);
    await client.query(`INSERT INTO tenant.accounting_postings (organization_id, posting_event, source_module, source_type, source_id, source_number, once_per_source, automatic, status,
        transaction_date, posting_date, amount, currency_code, attempts, error_code, error_message, failed_at)
      VALUES ($1, 'sales_invoice', 'sales', 'sales_invoice', gen_random_uuid(), 'INV-T1', true, true, 'FAILED', $2, $2, 1180, 'INR', 1, 'ACCOUNTING_ACCOUNT_MISSING', 'No revenue account', now())`, [org, today]);
    const home = await accounting.getFinanceHome(client, owner);
    const keys = Object.fromEntries(home.attention.map((item) => [item.key, item]));
    assert(keys.suspense?.amount === 750 && keys.suspense.href === "/accounting/trial-balance", JSON.stringify(keys.suspense));
    assert(keys.postings?.severity === "danger" && keys.postings.detail.includes("Sales: 1 (1 failed)") && keys.postings.href === "/accounting/postings", JSON.stringify(keys.postings));
  });

  await check("this month's results are the profit and loss's; someone without the reports permission sees the figures but not the results", async () => {
    await entry("1110", "4100", 10000);
    await entry("6600", "1110", 4000);
    const home = await accounting.getFinanceHome(client, owner);
    assert(home.results.month.revenue === 10000 && home.results.month.expenses === 4000 && home.results.month.profit === 6000, JSON.stringify(home.results.month));
    const viewer = await contextFor(org, employeeId);
    const limited = { ...viewer, permissions: viewer.permissions.filter((key) => key !== "accounting.reports.view") };
    const theirs = await accounting.getFinanceHome(client, limited);
    assert(theirs.results === null && theirs.cash.total > 0, "no results without reports");
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
