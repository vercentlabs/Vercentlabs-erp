// Finance MVP F1 (Foundation) — Chart of Accounts, fiscal years and periods, checked against a scratch database.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-foundation     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
    fullName: "Finance Owner", email: `fin-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Finance ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const owner = await contextFor(org, registered.userId);
  const member = async (name, slug) => {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, $2, 'x', 'active', now()) RETURNING id`,
      [`${name.toLowerCase().replace(/\W+/g, "-")}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, id]);
    const roleId = (await client.query("SELECT id FROM roles WHERE organization_id = $1 AND slug = $2", [org, slug])).rows[0].id;
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) VALUES ($1, $2, $3, true, 'active')`, [org, id, roleId]);
    return contextFor(org, id);
  };
  const readOnly = await member("Read Only", "read_only");
  const finance = await member("Finance Manager", "finance_manager");
  const chart = async () => (await accounting.listChartOfAccounts(client, owner)).accounts;
  const byCode = async (code) => (await chart()).find((account) => account.code === code);
  const today = (await client.query("SELECT current_date::text AS day")).rows[0].day;
  const journalId = (await client.query("SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND status = 'active' ORDER BY (code = 'GEN') DESC, created_at LIMIT 1", [org])).rows[0].id;

  // ---------------------------------------------------------------- what a new company starts with
  await check("sign-up creates one financial year of twelve contiguous monthly periods", async () => {
    const years = await accounting.listFiscalYears(client, owner);
    assert(years.length === 1, `${years.length} years`);
    const periods = years[0].periods;
    assert(periods.length === 12 && periods.every((period) => period.type === "standard" && period.status === "open"), "12 open standard periods");
    assert(periods[0].startDate === years[0].startDate && periods[11].endDate === years[0].endDate, "periods cover the year");
    for (let index = 1; index < 12; index += 1) {
      const next = new Date(periods[index - 1].endDate); next.setUTCDate(next.getUTCDate() + 1);
      assert(next.toISOString().slice(0, 10) === periods[index].startDate, `gap before ${periods[index].name}`);
    }
    assert(years[0].current, "the current year is flagged");
  });

  await check("the standard chart holds payroll, disposal and common expense accounts; every child sits under a group of its own class", async () => {
    const accounts = await chart();
    for (const code of ["2310", "2320", "2330", "2340", "2350", "4970", "6210", "6220", "6570", "6600", "6610", "6620", "6630", "6640", "6650", "6660", "6670", "6680", "6690"])
      assert(accounts.some((account) => account.code === code), `missing ${code}`);
    const payroll = accounts.filter((account) => ["2310", "2320", "2330", "2340", "2350"].includes(account.code));
    assert(payroll.every((account) => account.controlKind === "payroll" && !account.allowManualPosting && account.manualPostingLocked), "payroll accounts are control accounts");
    const byId = new Map(accounts.map((account) => [account.id, account]));
    for (const account of accounts) {
      if (!account.parentId) continue;
      const parent = byId.get(account.parentId);
      assert(parent?.isGroup && parent.accountClass === account.accountClass, `${account.code} under ${parent?.code}`);
    }
    assert(accounts.find((account) => account.accountType === "receivable")?.controlKind === "receivable", "receivable control");
    const mapped = await client.query("SELECT mapping_key FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND mapping_key = ANY($2) AND status = 'active'",
      [org, ["salary_payable", "salary_expense", "asset_disposal_gain", "asset_disposal_loss"]]);
    assert(mapped.rowCount === 4, `${mapped.rowCount} payroll/disposal mappings`);
  });

  // ---------------------------------------------------------------- creating and editing accounts
  const expenseGroup = (await chart()).find((account) => account.isGroup && account.accountClass === "expense");
  const revenueGroup = (await chart()).find((account) => account.isGroup && account.accountClass === "revenue");
  const posting = (await chart()).find((account) => !account.isGroup && account.accountClass === "expense");
  let travel;
  await check("an expense account is created under an expense group, with the expense normal balance", async () => {
    travel = await accounting.createChartAccount(client, owner, { code: "6740", name: "Travel", accountClass: "expense", accountType: "expense", parentId: expenseGroup.id });
    assert(travel.normalBalance === "debit" && travel.allowManualPosting && travel.parentId === expenseGroup.id && travel.controlKind === null, JSON.stringify(travel));
  });
  await check("the chart refuses a parent of another class, a parent that is not a group, a taken code and a type outside the class", async () => {
    assert((await rejects(() => accounting.createChartAccount(client, owner, { code: "6741", name: "X", accountClass: "expense", accountType: "expense", parentId: revenueGroup.id }), "ACCOUNTING_ACCOUNT_INVALID")).details?.field === "parentId", "class");
    await rejects(() => accounting.createChartAccount(client, owner, { code: "6742", name: "X", accountClass: "expense", accountType: "expense", parentId: posting.id }), "ACCOUNTING_ACCOUNT_INVALID");
    assert((await rejects(() => accounting.createChartAccount(client, owner, { code: "6740", name: "Again", accountClass: "expense", accountType: "expense" }), "ACCOUNTING_ACCOUNT_CODE_TAKEN")).details?.field === "code", "code");
    await rejects(() => accounting.createChartAccount(client, owner, { code: "6743", name: "X", accountClass: "expense", accountType: "bank" }), "ACCOUNTING_ACCOUNT_INVALID");
  });
  await check("a receivable account becomes a control account that refuses manual journals", async () => {
    const assetGroup = (await chart()).find((account) => account.isGroup && account.accountClass === "asset");
    const created = await accounting.createChartAccount(client, owner, { code: "1250", name: "Export receivables", accountClass: "asset", accountType: "receivable", parentId: assetGroup.id, allowManualPosting: true });
    assert(created.controlKind === "receivable" && !created.allowManualPosting, JSON.stringify(created));
    await rejects(() => accounting.updateChartAccount(client, owner, created.id, { allowManualPosting: true }));
  });
  await check("an edit made from a stale copy is refused", async () => {
    await rejects(() => accounting.updateChartAccount(client, owner, travel.id, { name: "Travel and stay", expectedUpdatedAt: "2001-01-01T00:00:00Z" }));
    const saved = await accounting.updateChartAccount(client, owner, travel.id, { name: "Travel and stay", expectedUpdatedAt: travel.updatedAt });
    assert(saved.name === "Travel and stay", saved.name);
  });
  await check("a Read-only user cannot change the chart; a Finance Manager can", async () => {
    await rejects(() => accounting.createChartAccount(client, readOnly, { code: "6750", name: "X", accountClass: "expense", accountType: "expense" }));
    const made = await accounting.createChartAccount(client, finance, { code: "6751", name: "Courier", accountClass: "expense", accountType: "expense", parentId: expenseGroup.id });
    assert(made.code === "6751", "created");
  });
  await check("an unused account can be deleted", async () => {
    const spare = await accounting.createChartAccount(client, owner, { code: "6790", name: "Spare", accountClass: "expense", accountType: "expense", parentId: expenseGroup.id });
    await accounting.deleteChartAccount(client, owner, spare.id);
    assert(!(await byCode("6790")), "gone");
  });
  await check("a group with active accounts under it cannot be deactivated or deleted", async () => {
    await rejects(() => accounting.setChartAccountStatus(client, owner, expenseGroup.id, "inactive"), "ACCOUNTING_ACCOUNT_HAS_CHILDREN");
    await rejects(() => accounting.deleteChartAccount(client, owner, expenseGroup.id));
  });
  await check("an account used by a posting rule cannot be deactivated", async () => {
    const salaries = await byCode("2310");
    await rejects(() => accounting.setChartAccountStatus(client, owner, salaries.id, "inactive"), "ACCOUNTING_ACCOUNT_MAPPED");
  });

  // ---------------------------------------------------------------- history protection, once an account has postings
  const bank = (await chart()).find((account) => account.accountType === "bank" && account.allowManualPosting && account.status === "active");
  await check("a posted journal to Travel shows in its balance, then its type, delete and deactivation are refused", async () => {
    const entry = await accounting.createJournalEntry(client, owner, {
      journalId, accountingDate: today, description: "Taxi", lines: [{ accountId: travel.id, debit: "1500" }, { accountId: bank.id, credit: "1500" }],
    });
    await accounting.postJournalEntry(client, owner, entry.id ?? entry.entry?.id, { allowDraft: true });
    const after = await accounting.getChartAccount(client, owner, travel.id);
    assert(after.balance === 1500 && after.postingCount === 1, `balance ${after.balance}, postings ${after.postingCount}`);
    const group = (await chart()).find((account) => account.id === expenseGroup.id);
    assert(group.balance >= 1500, "the group rolls up its accounts");
    await rejects(() => accounting.updateChartAccount(client, owner, travel.id, { accountType: "other_expense" }));
    await rejects(() => accounting.deleteChartAccount(client, owner, travel.id), "ACCOUNTING_ACCOUNT_HAS_POSTINGS");
    await rejects(() => accounting.setChartAccountStatus(client, owner, travel.id, "inactive"), "ACCOUNTING_ACCOUNT_HAS_BALANCE");
  });
  await check("the database itself refuses a class change, a delete and a cycle on a posted account (the backstop)", async () => {
    await rejects(() => client.query("UPDATE tenant.accounting_accounts SET account_class = 'asset' WHERE id = $1", [travel.id]));
    await rejects(() => client.query("DELETE FROM tenant.accounting_accounts WHERE id = $1", [travel.id]));
    const child = (await chart()).find((account) => account.isGroup && account.parentId === expenseGroup.id)
      ?? await accounting.createChartAccount(client, owner, { code: "6700", name: "Sub group", accountClass: "expense", isGroup: true, parentId: expenseGroup.id });
    await rejects(() => client.query("UPDATE tenant.accounting_accounts SET parent_id = $2 WHERE id = $1", [expenseGroup.id, child.id]));
  });

  // ---------------------------------------------------------------- fiscal years and periods
  await check("the next financial year follows on, with an optional adjustment period; an overlapping year is refused", async () => {
    const [current] = await accounting.listFiscalYears(client, owner);
    const next = await accounting.createFiscalYear(client, owner, { withAdjustmentPeriod: true });
    const start = new Date(current.endDate); start.setUTCDate(start.getUTCDate() + 1);
    assert(next.startDate === start.toISOString().slice(0, 10), `starts ${next.startDate}`);
    assert(next.periods.filter((period) => period.type === "standard").length === 12, "12 months");
    const adjustment = next.periods.find((period) => period.type === "adjustment");
    assert(adjustment && adjustment.number === 13 && adjustment.startDate === next.endDate, "adjustment period on the last day");
    await rejects(() => accounting.createFiscalYear(client, owner, { startDate: current.startDate }), "ACCOUNTING_FY_OVERLAP");
    await rejects(() => accounting.createFiscalYear(client, owner, { startDate: "2040-04-15" }), "ACCOUNTING_FY_INVALID");
    await rejects(() => client.query(`INSERT INTO tenant.accounting_fiscal_years (organization_id, code, name, start_date, end_date) VALUES ($1, 'X', 'X', $2::date + 10, $2::date + 40)`,
      [org, current.startDate]));
  });
  await check("a month in closing review refuses postings with a clear message, and takes them again once reopened", async () => {
    const current = (await accounting.listFiscalYears(client, owner)).find((year) => year.current);
    const month = current.periods.find((period) => period.type === "standard" && period.startDate <= today && today <= period.endDate);
    const reviewed = await accounting.setPeriodReview(client, owner, month.id, { review: true, note: "Month-end review" });
    assert(reviewed.statusKey === "CLOSING_REVIEW" && reviewed.note === "Month-end review", JSON.stringify(reviewed));
    const refused = await rejects(() => accounting.createJournalEntry(client, owner, {
      journalId, accountingDate: today, description: "Late taxi", lines: [{ accountId: travel.id, debit: "100" }, { accountId: bank.id, credit: "100" }],
    }), "ACCOUNTING_PERIOD_CLOSED");
    assert(/closing review/.test(refused.message), refused.message);
    await accounting.setPeriodReview(client, owner, month.id, { review: false });
    await accounting.createJournalEntry(client, owner, {
      journalId, accountingDate: today, description: "Late taxi", lines: [{ accountId: travel.id, debit: "100" }, { accountId: bank.id, credit: "100" }],
    });
  });
  await check("a Read-only user cannot add a year or put a month under review", async () => {
    const [current] = await accounting.listFiscalYears(client, owner);
    await rejects(() => accounting.createFiscalYear(client, readOnly, {}));
    await rejects(() => accounting.setPeriodReview(client, readOnly, current.periods[0].id, { review: true }));
  });

  // ---------------------------------------------------------------- opening cutover check
  await check("the cutover check compares the receivable and payable control accounts with open invoices and bills", async () => {
    const checks = await accounting.getControlAccountReconciliation(client, owner);
    assert(checks.length === 2 && checks.every((row) => row.agrees && row.difference === 0), JSON.stringify(checks));
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
