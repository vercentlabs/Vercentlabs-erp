// Finance MVP F4 (Receivables): receipts, applying them, advances, undoing and reversing, aging and statements — against a scratch database.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-receivables     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
    fullName: "AR Owner", email: `ar-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Receivables ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const owner = await contextFor(org, registered.userId);
  const viewerId = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, 'Viewer', 'x', 'active', now()) RETURNING id`,
    [`viewer-${tag}@example.test`])).rows[0].id;
  await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, viewerId]);
  await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = 'read_only'`, [org, viewerId]);
  await contextFor(org, owner.userId);
  const party = async (name) => (await client.query(
    `INSERT INTO tenant.business_parties (organization_id, code, party_type, display_name, legal_name, currency_code, status) VALUES ($1, $2, 'customer', $3, $3, 'INR', 'active') RETURNING id`,
    [org, `C-${name.slice(0, 4).toUpperCase()}-${tag.slice(0, 4)}`, name])).rows[0].id;
  const acme = await party("Acme Traders");
  const bharat = await party("Bharat Foods");
  const today = accounting.localToday();
  const shift = (days) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const revenue = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = '4100'", [org])).rows[0].id;
  // An invoice dated `age` days ago, due `due` days after its date.
  const invoice = async (partyId, amount, age, due = 30) => {
    const created = await accounting.createCustomerInvoice(client, owner, {
      partyId, invoiceDate: shift(-age), dueDate: shift(-age + due), lines: [{ description: "Goods", quantity: 1, unitPrice: String(amount), accountId: revenue }],
    });
    const id = created.id ?? created.invoice?.id;
    await client.query("UPDATE tenant.accounting_customer_invoices SET status = 'approved' WHERE organization_id = $1 AND id = $2", [org, id]);
    await accounting.postCustomerInvoice(client, owner, id);
    return id;
  };
  const owed = async (id) => Number((await client.query("SELECT outstanding_amount FROM tenant.accounting_customer_invoices WHERE id = $1", [id])).rows[0].outstanding_amount);
  const statusOf = async (id) => (await client.query("SELECT status FROM tenant.accounting_customer_invoices WHERE id = $1", [id])).rows[0].status;
  const receiptOf = (id) => accounting.getCustomerReceiptRecord(client, owner, id);

  const old = await invoice(acme, 10000, 75);      // due 45 days ago
  const recent = await invoice(acme, 5000, 10);    // not yet due
  const middle = await invoice(acme, 8000, 40);    // due 10 days ago
  const other = await invoice(bharat, 3000, 5);

  await check("the receivables view lists what each customer owes, how late, and marks the overdue ones", async () => {
    const open = await accounting.listReceivableInvoices(client, owner, { view: "open" });
    assert(open.length === 4, `${open.length} open`);
    const overdue = await accounting.listReceivableInvoices(client, owner, { view: "overdue" });
    assert(overdue.length === 2 && overdue.every((row) => row.daysOverdue > 0 && row.status === "overdue"), JSON.stringify(overdue.map((row) => [row.number, row.daysOverdue])));
    const forAcme = await accounting.listReceivableInvoices(client, owner, { view: "open", partyId: acme });
    assert(forAcme.length === 3, "filter by customer");
  });

  let receipt;
  let advance;
  await check("a receipt is recorded and posted in one step and applied to the oldest invoices first; payments never touch revenue", async () => {
    receipt = await accounting.recordCustomerReceipt(client, owner, { partyId: acme, receiptDate: today, amount: "20000", paymentMethod: "bank_transfer", reference: "UTR998877", applyToOldest: true });
    const record = await receiptOf(receipt.id);
    assert(record.status === "applied" && record.applied === 20000 && record.unapplied === 0, `${record.status} ${record.applied} ${record.unapplied}`);
    assert(await owed(old) === 0 && await owed(middle) === 0 && await owed(recent) === 3000, "oldest first: 10,000, 8,000, then 2,000 of the recent invoice");
    assert(await statusOf(old) === "paid" && await statusOf(recent) === "partially_paid", "paid and partly paid");
    const revenueBalance = Number((await client.query(
      `SELECT COALESCE(sum(line.base_credit_amount - line.base_debit_amount), 0) AS b FROM tenant.accounting_journal_lines line
         JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed') WHERE line.organization_id = $1 AND line.account_id = $2`,
      [org, revenue])).rows[0].b);
    assert(revenueBalance === 26000, `revenue is only the invoices: ${revenueBalance}`);
    assert(record.allocations.length === 3 && record.openInvoices.length === 0, "three applications; nothing left to apply");
  });

  await check("an application is capped: never more than the invoice owes, never more than the receipt has left, never another customer's invoice", async () => {
    advance = await accounting.recordCustomerReceipt(client, owner, { partyId: acme, receiptDate: today, amount: "9000", paymentMethod: "upi", reference: "UPI 5521" });
    assert((await receiptOf(advance.id)).unapplied === 9000, "recorded without applying: an advance");
    await rejects(() => accounting.applyReceipt(client, owner, advance.id, { allocations: [{ invoiceId: recent, amount: "6000" }] }), "ACCOUNTING_INVOICE_OVER_SETTLED");
    await rejects(() => accounting.applyReceipt(client, owner, advance.id, { allocations: [{ invoiceId: recent, amount: "3000" }, { invoiceId: old, amount: "7000" }] }), "ACCOUNTING_RECEIPT_OVER_APPLIED");
    await rejects(() => accounting.applyReceipt(client, owner, advance.id, { allocations: [{ invoiceId: other, amount: "100" }] }));
    await rejects(() => accounting.applyReceipt(client, owner, receipt.id, { allocations: [{ invoiceId: recent, amount: "1" }] }), "ACCOUNTING_RECEIPT_NOT_APPLICABLE");
  });

  await check("many receipts settle one invoice: a part of the advance and a cheque pay the recent invoice in full", async () => {
    // The same receipt pays one invoice in two steps.
    await accounting.applyReceipt(client, owner, advance.id, { allocations: [{ invoiceId: recent, amount: "400" }] });
    await accounting.applyReceipt(client, owner, advance.id, { allocations: [{ invoiceId: recent, amount: "600" }] });
    assert(await owed(recent) === 2000 && await statusOf(recent) === "partially_paid", "first part, in two steps");
    await rejects(() => accounting.applyReceipt(client, owner, advance.id, { allocations: [{ invoiceId: recent, amount: "100" }, { invoiceId: recent, amount: "100" }] }));
    const cheque = await accounting.recordCustomerReceipt(client, owner, { partyId: acme, receiptDate: today, amount: "2000", paymentMethod: "cheque", reference: "CHQ 4411",
      allocations: [{ invoiceId: recent, amount: "2000" }] });
    assert(await owed(recent) === 0 && await statusOf(recent) === "paid", "paid in full");
    assert((await receiptOf(cheque.id)).status === "applied", "the cheque is fully applied");
    const left = await receiptOf(advance.id);
    assert(left.status === "partially_applied" && left.unapplied === 8000, `8,000 of the advance is left: ${left.unapplied}`);
  });

  await check("an application made to the wrong invoice is undone: the invoice is owed again and the money is free again; the record stays", async () => {
    const record = await receiptOf(receipt.id);
    const wrong = record.allocations.find((entry) => entry.invoiceId === middle);
    await rejects(() => accounting.undoReceiptAllocation(client, owner, wrong.id, { reason: "" }));
    await accounting.undoReceiptAllocation(client, owner, wrong.id, { reason: "Applied to the wrong invoice" });
    const after = await receiptOf(receipt.id);
    assert(after.unapplied === 8000 && after.status === "partially_applied", `${after.unapplied} ${after.status}`);
    assert(await owed(middle) === 8000 && await statusOf(middle) === "posted", "owed again");
    assert(after.allocations.find((entry) => entry.id === wrong.id).undone?.reason === "Applied to the wrong invoice", "kept, marked undone");
    await rejects(() => accounting.undoReceiptAllocation(client, owner, wrong.id, { reason: "again" }), "ACCOUNTING_ALLOCATION_UNDONE");
    await rejects(() => client.query("DELETE FROM tenant.accounting_customer_receipt_allocations WHERE id = $1", [wrong.id]));
    await accounting.applyReceipt(client, owner, receipt.id, { allocations: [{ invoiceId: middle, amount: "8000" }] });
    assert(await owed(middle) === 0 && (await receiptOf(receipt.id)).status === "applied", "re-applied");
  });

  await check("a bounced receipt is reversed: its applications are undone, its journal reversed, the invoice owed again", async () => {
    const cheque = await accounting.recordCustomerReceipt(client, owner, { partyId: bharat, receiptDate: today, amount: "3000", paymentMethod: "cheque", reference: "CHQ 7781",
      allocations: [{ invoiceId: other, amount: "3000" }] });
    assert(await owed(other) === 0, "paid by cheque");
    await accounting.reverseCustomerReceipt(client, owner, cheque.id, { reason: "Cheque bounced" });
    const record = await receiptOf(cheque.id);
    assert(record.status === "reversed" && record.unapplied === 0 && record.applied === 0 && record.reversalJournalEntryId, `${record.status} applied ${record.applied}`);
    assert(await owed(other) === 3000, "owed again");
    const posting = (await client.query("SELECT status FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = 'customer_receipt' AND source_id = $2", [org, cheque.id])).rows[0];
    assert(posting.status === "REVERSED", posting.status);
    await rejects(() => accounting.reverseCustomerReceipt(client, owner, cheque.id, { reason: "again" }), "ACCOUNTING_RECEIPT_REVERSED");
  });

  await check("aging: each customer's open invoices by days past due, with advances as credits, totalling the receivable control account", async () => {
    const aging = await accounting.getPartyAging(client, owner, "receivable");
    const acmeRow = aging.rows.find((row) => row.partyId === acme);
    const bharatRow = aging.rows.find((row) => row.partyId === bharat);
    assert(acmeRow.net === -8000 && acmeRow.credits === -8000, `Acme holds an 8,000 advance: ${JSON.stringify(acmeRow)}`);
    assert(bharatRow.notDue === 3000 && bharatRow.net === 3000, JSON.stringify(bharatRow));
    const control = (await accounting.getControlAccountReconciliation(client, owner)).find((row) => row.kind === "receivable");
    assert(aging.totals.net === control.ledger, `aging ${aging.totals.net} vs ledger ${control.ledger}`);
    const late = await invoice(bharat, 4000, 80);
    const again = await accounting.getPartyAging(client, owner, "receivable");
    assert(again.rows.find((row) => row.partyId === bharat).d31_60 === 4000, "an invoice due 50 days ago is in 31–60");
    void late;
  });

  await check("a customer statement runs from the ledger: brought forward, every invoice, receipt and reversal, and a closing balance that matches the aging", async () => {
    const statement = await accounting.getPartyStatement(client, owner, "receivable", acme, { from: shift(-30), to: today });
    assert(statement.opening === 18000, `brought forward: the two invoices dated before the period, ${statement.opening}`);
    assert(statement.lines.some((line) => line.document === "Customer payment received" && line.decrease === 20000), "receipt on the statement");
    assert(statement.closing === -8000, `18,000 + 5,000 - 20,000 - 9,000 - 2,000: ${statement.closing}`);
    const last = statement.lines.at(-1);
    assert(last.balance === statement.closing, "running balance ends at the closing balance");
    assert(statement.aging.credits === -8000 && statement.party.name === "Acme Traders" && statement.company?.name, "aging and headings");
    const bharatStatement = await accounting.getPartyStatement(client, owner, "receivable", bharat, { from: shift(-100), to: today });
    assert(bharatStatement.lines.some((line) => line.document === "Reversal"), "the bounced cheque's reversal is on the statement");
    assert(bharatStatement.closing === 7000, `Bharat owes 3,000 + 4,000: ${bharatStatement.closing}`);
  });

  await check("the receipt form offers customers, bank and cash accounts, and the chosen customer's open invoices and advance", async () => {
    const options = await accounting.getReceiptFormOptions(client, owner, { partyId: bharat });
    assert(options.customers.some((entry) => entry.id === acme), "customers");
    assert(options.openInvoices.length === 2 && options.openInvoices.every((entry) => entry.outstanding > 0), "Bharat's open invoices");
    const acmeOptions = await accounting.getReceiptFormOptions(client, owner, { partyId: acme });
    assert(acmeOptions.unapplied === 8000, "Acme's advance");
  });

  await check("a Read-only user sees receivables, aging and statements but cannot record, apply, undo or reverse", async () => {
    const viewer = await contextFor(org, viewerId);
    assert((await accounting.listCustomerReceipts(client, viewer, {})).length > 0, "viewer lists receipts");
    assert((await accounting.getPartyAging(client, viewer, "receivable")).rows.length === 2, "viewer reads aging");
    await rejects(() => accounting.recordCustomerReceipt(client, viewer, { partyId: acme, receiptDate: today, amount: "1", paymentMethod: "cash" }));
    await rejects(() => accounting.reverseCustomerReceipt(client, viewer, receipt.id, { reason: "No" }));
    await contextFor(org, owner.userId);
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
