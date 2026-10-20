// Finance MVP F8 (Statements): trial balance, profit and loss, balance sheet and cash flow — each adds up, and says so when it doesn't.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-statements     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
    fullName: "Statements Owner", email: `stm-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Statements ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const owner = await contextFor(org, registered.userId);
  const employeeId = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, 'Eve Employee', 'x', 'active', now()) RETURNING id`,
    [`emp-${tag}@example.test`])).rows[0].id;
  await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, employeeId]);
  await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = 'employee'`, [org, employeeId]);
  await contextFor(org, owner.userId);
  const today = accounting.localToday();
  const year = (await client.query("SELECT start_date::text AS start FROM tenant.accounting_fiscal_years WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date", [org, today])).rows[0];
  const fyStart = year.start;
  const shift = (days) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  // The month before this one, within this financial year where possible.
  const ledger = await accounting.getPrimaryLedger(client, owner);
  const journalId = (await client.query("SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND journal_type = 'general' LIMIT 1", [org])).rows[0].id;
  const id = async (code) => (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = $2", [org, code])).rows[0].id;
  const linesOf = async (lines) => {
    const out = [];
    for (const [code, debit, credit] of lines) out.push({ accountId: await id(code), debit: debit ? String(debit) : "0", credit: credit ? String(credit) : "0" });
    return out;
  };
  const post = async (date, lines, extra = {}, options = {}) => {
    const created = await accounting.createJournalEntry(client, owner, { ledgerId: ledger.id, journalId, accountingDate: date, entryDate: date, documentDate: date, description: extra.description ?? "Test",
      entryType: extra.entryType, lines: await linesOf(lines) },
      { internal: true, ...options });
    await accounting.postJournalEntry(client, owner, created.entry.id, { internal: true, allowDraft: true });
    return created.entry.id;
  };
  // A small company's books, all dated in this financial year (the first few days, so they fall before "today").
  const d = (n) => { const x = new Date(`${fyStart}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); const iso = x.toISOString().slice(0, 10); return iso > today ? today : iso; };
  await post(d(0), [["1120", 500000], ["3100", 0, 500000]], { description: "Capital introduced" });
  await post(d(1), [["1120", 200000], ["2500", 0, 200000]], { description: "Term loan received" });
  await post(d(2), [["1500", 150000], ["1120", 0, 150000]], { description: "Machine bought" });
  await post(d(3), [["1200", 118000], ["4100", 0, 100000], ["2211", 0, 9000], ["2212", 0, 9000]], { description: "Sale on credit" });
  await post(d(4), [["5000", 40000], ["1300", 0, 40000]], { description: "Cost of the goods sold" });
  await post(d(4), [["1300", 90000], ["2100", 0, 90000]], { description: "Stock bought on credit" });
  await post(d(5), [["1120", 60000], ["1200", 0, 60000]], { description: "Customer paid part" });
  await post(d(5), [["6600", 20000], ["1120", 0, 20000]], { description: "Rent" });
  await post(d(6), [["6100", 5000], ["1110", 0, 5000]], { description: "Sundry" });
  await post(d(6), [["1110", 30000], ["1120", 0, 30000]], { description: "Cash withdrawn for the office" });
  await post(d(7), [["1120", 2000], ["4900", 0, 2000]], { description: "Interest received" });
  await post(d(7), [["6400", 500], ["1120", 0, 500]], { description: "Bank charges" });
  await post(d(8), [["6300", 2500], ["1590", 0, 2500]], { description: "Depreciation" }, { sourceModule: "assets", sourceType: "asset_depreciation_run", sourceId: randomUUID() });
  const mistake = await post(d(8), [["6100", 999], ["1120", 0, 999]], { description: "Entered twice" });
  await accounting.reverseJournalEntry(client, owner, mistake, { reason: "Duplicate" });
  // Net profit = 100000 + 2000 − 40000 − 20000 − 5000 − 500 − 2500 = 34000.

  await check("the trial balance: opening, period and closing debits each equal their credits; a reversed entry and its reversal cancel", async () => {
    const tb = await accounting.getTrialBalanceStatement(client, owner, { from: fyStart, to: today });
    assert(tb.balanced && tb.exceptions.length === 0, JSON.stringify(tb.exceptions));
    assert(tb.totals.debit === tb.totals.credit && tb.totals.closingDebit === tb.totals.closingCredit, JSON.stringify(tb.totals));
    const bank = tb.rows.find((row) => row.code === "1120");
    assert(bank.closingDebit === 500000 + 200000 - 150000 + 60000 - 20000 - 30000 + 2000 - 500, `bank ${bank.closingDebit}`);
    const general = tb.rows.find((row) => row.code === "6100");
    assert(general.debit === 5000 + 999 && general.credit === 999 && general.closingDebit === 5000, JSON.stringify(general));
  });

  await check("the profit and loss: revenue − cost of sales = gross profit; − operating expenses; + other income − other expenses = net profit", async () => {
    const pl = await accounting.getProfitAndLossStatement(client, owner, { from: fyStart, to: today });
    const total = (key) => pl.sections.find((section) => section.key === key).total;
    assert(total("revenue") === 100000 && total("costOfSales") === 40000 && pl.grossProfit === 60000, JSON.stringify(pl.sections.map((s) => [s.key, s.total])));
    assert(total("operatingExpenses") === 28000 && pl.operatingProfit === 32000 && total("otherIncome") === 2000 && pl.netProfit === 34000, `net ${pl.netProfit}`);
    assert(pl.balanced, JSON.stringify(pl.exceptions));
  });

  await check("the balance sheet balances, with this year's profit shown in equity", async () => {
    const bs = await accounting.getBalanceSheetStatement(client, owner, { asOf: today });
    assert(bs.balanced && bs.totals.assets === bs.totals.liabilitiesAndEquity, JSON.stringify(bs.totals));
    assert(bs.equity.extras.find((entry) => entry.key === "yearProfit")?.amount === 34000, JSON.stringify(bs.equity.extras));
    const fixed = bs.assets.find((group) => group.key === "fixedAssets");
    assert(fixed.total === 147500, `net fixed assets ${fixed.total}`);
    assert(bs.totals.assets === 586500 + 58000 + 50000 + 147500, `assets ${bs.totals.assets}`);
  });

  await check("the cash flow reconciles: opening + net change = closing; moving money between the company's own accounts is not a cash flow", async () => {
    const cf = await accounting.getCashFlowStatement(client, owner, { from: fyStart, to: today });
    assert(cf.balanced && cf.openingCash === 0 && cf.closingCash === 586500, JSON.stringify({ o: cf.openingCash, c: cf.closingCash, n: cf.netChange, e: cf.exceptions }));
    assert(cf.operating.netProfit === 34000 && cf.operating.items.find((item) => item.key === "depreciation")?.amount === 2500, JSON.stringify(cf.operating));
    assert(cf.operating.items.find((item) => item.key === "receivables").amount === -58000 && cf.operating.items.find((item) => item.key === "inventory").amount === -50000, "working capital");
    assert(cf.operating.items.find((item) => item.key === "payables").amount === 90000 && cf.operating.items.find((item) => item.key === "taxOutput").amount === 18000, "liabilities");
    assert(cf.investing.total === -150000 && cf.financing.total === 700000, JSON.stringify({ i: cf.investing, f: cf.financing }));
    assert(cf.operating.total === 36500 && cf.netChange === 586500, `operating ${cf.operating.total}`);
    const keys = [...cf.operating.items, ...cf.investing.items, ...cf.financing.items].map((item) => item.key);
    assert(keys.every((key) => ["depreciation", "disposal", "receivables", "inventory", "taxInput", "otherCurrentAssets", "payables", "taxOutput", "otherCurrentLiabilities", "suspense",
      "fixedAssets", "otherNonCurrent", "borrowings", "equity"].includes(key)) && cf.cashAccounts.length === 2, `the ₹30,000 cash withdrawal is not a cash flow: ${keys}`);
  });

  await check("a transfer that arrives later stays in cash (through Funds in transit); the cash flow still reconciles", async () => {
    await accounting.createFundTransfer(client, owner, { date: d(9), arrivalDate: shift(1) > d(9) ? shift(1) : d(10), fromAccountId: await id("1120"), toAccountId: await id("1110"), amount: "1000" });
    const cf = await accounting.getCashFlowStatement(client, owner, { from: fyStart, to: today });
    assert(cf.balanced && cf.closingCash === 586500 && cf.cashAccounts.some((row) => row.code === "1195"), JSON.stringify(cf.cashAccounts));
  });

  await check("a year-end closing entry moves profit to retained earnings but changes no statement's story", async () => {
    await post(today, [["4100", 100000], ["4900", 2000], ["5000", 0, 40000], ["6600", 0, 20000], ["6100", 0, 5000], ["6400", 0, 500], ["6300", 0, 2500], ["3200", 0, 34000]],
      { description: "Year-end close", entryType: "closing" }, { sourceModule: "accounting", sourceType: "year_end_close", sourceId: randomUUID() });
    const pl = await accounting.getProfitAndLossStatement(client, owner, { from: fyStart, to: today });
    assert(pl.netProfit === 34000, `P&L still ${pl.netProfit}`);
    const bs = await accounting.getBalanceSheetStatement(client, owner, { asOf: today });
    const retained = bs.equity.lines.find((entry) => entry.code === "3200");
    assert(bs.balanced && retained?.amount === 34000 && bs.equity.extras.find((entry) => entry.key === "earlier")?.amount === -34000, JSON.stringify(bs.equity));
    const cf = await accounting.getCashFlowStatement(client, owner, { from: fyStart, to: today });
    assert(cf.balanced && cf.operating.netProfit === 34000 && cf.financing.total === 700000, JSON.stringify(cf.financing));
  });

  await check("comparisons: the previous period's figures sit beside this one's", async () => {
    const pl = await accounting.getProfitAndLossStatement(client, owner, { from: fyStart, to: today, compare: "previous_year" });
    assert(pl.compare?.mode === "previous_year" && pl.compareTotals.netProfit === 0 && pl.sections[0].lines[0].compare === 0, JSON.stringify(pl.compareTotals));
    const before = new Date(`${fyStart}T00:00:00Z`); before.setUTCDate(before.getUTCDate() - 1);
    const bs = await accounting.getBalanceSheetStatement(client, owner, { asOf: today, compareTo: before.toISOString().slice(0, 10) });
    assert(bs.compareTotals.assets === 0 && bs.totals.assets > 0, JSON.stringify(bs.compareTotals));
    await rejects(async () => accounting.getBalanceSheetStatement(client, owner, { asOf: fyStart, compareTo: today }), "ACCOUNTING_STATEMENT_PERIOD_INVALID");
    await rejects(async () => accounting.getProfitAndLossStatement(client, owner, { from: today, to: fyStart }), "ACCOUNTING_STATEMENT_PERIOD_INVALID");
  });

  await check("an unbalanced ledger is reported as an exception, never hidden by a plug", async () => {
    // Simulate damage the application never makes: one line changed behind its back.
    const line = (await client.query(`SELECT line.id FROM tenant.accounting_journal_lines line JOIN tenant.accounting_accounts account ON account.id = line.account_id
      WHERE line.organization_id = $1 AND account.code = '6400' LIMIT 1`, [org])).rows[0];
    await client.query("RESET ROLE");
    await client.query("ALTER TABLE tenant.accounting_journal_lines DISABLE TRIGGER USER");
    await client.query("UPDATE tenant.accounting_journal_lines SET base_debit_amount = base_debit_amount + 10 WHERE id = $1", [line.id]);
    await client.query("ALTER TABLE tenant.accounting_journal_lines ENABLE TRIGGER USER");
    await client.query("SET LOCAL ROLE vercent_app");
    await contextFor(org, owner.userId);
    const tb = await accounting.getTrialBalanceStatement(client, owner, { from: fyStart, to: today });
    assert(!tb.balanced && tb.exceptions.some((text) => text.includes("differ by 10")), JSON.stringify(tb.exceptions));
    const bs = await accounting.getBalanceSheetStatement(client, owner, { asOf: today });
    assert(!bs.balanced && bs.exceptions[0].includes("differ by"), JSON.stringify(bs.exceptions));
    const cf = await accounting.getCashFlowStatement(client, owner, { from: fyStart, to: today });
    assert(cf.closingCash === 586500, "no invented total");
  });

  await check("statements need the reports permission; the period choices list the financial years", async () => {
    const employee = await contextFor(org, employeeId);
    await rejects(async () => accounting.getTrialBalanceStatement(client, employee, {}));
    await contextFor(org, owner.userId);
    const periods = await accounting.getStatementPeriods(client, owner);
    assert(periods.current?.start === fyStart && periods.years.length >= 1, JSON.stringify(periods.current));
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
