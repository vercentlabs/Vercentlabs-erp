// Finance MVP F9 (Period close): Open → Closing review → Closed → Locked, readiness checks and acknowledged exceptions, order, reopening
// with a reason, the year-end close, and no posting into a month that isn't open — whoever or whatever posts.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-close     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
    fullName: "Close Owner", email: `close-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Close ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const member = async (slug, name) => {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, $2, 'x', 'active', now()) RETURNING id`,
      [`${slug}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`, [org, id, slug]);
    return id;
  };
  const accountantId = await member("accountant", "Asha Accountant");
  const viewerId = await member("read_only", "Vijay Viewer");
  const owner = await contextFor(org, registered.userId);
  const as = (userId) => contextFor(org, userId);
  await as(owner.userId);
  const periods = (await client.query(`SELECT id, name, start_date::text AS start, end_date::text AS end FROM tenant.fiscal_periods WHERE organization_id = $1 AND period_type = 'standard'
      ORDER BY start_date`, [org])).rows;
  const year = (await client.query("SELECT id, name, start_date::text AS start, end_date::text AS end FROM tenant.accounting_fiscal_years WHERE organization_id = $1 ORDER BY start_date LIMIT 1", [org])).rows[0];
  const [first, second] = periods;
  const ledger = await accounting.getPrimaryLedger(client, owner);
  const journalId = (await client.query("SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND journal_type = 'general' LIMIT 1", [org])).rows[0].id;
  const id = async (code) => (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = $2", [org, code])).rows[0].id;
  const entry = async (date, debitCode, creditCode, amount, { post = true } = {}) => {
    const created = await accounting.createJournalEntry(client, owner, { ledgerId: ledger.id, journalId, accountingDate: date, entryDate: date, documentDate: date, description: "Test",
      lines: [{ accountId: await id(debitCode), debit: String(amount) }, { accountId: await id(creditCode), credit: String(amount) }] }, { internal: true });
    if (post) await accounting.postJournalEntry(client, owner, created.entry.id, { internal: true, allowDraft: true });
    return created.entry.id;
  };
  const checkOf = (workspace, key) => workspace.checks.find((entry) => entry.key === key);
  await entry(first.start, "1120", "3100", 100000);
  await entry(first.start, "6600", "1120", 20000);
  await entry(first.end, "1120", "4100", 50000);
  const draft = await entry(first.end, "6100", "1120", 700, { post: false });

  await check("a month's readiness: a journal not posted blocks; the first month has no earlier month to wait for", async () => {
    const workspace = await accounting.getPeriodCloseWorkspace(client, owner, first.id);
    assert(checkOf(workspace, "earlier_open").clear && checkOf(workspace, "unposted_journals").state === "attention" && checkOf(workspace, "trial_balance").clear, JSON.stringify(workspace.checks.map((c) => [c.key, c.state])));
    assert(workspace.blocking >= 1 && workspace.ready === false && workspace.actions.startReview, "blocked");
  });

  await check("closing review stops postings into the month — for anything that posts, even an automatic job", async () => {
    await rejects(async () => accounting.closePeriod(client, owner, first.id), "ACCOUNTING_PERIOD_STATE");
    await rejects(async () => accounting.startPeriodReview(client, await as(viewerId), first.id));
    await as(owner.userId);
    const review = await accounting.startPeriodReview(client, owner, first.id, { note: "April close" });
    assert(review.period.status === "soft_closed" && review.period.reviewStartedBy === "Close Owner", review.period.status);
    await rejects(async () => entry(first.end, "6100", "1120", 50), "ACCOUNTING_PERIOD_CLOSED");
    // Even straight in the database, a journal can't become posted in a month that isn't open.
    await client.query("SAVEPOINT direct");
    const error = await client.query("UPDATE tenant.accounting_journal_entries SET status = 'posted' WHERE id = $1", [draft]).then(() => null, (failure) => failure);
    await client.query("ROLLBACK TO SAVEPOINT direct");
    assert(error && /not open/.test(error.message), String(error?.message));
  });

  await check("a blocking check can't be acknowledged; the month can't close until the journal is dealt with", async () => {
    const refused = await rejects(async () => accounting.closePeriod(client, owner, first.id), "ACCOUNTING_PERIOD_NOT_READY");
    assert(refused.message.includes("not posted"), refused.message);
    await rejects(async () => accounting.acknowledgeCloseCheck(client, owner, first.id, { checkKey: "unposted_journals", reason: "Will fix later" }), "ACCOUNTING_CHECK_NOT_ACKNOWLEDGEABLE");
    await accounting.returnPeriodToOpen(client, owner, first.id);
    await accounting.postJournalEntry(client, owner, draft, { internal: true, allowDraft: true });
    const again = await accounting.startPeriodReview(client, owner, first.id);
    assert(checkOf(again, "unposted_journals").clear, "posted now");
  });

  await check("a warning (a suspense balance) is acknowledged with a reason, then the month closes with a snapshot of how it closed", async () => {
    await accounting.returnPeriodToOpen(client, owner, first.id);
    await entry(first.end, "2900", "1120", 1234);
    await accounting.startPeriodReview(client, owner, first.id);
    let workspace = await accounting.getPeriodCloseWorkspace(client, owner, first.id);
    assert(checkOf(workspace, "suspense").state === "attention" && checkOf(workspace, "suspense").amount === 1234, JSON.stringify(checkOf(workspace, "suspense")));
    await rejects(async () => accounting.closePeriod(client, owner, first.id), "ACCOUNTING_PERIOD_NOT_READY");
    await rejects(async () => accounting.acknowledgeCloseCheck(client, await as(accountantId), first.id, { checkKey: "suspense", reason: "Clearing next month" }));
    await as(owner.userId);
    await rejects(async () => accounting.acknowledgeCloseCheck(client, owner, first.id, { checkKey: "suspense", reason: "ok" }), "ACCOUNTING_REASON_REQUIRED");
    workspace = await accounting.acknowledgeCloseCheck(client, owner, first.id, { checkKey: "suspense", reason: "Unidentified receipt; customer asked, clearing in May" });
    assert(checkOf(workspace, "suspense").state === "acknowledged" && workspace.ready, "acknowledged");
    const closed = await accounting.closePeriod(client, owner, first.id, { note: "Closed on time" });
    assert(closed.period.status === "closed" && closed.period.closedBy === "Close Owner" && !closed.live && checkOf(closed, "suspense").state === "acknowledged", closed.period.status);
    assert(closed.trialBalance && closed.history.some((entry) => entry.label === "Exception acknowledged"), "snapshot and trail");
  });

  await check("months go in order: the next month waits for the earlier one; locking and reopening keep the order", async () => {
    await accounting.reopenPeriod(client, owner, first.id, { reason: "Test the order" });
    await accounting.startPeriodReview(client, owner, second.id);
    const waiting = await accounting.getPeriodCloseWorkspace(client, owner, second.id);
    assert(checkOf(waiting, "earlier_open").state === "attention", "the earlier month is open");
    await rejects(async () => accounting.closePeriod(client, owner, second.id), "ACCOUNTING_PERIOD_NOT_READY");
    await accounting.startPeriodReview(client, owner, first.id);
    await accounting.closePeriod(client, owner, first.id);
    // The suspense balance is still there at May's end: May needs its own acknowledgement.
    await accounting.acknowledgeCloseCheck(client, owner, second.id, { checkKey: "suspense", reason: "Same unidentified receipt as April" });
    await accounting.closePeriod(client, owner, second.id);
    await rejects(async () => accounting.lockPeriod(client, owner, second.id), "ACCOUNTING_PERIOD_ORDER");
    await rejects(async () => accounting.reopenPeriod(client, owner, first.id, { reason: "Need to post a late bill" }), "ACCOUNTING_PERIOD_ORDER");
    await accounting.lockPeriod(client, owner, first.id);
    const locked = await accounting.getPeriodCloseWorkspace(client, owner, first.id);
    assert(locked.period.status === "locked" && locked.period.lockedBy === "Close Owner", locked.period.status);
  });

  await check("reopening needs a reason and the right permission (a locked month only by someone who may waive close controls); then postings return", async () => {
    await accounting.reopenPeriod(client, owner, second.id, { reason: "Late supplier bill for May" });
    await rejects(async () => accounting.reopenPeriod(client, owner, first.id, {}));
    await rejects(async () => accounting.reopenPeriod(client, await as(accountantId), first.id, { reason: "Accountant tries" }));
    await as(owner.userId);
    const reopened = await accounting.reopenPeriod(client, owner, first.id, { reason: "Auditor's adjustment" });
    assert(reopened.period.status === "open" && reopened.period.reopenReason === "Auditor's adjustment" && reopened.period.reopenedBy === "Close Owner", reopened.period.status);
    await entry(first.end, "6100", "1120", 99);
  });

  await check("the financial year closes only when every month is closed: profit moves to retained earnings and every month locks", async () => {
    await rejects(async () => accounting.closeFinancialYear(client, owner, year.id), "ACCOUNTING_YEAR_NOT_READY");
    // Clear the suspense balance, then close all twelve months in order.
    await entry(first.end, "1120", "2900", 1234);
    for (const period of periods) {
      const workspace = await accounting.getPeriodCloseWorkspace(client, owner, period.id);
      if (workspace.period.status === "open") await accounting.startPeriodReview(client, owner, period.id);
      if (["open", "soft_closed"].includes(workspace.period.status)) await accounting.closePeriod(client, owner, period.id);
    }
    const closed = await accounting.closeFinancialYear(client, owner, year.id, { note: "Audited" });
    assert(closed.status === "closed" && closed.closingJournalEntryId && closed.periods.every((period) => period.status === "locked"), JSON.stringify(closed.periods.map((p) => p.status)));
    const lines = (await client.query(`SELECT account.code, line.base_debit_amount::float AS dr, line.base_credit_amount::float AS cr FROM tenant.accounting_journal_lines line
      JOIN tenant.accounting_accounts account ON account.id = line.account_id WHERE line.journal_entry_id = $1`, [closed.closingJournalEntryId])).rows;
    const retained = lines.find((row) => row.code === "3200");
    assert(retained.cr === 50000 - 20000 - 700 - 99, JSON.stringify(lines));
    const bs = await accounting.getBalanceSheetStatement(client, owner, { asOf: year.end });
    assert(bs.balanced && bs.equity.lines.find((row) => row.code === "3200").amount === 29201, JSON.stringify(bs.equity));
    const pl = await accounting.getProfitAndLossStatement(client, owner, { from: year.start, to: year.end });
    assert(pl.netProfit === 29201, `P&L still shows the year: ${pl.netProfit}`);
    await rejects(async () => accounting.reopenPeriod(client, owner, first.id, { reason: "After the year closed" }), "ACCOUNTING_YEAR_CLOSED");
    await rejects(async () => accounting.closeFinancialYear(client, owner, year.id), "ACCOUNTING_YEAR_CLOSED");
    await rejects(async () => entry(first.end, "6100", "1120", 10), "ACCOUNTING_PERIOD_CLOSED");
  });

  await check("the overview lists the years and months with where each stands", async () => {
    const overview = await accounting.getCloseOverview(client, await as(viewerId));
    const listed = overview.years.find((entry) => entry.id === year.id);
    assert(listed.status === "closed" && listed.periods.length >= 12, JSON.stringify(listed.status));
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
