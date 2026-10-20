// Finance MVP F6 (Banking): bank and cash accounts, transfers through transit, statement import (CSV and Excel) and reconciliation.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:finance-banking     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
const { buildXlsxWorkbook } = await api("core/platform/data-exchange/xlsx.js");

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
    fullName: "Bank Owner", email: `bank-${tag}@example.test`, password: "Finance-Workspace-Passphrase-2026!",
    organizationName: `Banking ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const org = registered.organizationId;
  const owner = await contextFor(org, registered.userId);
  const viewerId = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, 'Viewer', 'x', 'active', now()) RETURNING id`,
    [`viewer-${tag}@example.test`])).rows[0].id;
  await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [org, viewerId]);
  await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = 'read_only'`, [org, viewerId]);
  await contextFor(org, owner.userId);
  const today = accounting.localToday();
  const shift = (days) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const balance = async (accountId) => Number((await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS b FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed') WHERE line.organization_id = $1 AND line.account_id = $2`,
    [org, accountId])).rows[0].b);
  const b64 = (text) => Buffer.from(text, "utf8").toString("base64");

  let hdfc; let petty;
  await check("a bank account creates its own ledger account under Cash and bank, keeps only the last digits of its number, and checks the IFSC", async () => {
    await rejects(() => accounting.createBankCashAccount(client, owner, { kind: "bank", name: "Current account", bankName: "HDFC Bank", ifsc: "HDFC123" }), "ACCOUNTING_BANK_INVALID");
    hdfc = await accounting.createBankCashAccount(client, owner, { kind: "bank", name: "Current account", bankName: "HDFC Bank", accountNumber: "50200012344321", ifsc: "hdfc0001234" });
    assert(hdfc.accountNumber === "•••• 4321" && hdfc.ifsc === "HDFC0001234" && hdfc.ledgerAccount.label.startsWith("1121"), JSON.stringify(hdfc));
    const stored = (await client.query("SELECT masked_account_number FROM tenant.accounting_bank_accounts WHERE id = $1", [hdfc.id])).rows[0].masked_account_number;
    assert(!stored.includes("5020001234"), "the full number is never stored");
  });

  await check("a cash account needs a person responsible for it; the people come from the company's members", async () => {
    await rejects(() => accounting.createBankCashAccount(client, owner, { kind: "cash", name: "Petty cash — office" }), "ACCOUNTING_BANK_INVALID");
    const options = await accounting.getBankAccountFormOptions(client, owner);
    assert(options.people.some((person) => person.id === owner.userId), "members offered");
    petty = await accounting.createBankCashAccount(client, owner, { kind: "cash", name: "Petty cash — office", custodianUserId: owner.userId });
    assert(petty.kind === "cash" && petty.custodian?.id === owner.userId && petty.ledgerAccount.label.startsWith("1111"), JSON.stringify(petty));
    await rejects(() => accounting.updateBankCashAccount(client, owner, petty.id, { custodianUserId: null }), "ACCOUNTING_BANK_INVALID");
  });

  const hdfcLedger = () => hdfc.ledgerAccount.id;
  await check("a same-day transfer posts once; one arriving later goes through Funds in transit until it is received", async () => {
    const equity = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = '3900'", [org])).rows[0].id;
    const ledger = await accounting.getPrimaryLedger(client, owner);
    const journalId = (await client.query("SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND journal_type = 'general' LIMIT 1", [org])).rows[0].id;
    const seed = await accounting.createJournalEntry(client, owner, { ledgerId: ledger.id, journalId, accountingDate: shift(-40), description: "Opening funds",
      lines: [{ accountId: hdfcLedger(), debit: "500000" }, { accountId: equity, credit: "500000" }] }, { internal: true });
    await accounting.postJournalEntry(client, owner, seed.entry.id, { internal: true, allowDraft: true });
    const direct = await accounting.createFundTransfer(client, owner, { date: shift(-30), fromAccountId: hdfcLedger(), toAccountId: petty.ledgerAccount.id, amount: "20000", description: "Petty cash top-up" });
    assert(direct.state === "COMPLETED" && await balance(petty.ledgerAccount.id) === 20000, direct.state);
    const transit = (await client.query("SELECT account_id FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND mapping_key = 'funds_in_transit'", [org])).rows[0].account_id;
    const later = await accounting.createFundTransfer(client, owner, { date: shift(-20), arrivalDate: shift(-18), fromAccountId: petty.ledgerAccount.id, toAccountId: hdfcLedger(), amount: "5000", description: "Cash deposited" });
    assert(later.state === "IN_TRANSIT" && await balance(transit) === 5000 && await balance(petty.ledgerAccount.id) === 15000, `${later.state} transit ${await balance(transit)}`);
    const received = await accounting.receiveFundTransfer(client, owner, later.id, { arrivalDate: shift(-18) });
    assert(received.state === "COMPLETED" && await balance(transit) === 0, "received");
    await rejects(() => accounting.createFundTransfer(client, owner, { date: shift(-5), arrivalDate: shift(-6), fromAccountId: hdfcLedger(), toAccountId: petty.ledgerAccount.id, amount: "1" }),
      "ACCOUNTING_TRANSFER_ARRIVAL_INVALID");
    const revenue = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = '4100'", [org])).rows[0].id;
    await rejects(() => accounting.createFundTransfer(client, owner, { date: today, fromAccountId: hdfcLedger(), toAccountId: revenue, amount: "1" }));
    const toUndo = await accounting.createFundTransfer(client, owner, { date: shift(-15), arrivalDate: shift(-14), fromAccountId: hdfcLedger(), toAccountId: petty.ledgerAccount.id, amount: "700" });
    await accounting.receiveFundTransfer(client, owner, toUndo.id, {});
    const before = await balance(hdfcLedger());
    await accounting.reverseFundTransfer(client, owner, toUndo.id, { reason: "Entered twice" });
    assert(await balance(hdfcLedger()) === before + 700 && await balance(transit) === 0, "both steps reversed");
  });

  // Books: a customer receipt and a supplier payment through HDFC, and two more receipts for a split.
  const customer = (await client.query(`INSERT INTO tenant.business_parties (organization_id, code, party_type, display_name, legal_name, currency_code, status) VALUES ($1, $2, 'customer', 'Sharma Traders', 'Sharma Traders', 'INR', 'active') RETURNING id`, [org, `C-${tag}`])).rows[0].id;
  const vendor = (await client.query(`INSERT INTO tenant.business_parties (organization_id, code, party_type, display_name, legal_name, currency_code, status) VALUES ($1, $2, 'supplier', 'Gupta Packaging', 'Gupta Packaging', 'INR', 'active') RETURNING id`, [org, `S-${tag}`])).rows[0].id;
  await accounting.recordCustomerReceipt(client, owner, { partyId: customer, receiptDate: shift(-10), amount: "25000", paymentMethod: "bank_transfer", bankAccountId: hdfc.id, reference: "UTR HDFCR52260012" });
  await accounting.updateAccountingSettings(client, owner, { vendorPaymentApprovalRequired: false });
  await accounting.prepareVendorPayment(client, owner, { partyId: vendor, paymentDate: shift(-8), amount: "12000", paymentMethod: "bank_transfer", bankAccountId: hdfc.id, reference: "NEFT 7744" });
  await accounting.recordCustomerReceipt(client, owner, { partyId: customer, receiptDate: shift(-6), amount: "18000", paymentMethod: "cheque", bankAccountId: hdfc.id, reference: "CHQ 220031" });
  await accounting.recordCustomerReceipt(client, owner, { partyId: customer, receiptDate: shift(-6), amount: "12000", paymentMethod: "cheque", bankAccountId: hdfc.id, reference: "CHQ 220032" });

  const csv = (rows, extra = "") => [
    "HDFC BANK LTD,,,,,",
    "Account No: XXXXXXXXXX4321,,,,,",
    `Statement From: ${ddmm(shift(-12))} To: ${ddmm(today)},,,,,`,
    "",
    "Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance",
    ...rows, extra, "Closing balance,,,,,",
  ].join("\r\n");
  const goodRows = [
    `${ddmm(shift(-10))},NEFT CR-SHARMA TRADERS,HDFCR52260012,,"25,000.00","5,04,300.00"`,
    `${ddmm(shift(-8))},NEFT DR-GUPTA PACKAGING,7744,"12,000.00",,"4,92,300.00"`,
    `${ddmm(shift(-5))},CLG CHQ DEP 2 INSTRUMENTS,,,"30,000.00","5,22,300.00"`,
    `${ddmm(shift(-3))},CHARGES NEFT/IMPS,,"236.00",,"5,22,064.00"`,
    `${ddmm(shift(-2))},UNKNOWN CREDIT REF 99812,,,"1,500.00","5,23,564.00"`,
  ];
  let statementId;
  await check("a bank CSV is read below its account details, day-first dates and Indian amounts parsed, footers skipped, and bad rows flagged", async () => {
    const preview = await accounting.previewBankStatement(client, owner, { bankAccountId: hdfc.id, fileName: "hdfc.csv", fileBase64: b64(csv(goodRows, `31/02/${today.slice(0, 4)},BAD DATE,,,"10.00",`)) });
    assert(preview.headerRow === 5 && preview.mapping.date === "Txn Date" && preview.mapping.debit === "Withdrawal Amt" && preview.mapping.reference === "Chq/Ref No", JSON.stringify(preview.mapping));
    assert(preview.summary.rows === 6 && preview.summary.invalid === 1 && preview.summary.moneyIn === "56500.00" && preview.summary.moneyOut === "12236.00", JSON.stringify(preview.summary));
    assert(preview.rows[0].date === shift(-10) && preview.rows[0].amount === "25000.00" && preview.rows[0].direction === "in", JSON.stringify(preview.rows[0]));
    assert(preview.rows.at(-1).errors[0].includes("isn't a date"), JSON.stringify(preview.rows.at(-1)));
    await rejects(() => accounting.importBankStatementFile(client, owner, { bankAccountId: hdfc.id, fileName: "hdfc.csv", fileBase64: b64(csv(goodRows, `31/02/${today.slice(0, 4)},BAD DATE,,,"10.00",`)) }),
      "ACCOUNTING_STATEMENT_INVALID_ROWS");
  });

  await check("a statement must add up (opening + in − out = closing); then it imports, and each line gets the best match the books offer", async () => {
    await rejects(() => accounting.importBankStatementFile(client, owner, { bankAccountId: hdfc.id, fileName: "hdfc.csv", fileBase64: b64(csv(goodRows)), openingBalance: "479300.00", closingBalance: "523000.00" }),
      "ACCOUNTING_STATEMENT_UNBALANCED");
    const imported = await accounting.importBankStatementFile(client, owner, { bankAccountId: hdfc.id, fileName: "hdfc.csv", fileBase64: b64(csv(goodRows)), openingBalance: "479300.00" });
    statementId = imported.id;
    assert(imported.lines === 5 && imported.skippedDuplicates === 0, JSON.stringify(imported));
    const workspace = await accounting.getReconciliationWorkspace(client, owner, statementId);
    assert(workspace.statement.closing === 523564 && workspace.statement.opening === 479300, `closing ${workspace.statement.closing}`);
    const receiptLine = workspace.lines.find((line) => line.amount === 25000);
    assert(receiptLine.state === "SUGGESTED_MATCH" && receiptLine.suggestion.reasons.includes("Reference matches") && receiptLine.suggestion.score >= 90, JSON.stringify(receiptLine.suggestion));
    assert(workspace.lines.find((line) => line.amount === 12000).state === "SUGGESTED_MATCH", "supplier payment suggested");
    assert(workspace.lines.find((line) => line.amount === 30000).state === "UNMATCHED", "no single entry is 30,000: not suggested");
  });

  await check("the same file again is all duplicates; an overlapping file keeps only its new lines, and a row repeated in a file is flagged, not dropped", async () => {
    await rejects(() => accounting.importBankStatementFile(client, owner, { bankAccountId: hdfc.id, fileName: "hdfc-again.csv", fileBase64: b64(csv(goodRows)) }), "ACCOUNTING_STATEMENT_NOTHING_NEW");
    const preview = await accounting.previewBankStatement(client, owner, { bankAccountId: hdfc.id, fileName: "x.csv", fileBase64: b64(csv([goodRows[4], goodRows[4], `${ddmm(today)},NEW INTEREST,,,"88.00",`])) });
    assert(preview.summary.duplicates === 1 && preview.summary.ready === 2 && preview.summary.repeated === 0, JSON.stringify(preview.summary));
    assert(preview.rows[0].duplicate?.kind === "imported" && !preview.rows[1].duplicate, "imported once: the second identical row is new");
    const twice = await accounting.previewBankStatement(client, owner, { bankAccountId: hdfc.id, fileName: "y.csv", fileBase64: b64(csv([`${ddmm(today)},ATM WDL,,"500.00",,`, `${ddmm(today)},ATM WDL,,"500.00",,`])) });
    assert(twice.summary.ready === 2 && twice.summary.repeated === 1 && twice.rows[1].repeatOf === twice.rows[0].row, JSON.stringify(twice.summary));
  });

  await check("matching is never on amount alone: direction and the exact total must agree, and a ledger line is matched only once", async () => {
    const workspace = await accounting.getReconciliationWorkspace(client, owner, statementId);
    const receiptLine = workspace.lines.find((line) => line.amount === 25000);
    const paymentLine = workspace.lines.find((line) => line.amount === 12000 && line.direction === "out");
    await rejects(() => accounting.matchStatementLine(client, owner, receiptLine.id, { journalLineIds: [paymentLine.suggestion.journalLineId] }), "ACCOUNTING_BANK_MATCH_DIRECTION");
    await accounting.acceptSuggestion(client, owner, receiptLine.id);
    await accounting.acceptSuggestion(client, owner, paymentLine.id);
    const split = workspace.lines.find((line) => line.amount === 30000);
    const candidates = await accounting.getLineCandidates(client, owner, split.id);
    const cheques = candidates.filter((candidate) => [18000, 12000].includes(candidate.amount));
    assert(cheques.length === 2, JSON.stringify(candidates.map((candidate) => candidate.amount)));
    await rejects(() => accounting.matchStatementLine(client, owner, split.id, { journalLineIds: [cheques[0].journalLineId] }), "ACCOUNTING_BANK_MATCH_AMOUNT");
    await accounting.matchStatementLine(client, owner, split.id, { journalLineIds: cheques.map((candidate) => candidate.journalLineId) });
    const after = await accounting.getReconciliationWorkspace(client, owner, statementId);
    assert(after.lines.find((line) => line.id === split.id).matches.length === 2 && after.lines.find((line) => line.id === split.id).state === "MATCHED", "split across two cheques");
    await rejects(() => accounting.matchStatementLine(client, owner, after.lines.find((line) => line.amount === 1500).id, { journalLineIds: [cheques[0].journalLineId] }));
  });

  await check("a bank charge is posted from its line (a real entry, by someone allowed to post) and matched; a viewer can't", async () => {
    const workspace = await accounting.getReconciliationWorkspace(client, owner, statementId);
    const charge = workspace.lines.find((line) => line.amount === 236);
    const bankCharges = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = '6400'", [org])).rows[0].id;
    const viewer = await contextFor(org, viewerId);
    await rejects(() => accounting.postEntryForLine(client, viewer, charge.id, { accountId: bankCharges }));
    await contextFor(org, owner.userId);
    const receivable = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND control_kind = 'receivable' LIMIT 1", [org])).rows[0].id;
    await rejects(() => accounting.postEntryForLine(client, owner, charge.id, { accountId: receivable }), "ACCOUNTING_BANK_ENTRY_ACCOUNT");
    const posted = await accounting.postEntryForLine(client, owner, charge.id, { accountId: bankCharges, description: "NEFT charges" });
    assert(posted.journalEntryId && await balance(bankCharges) === 236, "charge booked");
    assert((await accounting.getReconciliationWorkspace(client, owner, statementId)).lines.find((line) => line.id === charge.id).state === "MATCHED", "matched to the new entry");
  });

  await check("an unknown credit is an exception (with why) and blocks completion; resolved by ignoring it with a reason, the statement reconciles", async () => {
    const workspace = await accounting.getReconciliationWorkspace(client, owner, statementId);
    const unknown = workspace.lines.find((line) => line.amount === 1500);
    await accounting.markLineException(client, owner, unknown.id, { reason: "Asked the bank what this credit is" });
    let now = await accounting.getReconciliationWorkspace(client, owner, statementId);
    assert(now.lines.find((line) => line.id === unknown.id).state === "EXCEPTION" && !now.canComplete && now.counts.exceptions === 1, "blocked");
    await rejects(() => accounting.completeStatementReconciliation(client, owner, statementId), "ACCOUNTING_RECONCILIATION_OPEN");
    await accounting.ignoreStatementLine(client, owner, unknown.id, { reason: "Bank reversed it the next day (not ours)" });
    now = await accounting.completeStatementReconciliation(client, owner, statementId);
    assert(now.statement.status === "reconciled" && now.lines.every((line) => ["RECONCILED", "IGNORED"].includes(line.state)), now.statement.status);
    await rejects(() => accounting.unmatchStatementLine(client, owner, now.lines[0].id), "ACCOUNTING_STATEMENT_RECONCILED");
    const reopened = await accounting.reopenStatementReconciliation(client, owner, statementId, { reason: "Re-check the split" });
    assert(reopened.statement.status === "reconciling", "reopened");
    await accounting.unmatchStatementLine(client, owner, reopened.lines.find((line) => line.amount === 25000).id);
    assert((await accounting.getReconciliationWorkspace(client, owner, statementId)).lines.find((line) => line.amount === 25000).state === "UNMATCHED", "unmatched");
  });

  await check("a next statement that doesn't continue from the last closing balance can't be completed", async () => {
    const next = await accounting.importBankStatementFile(client, owner, { bankAccountId: hdfc.id, fileName: "next.csv",
      fileBase64: b64(csv([`${ddmm(today)},NEFT CR-SHARMA TRADERS INTEREST,,,"88.00","5,23,000.00"`])), openingBalance: "522912.00" });
    const workspace = await accounting.getReconciliationWorkspace(client, owner, next.id);
    assert(workspace.continues === false && workspace.blockers.some((text) => text.includes("doesn't continue")), JSON.stringify(workspace.blockers));
  });

  await check("an Excel (.xlsx) statement is read the same way", async () => {
    const columns = ["Date", "Description", "Reference", "Debit", "Credit", "Balance"].map((label) => ({ key: label, label }));
    const row = (values) => Object.fromEntries(columns.map((column, index) => [column.key, values[index]]));
    const workbook = buildXlsxWorkbook({ sheetName: "Statement", columns,
      rows: [row([shift(-1), "UPI-RAJESH KUMAR", "UPI 4455", "", 750, 1000]), row([today, "ATM WDL", "", 2000, "", -1000])] });
    const preview = await accounting.previewBankStatement(client, owner, { bankAccountId: petty.id, fileName: "petty.xlsx", fileBase64: Buffer.from(workbook).toString("base64") });
    assert(preview.summary.ready === 2 && preview.rows[0].direction === "in" && preview.rows[1].direction === "out" && preview.summary.moneyOut === "2000.00", JSON.stringify(preview.summary));
  });

  await check("dates: day-first, short years, month names and Excel day numbers; impossible dates refused", async () => {
    const cases = [["21/10/2026", "2026-10-21"], ["21-10-26", "2026-10-21"], ["21.10.2026", "2026-10-21"], ["21-Oct-2026", "2026-10-21"], ["21 Oct 2026", "2026-10-21"],
      ["2026-10-21", "2026-10-21"], ["46316", "2026-10-21"], ["31/02/2026", null], ["13/13/2026", null]];
    for (const [input, expected] of cases) assert(accounting.parseStatementDate(input) === expected, `${input} → ${accounting.parseStatementDate(input)}`);
  });

  await check("the accounts list shows each balance, the custodian and what is left to reconcile; an account with money in it isn't closed", async () => {
    const list = await accounting.listBankCashAccounts(client, owner);
    const bank = list.find((entry) => entry.id === hdfc.id);
    assert(bank.balance > 0 && bank.linesToReconcile >= 1, JSON.stringify(bank));
    await rejects(() => accounting.updateBankCashAccount(client, owner, hdfc.id, { status: "inactive" }), "ACCOUNTING_BANK_HAS_BALANCE");
    const viewer = await contextFor(org, viewerId);
    assert((await accounting.listBankCashAccounts(client, viewer)).length === 2, "a viewer reads accounts");
    await rejects(() => accounting.createBankCashAccount(client, viewer, { kind: "bank", name: "X", bankName: "Y" }));
    await rejects(() => accounting.previewBankStatement(client, viewer, { bankAccountId: hdfc.id, fileName: "a.csv", fileBase64: b64(csv(goodRows)) }));
    await contextFor(org, owner.userId);
  });
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
