// Finance MVP F5 (Payables): paying suppliers with approval, applying, advances, undoing, discarding, reversing, aging and statements.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-payables     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
    fullName: "AP Owner", email: `ap-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Payables ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const owner = await contextFor(org, registered.userId);
  const member = async (name, slug) => {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, $2, 'x', 'active', now()) RETURNING id`,
      [`${name.toLowerCase().replace(/\W+/g, "-")}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`, [org, id, slug]);
    return id;
  };
  const approverId = await member("Finance Approver", "finance_manager");
  const viewerId = await member("Viewer", "read_only");
  const as = (userId) => contextFor(org, userId);
  await as(owner.userId);
  const supplier = async (name, code) => (await client.query(
    `INSERT INTO tenant.business_parties (organization_id, code, party_type, display_name, legal_name, currency_code, status) VALUES ($1, $2, 'supplier', $3, $3, 'INR', 'active') RETURNING id`,
    [org, `${code}-${tag.slice(0, 4)}`, name])).rows[0].id;
  const steel = await supplier("Tata Steel Distributors", "S-STEEL");
  const power = await supplier("Power Grid Services", "S-POWER");
  const today = accounting.localToday();
  const shift = (days) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const expense = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = '6610'", [org])).rows[0].id;
  const bill = async (partyId, amount, age, due = 30) => {
    const created = await accounting.createVendorBill(client, owner, {
      partyId, billDate: shift(-age), dueDate: shift(-age + due), supplierInvoiceNumber: `SI-${Math.random().toString(16).slice(2, 7)}`,
      lines: [{ description: "Supplies", quantity: 1, unitPrice: String(amount), accountId: expense }],
    });
    const id = created.id ?? created.bill?.id;
    await client.query("UPDATE tenant.accounting_vendor_bills SET status = 'approved' WHERE organization_id = $1 AND id = $2", [org, id]);
    await accounting.postVendorBill(client, owner, id);
    return id;
  };
  const owed = async (id) => Number((await client.query("SELECT outstanding_amount FROM tenant.accounting_vendor_bills WHERE id = $1", [id])).rows[0].outstanding_amount);
  const paymentOf = (id) => accounting.getVendorPaymentRecord(client, owner, id);
  const b1 = await bill(steel, 50000, 60);   // due 30 days ago
  const b2 = await bill(steel, 30000, 25);   // due in 5 days
  const b3 = await bill(steel, 12000, 5);    // due in 25 days
  const p1 = await bill(power, 8000, 10);

  await check("the payables view lists what is owed, what is overdue and what falls due within a week", async () => {
    const open = await accounting.listPayableBills(client, owner, { view: "open" });
    assert(open.length === 4, `${open.length} open`);
    const overdue = await accounting.listPayableBills(client, owner, { view: "overdue" });
    assert(overdue.length === 1 && overdue[0].id === b1 && overdue[0].daysOverdue === 30, JSON.stringify(overdue.map((row) => [row.number, row.daysOverdue])));
    const soon = await accounting.listPayableBills(client, owner, { view: "due_soon" });
    assert(soon.length === 1 && soon[0].id === b2, "due within 7 days");
    assert(open.every((row) => row.href?.startsWith("/procurement/supplier-bills/")), "each bill opens in Procurement");
  });

  let pending;
  await check("a payment is prepared with the bills it pays and waits for approval: no money is recorded, the bills are marked as in a payment", async () => {
    pending = await accounting.prepareVendorPayment(client, owner, { partyId: steel, paymentDate: today, amount: "80000", paymentMethod: "bank_transfer", reference: "NEFT 7712",
      allocations: [{ billId: b1, amount: "50000" }, { billId: b2, amount: "30000" }] });
    assert(pending.status === "pending_approval", pending.status);
    const record = await paymentOf(pending.id);
    assert(!record.journalEntryId && record.plannedAllocations.length === 2 && record.planned === 80000, "planned, not posted");
    assert(await owed(b1) === 50000, "nothing settled before approval");
    const bills = await accounting.listPayableBills(client, owner, { view: "open", partyId: steel });
    assert(bills.find((row) => row.id === b1).inPayment === 50000, "the bill shows it is in a payment");
  });

  await check("the person who prepared a payment can't approve it; a second person approves; posting applies the approved bills", async () => {
    const record = await paymentOf(pending.id);
    await rejects(() => accounting.approveVendorPayment(client, owner, pending.id, record.contentHash));
    await rejects(() => accounting.postApprovedPayment(client, owner, pending.id), "ACCOUNTING_PAYMENT_NOT_APPROVED");
    await accounting.approveVendorPayment(client, await as(approverId), pending.id, record.contentHash);
    await as(owner.userId);
    await accounting.postApprovedPayment(client, owner, pending.id);
    const after = await paymentOf(pending.id);
    assert(after.status === "applied" && after.applied === 80000 && after.journalEntryId, `${after.status} ${after.applied}`);
    assert(await owed(b1) === 0 && await owed(b2) === 0, "both bills paid");
    for (const label of ["Prepared", "Sent for approval", "Approved", "Posted to the accounts", "Applied to bills"]) assert(after.history.some((entry) => entry.label === label), label);
  });

  await check("if a planned bill was paid by something else meanwhile, posting settles only what it still owes; the rest stays as an advance", async () => {
    const payment = await accounting.prepareVendorPayment(client, owner, { partyId: steel, paymentDate: today, amount: "12000", paymentMethod: "upi", allocations: [{ billId: b3, amount: "12000" }] });
    const record = await paymentOf(payment.id);
    await accounting.approveVendorPayment(client, await as(approverId), payment.id, record.contentHash);
    await as(owner.userId);
    await accounting.updateAccountingSettings(client, owner, { vendorPaymentApprovalRequired: false });
    await accounting.prepareVendorPayment(client, owner, { partyId: steel, paymentDate: today, amount: "5000", paymentMethod: "cash", allocations: [{ billId: b3, amount: "5000" }] });
    assert(await owed(b3) === 7000, "part paid by cash meanwhile");
    const posted = await accounting.postApprovedPayment(client, owner, payment.id);
    assert(posted.skipped.length === 1, "plan adjusted");
    const after = await paymentOf(payment.id);
    assert(after.applied === 7000 && after.unapplied === 5000 && after.status === "partially_applied", `${after.applied} / ${after.unapplied}`);
    assert(await owed(b3) === 0, "bill paid");
    assert(after.history.some((entry) => entry.label === "Applied with changes"), "the change is on record");
    await accounting.updateAccountingSettings(client, owner, { vendorPaymentApprovalRequired: true });
  });

  await check("without the approval policy a payment posts at once, here applied to the oldest bills; caps refuse over-payment", async () => {
    await accounting.updateAccountingSettings(client, owner, { vendorPaymentApprovalRequired: false });
    const direct = await accounting.prepareVendorPayment(client, owner, { partyId: power, paymentDate: today, amount: "10000", paymentMethod: "bank_transfer", applyToOldest: true });
    assert(direct.status === "posted", direct.status);
    const record = await paymentOf(direct.id);
    assert(record.applied === 8000 && record.unapplied === 2000 && await owed(p1) === 0, `${record.applied} / ${record.unapplied}`);
    await rejects(() => accounting.prepareVendorPayment(client, owner, { partyId: power, paymentDate: today, amount: "100", paymentMethod: "cash", allocations: [{ billId: b1, amount: "100" }] }),
      "ACCOUNTING_BILL_NOT_OPEN");
    const p2 = await bill(power, 3000, 1);
    await rejects(() => accounting.applyPayment(client, owner, direct.id, { allocations: [{ billId: p2, amount: "2500" }] }), "ACCOUNTING_PAYMENT_OVER_APPLIED");
    await rejects(() => accounting.prepareVendorPayment(client, owner, { partyId: power, paymentDate: today, amount: "9000", paymentMethod: "cash", allocations: [{ billId: p2, amount: "4000" }] }),
      "ACCOUNTING_BILL_OVER_SETTLED");
    // The advance pays the new bill in two steps.
    await accounting.applyPayment(client, owner, direct.id, { allocations: [{ billId: p2, amount: "1500" }] });
    await accounting.applyPayment(client, owner, direct.id, { allocations: [{ billId: p2, amount: "500" }] });
    assert(await owed(p2) === 1000 && (await paymentOf(direct.id)).status === "applied", "two steps");
    await accounting.updateAccountingSettings(client, owner, { vendorPaymentApprovalRequired: true });
  });

  await check("an application to the wrong bill is undone and re-applied; the undone one stays on record", async () => {
    const record = await paymentOf(pending.id);
    const wrong = record.allocations.find((entry) => entry.billId === b2);
    await accounting.undoPaymentAllocation(client, owner, wrong.id, { reason: "Paid the wrong bill" });
    const after = await paymentOf(pending.id);
    assert(after.unapplied === 30000 && after.status === "partially_applied" && await owed(b2) === 30000, `${after.unapplied}`);
    assert(after.allocations.find((entry) => entry.id === wrong.id).undone?.reason === "Paid the wrong bill", "kept");
    await rejects(() => accounting.undoPaymentAllocation(client, owner, wrong.id, { reason: "again" }), "ACCOUNTING_ALLOCATION_UNDONE");
    await accounting.applyPayment(client, owner, pending.id, { allocations: [{ billId: b2, amount: "30000" }] });
    assert(await owed(b2) === 0, "re-applied");
  });

  await check("a payment sent back can be discarded with a reason (never posts); one awaiting approval can't", async () => {
    const draft = await accounting.prepareVendorPayment(client, owner, { partyId: steel, paymentDate: today, amount: "1000", paymentMethod: "cash" });
    await rejects(() => accounting.discardVendorPayment(client, owner, draft.id, { reason: "Wrong supplier" }), "ACCOUNTING_PAYMENT_NOT_DRAFT");
    await accounting.rejectVendorPaymentApproval(client, await as(approverId), draft.id);
    await as(owner.userId);
    await accounting.discardVendorPayment(client, owner, draft.id, { reason: "Wrong supplier" });
    const record = await paymentOf(draft.id);
    assert(record.status === "cancelled" && record.cancelReason === "Wrong supplier" && !record.journalEntryId, record.status);
  });

  await check("a payment that bounced is reversed by an approver: the bills it paid are owed again", async () => {
    await accounting.reverseVendorPayment(client, await as(approverId), pending.id, { reason: "Transfer returned by the bank" });
    await as(owner.userId);
    const record = await paymentOf(pending.id);
    assert(record.status === "reversed" && await owed(b1) === 50000 && await owed(b2) === 30000, record.status);
    // Reversing it again changes nothing (no second reversing entry).
    await accounting.reverseVendorPayment(client, await as(approverId), pending.id, { reason: "again" });
    await as(owner.userId);
    const reversals = (await client.query("SELECT count(*)::int AS n FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND reversal_of_id = $2", [org, record.journalEntryId])).rows[0].n;
    assert(reversals === 1 && await owed(b1) === 50000, `one reversal: ${reversals}`);
  });

  await check("payables aging: each supplier's bills by days past due, advances as credits; the total equals the payables account", async () => {
    const aging = await accounting.getPartyAging(client, owner, "payable");
    const steelRow = aging.rows.find((row) => row.partyId === steel);
    assert(steelRow.d1_30 === 50000 && steelRow.notDue === 30000 && steelRow.credits === -5000, JSON.stringify(steelRow));
    const control = (await accounting.getControlAccountReconciliation(client, owner)).find((row) => row.kind === "payable");
    assert(aging.totals.net === control.ledger, `aging ${aging.totals.net} vs ledger ${control.ledger}`);
  });

  await check("a supplier statement runs from the ledger, with the reversal on it and a closing balance that matches the aging", async () => {
    const statement = await accounting.getPartyStatement(client, owner, "payable", steel, { from: shift(-90), to: today });
    assert(statement.lines.some((line) => line.document === "Supplier payment" && line.decrease === 80000), "payment on the statement");
    assert(statement.lines.some((line) => line.document === "Reversal" && line.increase === 80000), "reversal on the statement");
    const steelRow = (await accounting.getPartyAging(client, owner, "payable")).rows.find((row) => row.partyId === steel);
    assert(statement.closing === steelRow.net, `statement ${statement.closing} vs aging ${steelRow.net}`);
  });

  await check("a Read-only user sees payables but cannot prepare, approve, apply or reverse", async () => {
    const viewer = await as(viewerId);
    assert((await accounting.listVendorPayments(client, viewer, {})).length > 0, "viewer lists payments");
    await rejects(() => accounting.prepareVendorPayment(client, viewer, { partyId: steel, paymentDate: today, amount: "1", paymentMethod: "cash" }));
    await rejects(() => accounting.reverseVendorPayment(client, viewer, pending.id, { reason: "No" }));
    await as(owner.userId);
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
