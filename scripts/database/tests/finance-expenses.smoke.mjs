// Finance MVP F7 (Expenses): categories mapped to expense accounts, expenses with evidence, approval by someone else, posting, employee
// reimbursement, duplicates, corrections and reversal.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-expenses     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
const procurement = await api("modules/procurement/supplier-bills/direct.js");

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
    fullName: "Expense Owner", email: `exp-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Expenses ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const member = async (slug, name) => {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, $2, 'x', 'active', now()) RETURNING id`,
      [`${slug}-${name.split(" ")[0].toLowerCase()}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`, [org, id, slug]);
    return id;
  };
  const accountantId = await member("accountant", "Asha Accountant");
  const managerId = await member("finance_manager", "Farhan Finance");
  const viewerId = await member("read_only", "Vijay Viewer");
  const owner = await contextFor(org, registered.userId);
  const accountant = await contextFor(org, accountantId);
  const manager = await contextFor(org, managerId);
  const as = (context) => contextFor(org, context.userId);
  await as(owner);
  const today = accounting.localToday();
  const shift = (days) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const accountId = async (code) => (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = $2", [org, code])).rows[0].id;
  const balance = async (code) => Number((await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS b FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       JOIN tenant.accounting_accounts account ON account.id = line.account_id WHERE line.organization_id = $1 AND account.code = $2`, [org, code])).rows[0].b);
  const cash = await accountId("1110");
  const categories = await accounting.listAccountingExpenseCategories(client, owner);
  const category = (code) => categories.find((entry) => entry.code === code);
  const pdf = async () => accounting.prepareAccountingExpenseFileUpload({ fileName: "receipt.pdf", bytes: Buffer.from("%PDF-1.4 receipt") }, process.env);
  const attach = async (context, expenseId) => accounting.uploadAccountingExpenseFile(client, context, expenseId, { prepared: await pdf() });

  await check("a new company gets the standard categories, each posting to its own expense account — the same list Procurement's direct bills use", async () => {
    assert(categories.length === 12 && category("RENT").account.label.startsWith("6600") && category("TRAVEL").account.label.startsWith("6640") && category("TRAVEL").receiptThreshold === 200,
      JSON.stringify(categories.map((entry) => [entry.code, entry.account.label])));
    assert(category("BANK_CHARGES").receiptRequired === false && category("RENT").defaultGstRate === 18 && category("UTILITIES").defaultGstRate === null, "receipt and GST defaults");
    const procurementList = await procurement.listExpenseCategories(client, owner);
    assert(procurementList.length === 12, `procurement sees ${procurementList.length}`);
  });

  await check("a category maps only to an active expense account; names are unique; a switched-off category can't be used", async () => {
    await rejects(async () => accounting.createAccountingExpenseCategory(client, owner, { name: "Courier", accountId: cash }), "ACCOUNTING_EXPENSE_CATEGORY_ACCOUNT");
    await rejects(async () => accounting.createAccountingExpenseCategory(client, owner, { name: "rent", accountId: category("RENT").account.id }), "ACCOUNTING_EXPENSE_CATEGORY_DUPLICATE");
    const courier = await accounting.createAccountingExpenseCategory(client, owner, { name: "Courier and postage", accountId: await accountId("6100"), defaultGstRate: 18, receiptThreshold: "100" });
    assert(courier.code === "COURIER_AND_POSTAGE" && courier.receiptThreshold === 100, JSON.stringify(courier));
    await rejects(async () => accounting.createAccountingExpenseCategory(client, await as(accountant), { name: "X", accountId: await accountId("6100") }));
    await as(owner);
    await accounting.updateAccountingExpenseCategory(client, owner, courier.id, { status: "inactive" });
    await rejects(async () => accounting.createExpense(client, owner, { categoryId: courier.id, description: "Docs to client", amount: "80", settlement: "PAID", paidFromAccountId: cash }),
      "ACCOUNTING_EXPENSE_CATEGORY_INACTIVE");
  });

  await check("an expense needs a category, a past date, a real GSTIN; input tax credit needs the GSTIN and the bill number", async () => {
    await rejects(async () => accounting.createExpense(client, owner, { description: "X", amount: "10", settlement: "PAID", paidFromAccountId: cash }), "ACCOUNTING_EXPENSE_CATEGORY_NOT_FOUND");
    await rejects(async () => accounting.createExpense(client, owner, { categoryId: category("OFFICE").id, date: shift(1), description: "Paper", amount: "10", settlement: "PAID", paidFromAccountId: cash }),
      "ACCOUNTING_EXPENSE_DATE_FUTURE");
    await rejects(async () => accounting.createExpense(client, owner, { categoryId: category("OFFICE").id, description: "Paper", amount: "10", settlement: "PAID", paidFromAccountId: await accountId("4100") }),
      "ACCOUNTING_ACCOUNT_INCOMPATIBLE");
    await rejects(async () => accounting.createExpense(client, owner, { categoryId: category("OFFICE").id, description: "Paper", amount: "100", gstTreatment: "GST_CLAIM_ITC", gstRate: 18,
      supplierGstin: "27ABCDE1234", settlement: "PAID", paidFromAccountId: cash }), "ACCOUNTING_EXPENSE_GSTIN_INVALID");
    await rejects(async () => accounting.createExpense(client, owner, { categoryId: category("OFFICE").id, description: "Paper", amount: "100", gstTreatment: "GST_CLAIM_ITC", gstRate: 18,
      supplierGstin: "27AAPFU0939F1ZV", settlement: "PAID", paidFromAccountId: cash }), "ACCOUNTING_EXPENSE_INVOICE_REQUIRED");
  });

  let printer;
  await check("evidence: a receipt (or a declared reason) is needed to submit, except below the category's no-receipt amount", async () => {
    await as(accountant);
    printer = await accounting.createExpense(client, accountant, { categoryId: category("OFFICE").id, description: "Printer toner", amount: "2500", gstTreatment: "GST_CLAIM_ITC", gstRate: 18,
      gstSupply: "INTRA_STATE", supplierGstin: "27AAPFU0939F1ZV", supplierInvoiceReference: "INV/2026/0781", payeeName: "Shree Computers", settlement: "PAID", paidFromAccountId: cash });
    assert(printer.status === "DRAFT" && printer.taxAmount === 450 && printer.total === 2950 && printer.evidence.satisfied === false, JSON.stringify(printer.evidence));
    await rejects(async () => accounting.submitExpense(client, accountant, printer.id), "ACCOUNTING_EXPENSE_EVIDENCE_REQUIRED");
    await rejects(async () => accounting.prepareAccountingExpenseFileUpload({ fileName: "receipt.exe", bytes: Buffer.from("MZ") }), "ACCOUNTING_EXPENSE_FILE_TYPE");
    await attach(accountant, printer.id);
    const submitted = await accounting.submitExpense(client, accountant, printer.id);
    assert(submitted.status === "SUBMITTED" && submitted.fileList.length === 1, submitted.status);
    await rejects(async () => accounting.removeAccountingExpenseFile(client, accountant, printer.id, submitted.fileList[0].id), "ACCOUNTING_EXPENSE_STATE_INVALID");
    const cab = await accounting.createExpense(client, accountant, { categoryId: category("TRAVEL").id, description: "Auto to client site", amount: "150", settlement: "PAID", paidFromAccountId: cash, submit: true });
    assert(cab.status === "SUBMITTED" && cab.evidence.needed === false, "below the no-receipt amount");
    const tea = await accounting.createExpense(client, accountant, { categoryId: category("STAFF_WELFARE").id, description: "Tea and snacks, Diwali", amount: "1800", settlement: "PAID",
      paidFromAccountId: cash, noReceiptReason: "Local sweet shop gives no bill", submit: true });
    assert(tea.status === "SUBMITTED" && tea.noReceiptReason, "declared");
  });

  await check("approval is someone else's: the submitter can't, a viewer can't; approving posts Dr expense + input GST · Cr cash", async () => {
    await rejects(async () => accounting.approveExpense(client, accountant, printer.id));
    await rejects(async () => accounting.approveExpense(client, await as({ userId: viewerId }), printer.id));
    await as(owner);
    const self = await accounting.createExpense(client, owner, { categoryId: category("TELECOM").id, description: "Broadband October", amount: "1000", settlement: "PAID", paidFromAccountId: cash });
    await attach(owner, self.id);
    await accounting.submitExpense(client, owner, self.id);
    await rejects(async () => accounting.approveExpense(client, owner, self.id), "ACCOUNTING_EXPENSE_SELF_APPROVAL");
    const posted = await accounting.approveExpense(client, await as(manager), printer.id);
    assert(posted.status === "POSTED" && posted.state === "PAID" && posted.approvedBy === "Farhan Finance" && posted.journalEntryId, posted.status);
    assert(await balance("6650") === 2500 && await balance("1110") <= -2950, `6650 ${await balance("6650")} cash ${await balance("1110")}`);
    await rejects(async () => accounting.updateExpense(client, await as(owner), printer.id, { description: "changed" }), "ACCOUNTING_EXPENSE_STATE_INVALID");
  });

  await check("an employee's out-of-pocket expense is owed to them (never 'paid from' a company account), can't be approved by them, and is paid later", async () => {
    await as(owner);
    const claim = await accounting.createExpense(client, owner, { categoryId: category("TRAVEL").id, description: "Train to Mumbai, client visit", amount: "1450", settlement: "PAID",
      paidFromAccountId: cash, claimantUserId: managerId });
    assert(claim.settlement === "PAYABLE" && claim.paidFrom === null && claim.claimant.name === "Farhan Finance", JSON.stringify(claim.settlement));
    await attach(owner, claim.id);
    await accounting.submitExpense(client, owner, claim.id);
    await rejects(async () => accounting.approveExpense(client, await as(manager), claim.id), "ACCOUNTING_EXPENSE_SELF_APPROVAL");
    const otherManager = await member("finance_manager", "Meera Manager");
    const posted = await accounting.approveExpense(client, await contextFor(org, otherManager), claim.id);
    assert(posted.state === "TO_PAY" && await balance("2410") === -1450, `${posted.state} ${await balance("2410")}`);
    await as(owner);
    await rejects(async () => accounting.payExpense(client, owner, claim.id, { paidFromAccountId: cash, date: shift(-400) }), "ACCOUNTING_EXPENSE_DATE_INVALID");
    const paid = await accounting.payExpense(client, owner, claim.id, { paidFromAccountId: cash, paymentMethod: "upi" });
    assert(paid.state === "PAID" && paid.paymentJournalEntryId && paid.paymentMethod === "upi" && await balance("2410") === 0, paid.state);
  });

  await check("the same supplier bill can't be recorded twice; once the first is cancelled (with a reason) it can", async () => {
    await as(accountant);
    const first = await accounting.createExpense(client, accountant, { categoryId: category("REPAIRS").id, description: "AC service", amount: "3200", payeeName: "Cool Air Services",
      supplierInvoiceReference: "CAS-1102", settlement: "PAYABLE" });
    await rejects(async () => accounting.createExpense(client, accountant, { categoryId: category("REPAIRS").id, description: "AC service again", amount: "3200", payeeName: "cool air services",
      supplierInvoiceReference: "cas-1102", settlement: "PAYABLE" }), "ACCOUNTING_EXPENSE_DUPLICATE");
    await rejects(async () => accounting.cancelExpense(client, accountant, first.id, {}), "ACCOUNTING_EXPENSE_REASON_REQUIRED");
    const cancelled = await accounting.cancelExpense(client, accountant, first.id, { reason: "Recorded on the wrong company card" });
    assert(cancelled.status === "CANCELLED" && cancelled.cancelReason, "cancelled");
    const again = await accounting.createExpense(client, accountant, { categoryId: category("REPAIRS").id, description: "AC service", amount: "3200", payeeName: "Cool Air Services",
      supplierInvoiceReference: "CAS-1102", settlement: "PAYABLE" });
    assert(again.status === "DRAFT", "recorded");
  });

  await check("sent back with a reason, edited (category and amount), submitted again; the department reaches the journal line", async () => {
    await as(owner);
    const department = (await client.query(`INSERT INTO public.departments (organization_id, code, name, status) VALUES ($1, $2, 'Sales', 'active') RETURNING id`, [org, `D-${tag}`])).rows[0].id;
    await as(accountant);
    const lunch = await accounting.createExpense(client, accountant, { categoryId: category("GENERAL").id, description: "Client lunch", amount: "2200", settlement: "PAID", paidFromAccountId: cash,
      noReceiptReason: "Bill misplaced", submit: true });
    await rejects(async () => accounting.rejectExpense(client, await as(manager), lunch.id, { reason: "" }), "ACCOUNTING_EXPENSE_REASON_REQUIRED");
    const back = await accounting.rejectExpense(client, manager, lunch.id, { reason: "Use Marketing for client meals, and tag the Sales department" });
    assert(back.status === "REJECTED" && back.rejectionReason, back.status);
    await as(accountant);
    const edited = await accounting.updateExpense(client, accountant, lunch.id, { categoryId: category("MARKETING").id, departmentId: department, amount: "2100", version: back.version, submit: true });
    assert(edited.status === "SUBMITTED" && edited.category.name === "Marketing and advertising" && edited.total === 2100, JSON.stringify(edited.category));
    await rejects(async () => accounting.updateExpense(client, accountant, lunch.id, { version: 1 }));
    const posted = await accounting.approveExpense(client, await as(manager), lunch.id);
    const line = (await client.query(`SELECT line.department_id FROM tenant.accounting_journal_lines line JOIN tenant.accounting_accounts account ON account.id = line.account_id
      WHERE line.journal_entry_id = $1 AND account.code = '6630'`, [posted.journalEntryId])).rows[0];
    assert(line?.department_id === department, "department on the expense line");
  });

  await check("reversing a posted, paid expense reverses its payment and itself, with the reason; the books return to where they were", async () => {
    await as(owner);
    const before = await balance("6690");
    const fuel = await accounting.createExpense(client, owner, { categoryId: category("VEHICLE").id, description: "Diesel, delivery van", amount: "180", settlement: "PAYABLE", payeeName: "HP Pump" });
    await accounting.submitExpense(client, owner, fuel.id);
    await accounting.approveExpense(client, await as(manager), fuel.id);
    await accounting.payExpense(client, await as(owner), fuel.id, { paidFromAccountId: cash });
    await rejects(async () => accounting.reverseExpense(client, await as(manager), fuel.id, { reason: "x" }), "ACCOUNTING_EXPENSE_REASON_REQUIRED");
    const reversed = await accounting.reverseExpense(client, manager, fuel.id, { reason: "Entered for the wrong van; the fleet card already paid it" });
    assert(reversed.status === "REVERSED" && reversed.reversalJournalEntryId && await balance("6690") === before && await balance("2410") === 0, `${reversed.status} ${await balance("6690")}`);
    assert(reversed.history.some((entry) => entry.label === "Reversed" && entry.detail.includes("wrong van")), "trail");
  });

  await check("the lists: to approve, to pay (with what is owed), mine; a similar expense is pointed out; a viewer reads but can't record", async () => {
    await as(owner);
    const counts = await accounting.getExpenseCounts(client, owner);
    const toApprove = await accounting.listExpenses(client, owner, { view: "to_approve" });
    assert(counts.toApprove === toApprove.length && toApprove.length >= 2 && toApprove.every((entry) => entry.status === "SUBMITTED"), JSON.stringify(counts));
    const mine = await accounting.listExpenses(client, await as(accountant), { view: "mine" });
    assert(mine.length >= 4 && mine.every((entry) => entry.createdById === accountantId || entry.claimant?.id === accountantId), `${mine.length}`);
    await as(owner);
    const first = await accounting.createExpense(client, owner, { categoryId: category("TRAVEL").id, description: "Cab", amount: "640", payeeName: "Uber", settlement: "PAID", paidFromAccountId: cash });
    const second = await accounting.createExpense(client, owner, { categoryId: category("TRAVEL").id, description: "Cab (again?)", amount: "640", payeeName: "uber", settlement: "PAID", paidFromAccountId: cash });
    const record = await accounting.getExpenseRecord(client, owner, second.id);
    assert(record.similar.some((entry) => entry.id === first.id), "similar shown");
    const viewer = await as({ userId: viewerId });
    assert((await accounting.listExpenses(client, viewer, {})).length > 0, "viewer reads");
    await rejects(async () => accounting.createExpense(client, viewer, { categoryId: category("TRAVEL").id, description: "X", amount: "1", settlement: "PAID", paidFromAccountId: cash }));
    const options = await accounting.getExpenseFormOptions(client, viewer);
    assert(options.categories.length >= 12 && options.accounts.some((entry) => entry.cash) && options.approvalRequired === true, "form options");
  });

  await check("with approval turned off, submitting posts at once (the submitter is recorded as approver)", async () => {
    await as(owner);
    await accounting.updateAccountingSettings(client, owner, { expenseApprovalRequired: false });
    const quick = await accounting.createExpense(client, owner, { categoryId: category("BANK_CHARGES").id, description: "NEFT charges", amount: "25", settlement: "PAID", paidFromAccountId: cash, submit: true });
    assert(quick.status === "POSTED" && quick.history.some((entry) => entry.label.startsWith("Posted (no approval")), quick.status);
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
