// Finance MVP F2 (Journals and General Ledger), checked against a scratch database.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-journals     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
    fullName: "Journal Owner", email: `jnl-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Journals ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
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
  const approver = await member("Finance Approver", "finance_manager");
  await contextFor(org, owner.userId);
  const options = await accounting.getJournalFormOptions(client, owner);
  const account = (code) => options.accounts.find((entry) => entry.code === code);
  const today = accounting.localToday();
  const bank = options.accounts.find((entry) => entry.accountType === "bank");
  const rent = account("6600");
  const utilities = account("6610");
  const lines = (amount, debitAccount = rent, creditAccount = bank, extra = {}) => [
    { accountId: debitAccount.id, debit: String(amount), description: "Office rent", ...extra }, { accountId: creditAccount.id, credit: String(amount) },
  ];
  const gl = async (filters = {}) => accounting.getGeneralLedgerSummary(client, owner, filters);
  const row = (summary, id) => summary.accounts.find((entry) => entry.id === id);

  await check("the form offers posting accounts that take manual journals, never a group or a sub-ledger's control account", async () => {
    assert(options.journals.some((entry) => entry.type === "general"), "a general journal");
    assert(rent && bank && utilities, "rent, bank and utilities are offered");
    const receivable = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND control_kind = 'receivable' LIMIT 1", [org])).rows[0].id;
    assert(!options.accounts.some((entry) => entry.id === receivable), "receivable control account is not offered");
    assert(options.today === today, "today is the server's local date");
  });

  let draft;
  await check("a manual journal is saved as a draft with its number, and an unbalanced one or a control account is refused", async () => {
    draft = await accounting.createManualJournal(client, owner, { accountingDate: today, description: "October rent", reference: "RENT-10", lines: lines(25000) });
    assert(draft.status === "draft" && draft.manual && draft.editable && /\S/.test(draft.number), JSON.stringify({ status: draft.status, number: draft.number }));
    assert(draft.totals.debit === "25000.00" && draft.history[0].label === "Created as a draft", "totals and trail");
    const posting = (await client.query("SELECT status, amount FROM tenant.accounting_postings WHERE organization_id = $1 AND journal_entry_id = $2", [org, draft.id])).rows[0];
    assert(posting.status === "DRAFT" && Number(posting.amount) === 25000, JSON.stringify(posting));
    await rejects(() => accounting.createManualJournal(client, owner, { accountingDate: today, description: "Off", lines: [{ accountId: rent.id, debit: "100" }, { accountId: bank.id, credit: "90" }] }));
    const receivable = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND control_kind = 'receivable' LIMIT 1", [org])).rows[0].id;
    await rejects(() => accounting.createManualJournal(client, owner, { accountingDate: today, description: "Into AR", lines: [{ accountId: receivable, debit: "100" }, { accountId: bank.id, credit: "100" }] }));
  });

  await check("a draft is edited (lines, amount, date); a stale copy is refused; its posting amount and audit trail follow", async () => {
    await rejects(() => accounting.updateManualJournal(client, owner, draft.id, { description: "x", expectedUpdatedAt: "2001-01-01T00:00:00Z" }), "ACCOUNTING_JOURNAL_STALE");
    const edited = await accounting.updateManualJournal(client, owner, draft.id, {
      description: "October rent and power", expectedUpdatedAt: draft.updatedAt,
      lines: [{ accountId: rent.id, debit: "25000" }, { accountId: utilities.id, debit: "4200.50" }, { accountId: bank.id, credit: "29200.50" }],
    });
    assert(edited.totals.debit === "29200.50" && edited.lines.length === 3 && edited.description === "October rent and power", JSON.stringify(edited.totals));
    assert(edited.number === draft.number, "keeps its number");
    const posting = (await client.query("SELECT amount FROM tenant.accounting_postings WHERE organization_id = $1 AND journal_entry_id = $2", [org, draft.id])).rows[0];
    assert(Number(posting.amount) === 29200.5, `posting amount ${posting.amount}`);
    assert(edited.history.some((entry) => entry.label === "Edited"), "edit in the trail");
    draft = edited;
  });

  await check("approval: the submitter cannot approve; another finance user approves; it is sent back, edited and resubmitted; then posted", async () => {
    // A new company: the general journal follows the policy, which is on, so a manual journal needs a second person.
    const general = (await client.query("SELECT approval_required FROM tenant.accounting_journals WHERE organization_id = $1 AND id = $2", [org, draft.journalId])).rows[0];
    assert(general.approval_required === false && options.approval.required === true, "GEN follows the company policy, which is on");
    await accounting.submitJournalEntry(client, owner, draft.id);
    let record = await accounting.getJournalRecord(client, owner, draft.id);
    assert(record.status === "pending_approval" && !record.editable, record.status);
    await rejects(() => accounting.approveJournalEntry(client, owner, draft.id, record.contentHash));
    await rejects(() => accounting.updateManualJournal(client, owner, draft.id, { description: "x" }), "ACCOUNTING_JOURNAL_NOT_EDITABLE");
    await accounting.rejectJournalApproval(client, await contextFor(org, approver.userId), draft.id);
    await contextFor(org, owner.userId);
    record = await accounting.getJournalRecord(client, owner, draft.id);
    assert(record.status === "rejected" && record.editable, "sent back is editable");
    record = await accounting.updateManualJournal(client, owner, draft.id, { reference: "RENT-10A", expectedUpdatedAt: record.updatedAt });
    assert(record.status === "draft", "editing returns it to draft");
    await accounting.submitJournalEntry(client, owner, draft.id);
    record = await accounting.getJournalRecord(client, owner, draft.id);
    await accounting.approveJournalEntry(client, approver, draft.id, record.contentHash);
    await accounting.postJournalEntry(client, owner, draft.id);
    record = await accounting.getJournalRecord(client, owner, draft.id);
    assert(record.status === "posted" && !record.editable, record.status);
    for (const label of ["Submitted for approval", "Sent back for changes", "Approved", "Posted"]) assert(record.history.some((entry) => entry.label === label), `trail has ${label}`);
    draft = record;
  });

  await check("a posted entry is immutable in the database: no update, no new line, no delete, and marking it reversed can't change anything else", async () => {
    await rejects(() => client.query("UPDATE tenant.accounting_journal_entries SET description = 'tampered' WHERE id = $1", [draft.id]));
    await rejects(() => client.query("DELETE FROM tenant.accounting_journal_entries WHERE id = $1", [draft.id]));
    await rejects(() => client.query("UPDATE tenant.accounting_journal_lines SET base_debit_amount = 1 WHERE journal_entry_id = $1", [draft.id]));
    await rejects(() => client.query(`INSERT INTO tenant.accounting_journal_lines (organization_id, journal_entry_id, sequence, account_id, currency_code, exchange_rate, debit_amount, credit_amount,
      base_debit_amount, base_credit_amount) VALUES ($1, $2, 99, $3, 'INR', 1, 1, 0, 1, 0)`, [org, draft.id, rent.id]));
    await rejects(() => client.query("UPDATE tenant.accounting_journal_entries SET status = 'reversed', reversed_by_id = id, description = 'tampered' WHERE id = $1", [draft.id]));
    await rejects(() => client.query("UPDATE tenant.accounting_journal_entries SET status = 'reversed' WHERE id = $1", [draft.id]));
    await rejects(() => accounting.updateManualJournal(client, owner, draft.id, { description: "x" }), "ACCOUNTING_JOURNAL_NOT_EDITABLE");
  });

  await check("the General Ledger shows the movement, balances, and an account's ledger agrees with it", async () => {
    const summary = await gl();
    assert(summary.balanced === true, `balanced ${summary.balanced}`);
    assert(Number(summary.totals.debit) === 29200.5 && summary.totals.debit === summary.totals.credit, JSON.stringify(summary.totals));
    const rentRow = row(summary, rent.id);
    assert(rentRow.debit === "25000.00" && rentRow.closing.amount === "25000.00" && rentRow.closing.side === "Dr", JSON.stringify(rentRow));
    assert(row(summary, bank.id).closing.side === "Cr", "bank credited");
    const expenses = await gl({ accountClass: "expense" });
    assert(expenses.balanced === null && expenses.accounts.every((entry) => entry.accountClass === "expense"), "class filter");
    const ledger = await accounting.getAccountLedger(client, owner, rent.id, { from: summary.from, to: summary.to });
    assert(Number(ledger.closing) === 25000 && ledger.lines.length === 1, `ledger ${ledger.closing}`);
    const zero = await gl({ includeZero: "true" });
    assert(zero.accounts.length > summary.accounts.length, "includes accounts with no activity on request");
  });

  await check("a reversal is never dated before the original; reversing nets the accounts to nothing, and a reversal can't be edited", async () => {
    const yesterday = (await client.query("SELECT ($1::date - 1)::text AS day", [draft.accountingDate])).rows[0].day;
    await rejects(() => accounting.reverseManualJournal(client, owner, draft.id, { reason: "Wrong month", accountingDate: yesterday }), "ACCOUNTING_REVERSAL_DATE");
    await rejects(() => accounting.reverseManualJournal(client, owner, draft.id, { reason: "" }));
    const reversal = await accounting.reverseManualJournal(client, owner, draft.id, { reason: "Booked twice", accountingDate: today });
    assert(reversal.status === "posted" && reversal.reversalOf?.id === draft.id, JSON.stringify(reversal.reversalOf));
    const original = await accounting.getJournalRecord(client, owner, draft.id);
    assert(original.status === "reversed" && original.reversedBy?.id === reversal.id, original.status);
    assert(original.history.some((entry) => entry.label === "Reversed"), "reversal in the trail");
    const rentRow = row(await gl(), rent.id);
    assert(rentRow.closing.side === null && rentRow.debit === "25000.00" && rentRow.credit === "25000.00", JSON.stringify(rentRow));
    await rejects(() => accounting.updateManualJournal(client, owner, reversal.id, { description: "x" }), "ACCOUNTING_JOURNAL_AUTOMATIC");
    await rejects(() => accounting.reverseManualJournal(client, owner, draft.id, { reason: "Again" }));
  });

  await check("reverse and correct: the original is reversed and a correction draft opens with its lines, linked both ways", async () => {
    let posted = await accounting.createManualJournal(client, owner, { accountingDate: today, description: "Power bill", lines: lines(1800, utilities) });
    // One person keeps these books: the company turns the manual-journal approval off.
    await accounting.updateAccountingSettings(client, owner, { manualJournalApproval: false });
    await accounting.submitJournalEntry(client, owner, posted.id);
    await accounting.postJournalEntry(client, owner, posted.id);
    const correction = await accounting.correctManualJournal(client, owner, posted.id, { reason: "Wrong account", accountingDate: today });
    assert(correction.status === "draft" && correction.editable && correction.correctionOf?.id === posted.id, JSON.stringify(correction.correctionOf));
    assert(correction.formLines.length === 2 && correction.formLines[0].accountId === utilities.id && Number(correction.formLines[0].debit) === 1800, JSON.stringify(correction.formLines[0]));
    assert(correction.reference === posted.number && correction.description.startsWith(`Correction of ${posted.number}`), correction.description);
    posted = await accounting.getJournalRecord(client, owner, posted.id);
    assert(posted.status === "reversed" && posted.correctedBy?.id === correction.id, JSON.stringify(posted.correctedBy));
    assert(posted.history.some((entry) => entry.label === "Correction opened"), "trail");
    const fixed = await accounting.updateManualJournal(client, owner, correction.id, { expectedUpdatedAt: correction.updatedAt, lines: lines(1800, rent) });
    assert(fixed.lines[0].accountId === rent.id, "correction fixed");
  });

  await check("the approval policy: on with a threshold, a small journal posts after submit and a large one waits; off, none waits", async () => {
    await accounting.updateAccountingSettings(client, owner, { manualJournalApproval: true, journalApprovalThreshold: 50000 });
    const small = await accounting.createManualJournal(client, owner, { accountingDate: today, description: "Small", lines: lines(1000) });
    assert((await accounting.submitJournalEntry(client, owner, small.id)).status === "approved", "small one is approved on submit");
    const large = await accounting.createManualJournal(client, owner, { accountingDate: today, description: "Large", lines: lines(60000) });
    assert((await accounting.submitJournalEntry(client, owner, large.id)).status === "pending_approval", "large one waits");
    const policy = (await accounting.getJournalFormOptions(client, owner)).approval;
    assert(policy.required === true && Number(policy.threshold) === 50000, JSON.stringify(policy));
    await accounting.updateAccountingSettings(client, owner, { manualJournalApproval: false, journalApprovalThreshold: 0 });
    const any = await accounting.createManualJournal(client, owner, { accountingDate: today, description: "Any", lines: lines(90000) });
    assert((await accounting.submitJournalEntry(client, owner, any.id)).status === "approved", "policy off: no approval");
    await rejects(() => accounting.updateAccountingSettings(client, readOnly, { manualJournalApproval: true }));
    await contextFor(org, owner.userId);
  });

  await check("a draft is discarded with a reason: kept, never posts, can't be changed again (also by the database)", async () => {
    const spare = await accounting.createManualJournal(client, owner, { accountingDate: today, description: "Mistake", lines: lines(10) });
    await rejects(() => accounting.discardManualJournal(client, owner, spare.id, { reason: "" }));
    const discarded = await accounting.discardManualJournal(client, owner, spare.id, { reason: "Entered by mistake" });
    assert(discarded.status === "cancelled" && !discarded.editable, discarded.status);
    const posting = (await client.query("SELECT status, cancel_reason FROM tenant.accounting_postings WHERE organization_id = $1 AND journal_entry_id = $2", [org, spare.id])).rows[0];
    assert(posting.status === "CANCELLED" && posting.cancel_reason === "Entered by mistake", JSON.stringify(posting));
    await rejects(() => accounting.submitJournalEntry(client, owner, spare.id));
    await rejects(() => accounting.updateManualJournal(client, owner, spare.id, { description: "back" }), "ACCOUNTING_JOURNAL_NOT_EDITABLE");
    await rejects(() => client.query("UPDATE tenant.accounting_journal_entries SET status = 'draft' WHERE id = $1", [spare.id]));
  });

  await check("department and cost centre: lines carry them, and the General Ledger and account ledger filter by them", async () => {
    const department = (await client.query("INSERT INTO public.departments (organization_id, name, code, status) VALUES ($1, 'Sales', 'SAL', 'active') RETURNING id", [org])).rows[0].id;
    const posted = await accounting.createManualJournal(client, owner, { accountingDate: today, description: "Sales team rent share", lines: lines(5000, rent, bank, { departmentId: department }) });
    await accounting.submitJournalEntry(client, owner, posted.id);
    await accounting.postJournalEntry(client, owner, posted.id);
    const record = await accounting.getJournalRecord(client, owner, posted.id);
    assert(record.lines[0].department === "Sales" && record.formLines[0].departmentId === department, "line carries the department");
    const sales = await gl({ departmentId: department });
    assert(sales.balanced === null && sales.accounts.length === 1 && row(sales, rent.id).debit === "5000.00", JSON.stringify(sales.accounts.map((entry) => entry.code)));
    const ledger = await accounting.getAccountLedger(client, owner, rent.id, { departmentId: department });
    assert(ledger.lines.length === 1 && Number(ledger.closing) === 5000, `${ledger.lines.length} lines`);
    await rejects(() => accounting.createManualJournal(client, owner, { accountingDate: today, description: "Bad", lines: lines(1, rent, bank, { departmentId: "00000000-0000-0000-0000-000000000000" }) }));
  });

  await check("a Read-only user sees journals and the General Ledger but cannot write, submit, reverse or discard", async () => {
    const viewer = await contextFor(org, readOnly.userId);
    const summary = await accounting.getGeneralLedgerSummary(client, viewer, {});
    assert(summary.accounts.length > 0, "viewer reads the GL");
    await rejects(() => accounting.createManualJournal(client, viewer, { accountingDate: today, description: "No", lines: lines(1) }));
    await rejects(() => accounting.reverseManualJournal(client, viewer, draft.id, { reason: "No" }));
    await contextFor(org, owner.userId);
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
