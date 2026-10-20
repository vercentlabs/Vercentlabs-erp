// Payroll → General Ledger (Finance MVP F3). The posting contract HR & Payroll calls; Finance owns the accounts and the journal.
//
//   payroll run approved   Dr Salaries and wages (gross, by department)            Cr Salaries payable (net pay)
//                          Dr Employer statutory contributions (EPF/ESI employer)  Cr TDS payable · EPF payable (employee + employer)
//                                                                                  Cr ESI payable (employee + employer) · PT payable
//                                                                                  Cr each other deduction's own account (advance recovered …)
//   salaries paid          Dr Salaries payable                                     Cr the bank or cash account paid from
//   statutory dues paid    Dr TDS / EPF / ESI / PT payable                         Cr the bank or cash account paid from
//
// One entry per business event: a run, a salary payment or a challan posts once (the posting service refuses a second live posting of the
// same event for the same document); a correction is a reversal and a new posting. Gross must equal net pay plus every deduction — the
// payroll is refused, not "balanced" by a plug. The accounts come from Accounting › Posting accounts › Payroll.
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { ACCOUNTING_PERMISSIONS, AccountingError, getAccountMapping, getPrimaryLedger, isoDate, requirePermission, requiredText, text, uuid } from "../core.js";
import { createJournalEntry, getJournalEntry, postJournalEntry, reverseJournalEntry } from "../journals.js";

const fail = (message, code = "ACCOUNTING_PAYROLL_INVALID", details) => { throw new AccountingError(400, message, code, details); };
const STATUTORY = Object.freeze({ tds: "tds_payable", epf: "epf_payable", esi: "esi_payable", pt: "pt_payable" });
const STATUTORY_LABEL = Object.freeze({ tds: "TDS on salaries", epf: "EPF", esi: "ESI", pt: "Professional tax" });

function amount(value, label) {
  const parsed = decimal(value ?? 0);
  if (parsed < 0n) fail(`${label} can't be negative.`);
  return parsed;
}

// A payroll posting runs on behalf of HR (internal) or by a person with the journal-posting permission.
function authorise(context, options) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.journalPost);
}

async function generalJournal(client, context, ledgerId) {
  const row = (await client.query(
    `SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND status = 'active' ORDER BY (journal_type = 'general') DESC, code LIMIT 1`,
    [context.organizationId, ledgerId])).rows[0];
  if (!row) throw new AccountingError(409, "The accounting journal is not configured.", "ACCOUNTING_JOURNAL_MISSING");
  return row.id;
}

// The bank or cash account money is paid from: an active posting account owned by banking.
async function paidFrom(client, context, accountIdValue) {
  const account = (await client.query(
    `SELECT id, code, name, control_kind, status, is_group FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, uuid(accountIdValue, "Paid from")])).rows[0];
  if (!account || account.status !== "active" || account.is_group || !["bank", "cash"].includes(account.control_kind))
    fail("Choose the bank or cash account the money was paid from.", "ACCOUNTING_PAYROLL_INVALID", { field: "paidFromAccountId" });
  return account;
}

async function post(client, context, { event, sourceId, sourceNumber, date, description, lines }) {
  // A reversed document stays reversed: its correction is a new revision with its own id.
  const reversed = (await client.query(
    `SELECT entry.entry_number FROM tenant.accounting_journal_entries entry
      WHERE entry.organization_id = $1 AND entry.source_module = 'payroll' AND entry.source_type = $2 AND entry.source_id = $3 AND entry.status = 'reversed' LIMIT 1`,
    [context.organizationId, event, sourceId])).rows[0];
  if (reversed) throw new AccountingError(409, `${sourceNumber} was posted (${reversed.entry_number}) and reversed. Post the corrected run as a new revision.`, "ACCOUNTING_PAYROLL_REVERSED");
  const ledger = await getPrimaryLedger(client, context);
  const created = await createJournalEntry(client, context, {
    ledgerId: ledger.id, journalId: await generalJournal(client, context, ledger.id), entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger",
    reference: sourceNumber, description, lines,
  }, { internal: true, sourceModule: "payroll", sourceType: event, postingEvent: event, sourceId, sourceNumber });
  await postJournalEntry(client, context, created.entry.id, { internal: true, allowDraft: true });
  return getJournalEntry(client, context, created.entry.id);
}

// input: {
//   payrollRunId, number, postingDate, period ("Oct 2026"),
//   lines: [{ departmentId?, costCenterId?, gross, employerEpf?, employerEsi? }]     — one per department (or one for the company)
//   deductions: { tds?, employeeEpf?, employeeEsi?, pt? }, otherDeductions?: [{ accountId, amount, description }], netPay
// }
export async function postPayrollRun(client, context, input = {}, options = {}) {
  authorise(context, options);
  const runId = uuid(input.payrollRunId, "Payroll run");
  const number = requiredText(input.number, "Payroll run number", 100);
  const date = isoDate(input.postingDate, "Posting date");
  if (!Array.isArray(input.lines) || !input.lines.length) fail("A payroll posting needs its gross pay.");
  const ledger = await getPrimaryLedger(client, context);
  const account = async (key) => (await getAccountMapping(client, context, ledger.id, key, { date })).account_id;
  const deductions = input.deductions ?? {};
  const tds = amount(deductions.tds, "TDS");
  const employeeEpf = amount(deductions.employeeEpf, "Employee EPF");
  const employeeEsi = amount(deductions.employeeEsi, "Employee ESI");
  const pt = amount(deductions.pt, "Professional tax");
  const netPay = amount(input.netPay, "Net pay");
  const others = (input.otherDeductions ?? []).map((entry, index) => ({ accountId: uuid(entry.accountId, `Deduction ${index + 1} account`), amount: amount(entry.amount, `Deduction ${index + 1}`),
    description: text(entry.description, 200) || `Other deduction ${index + 1}` }));
  let gross = 0n; let employerEpf = 0n; let employerEsi = 0n;
  const lines = [];
  const salaryExpense = await account("salary_expense");
  let contributionExpense = null;
  for (const [index, line] of input.lines.entries()) {
    const lineGross = amount(line.gross, `Gross pay on line ${index + 1}`);
    const epf = amount(line.employerEpf, `Employer EPF on line ${index + 1}`);
    const esi = amount(line.employerEsi, `Employer ESI on line ${index + 1}`);
    gross = add(gross, lineGross); employerEpf = add(employerEpf, epf); employerEsi = add(employerEsi, esi);
    const dimensions = { departmentId: line.departmentId || null, costCenterId: line.costCenterId || null };
    if (lineGross > 0n) lines.push({ accountId: salaryExpense, debit: formatDecimal(lineGross), description: `Salaries and wages · ${input.period ?? number}`, ...dimensions });
    if (add(epf, esi) > 0n) {
      contributionExpense ??= await account("employer_contribution_expense");
      lines.push({ accountId: contributionExpense, debit: formatDecimal(add(epf, esi)), description: `Employer EPF and ESI · ${input.period ?? number}`, ...dimensions });
    }
  }
  if (gross <= 0n) fail("A payroll posting needs its gross pay.");
  const deducted = others.reduce((total, entry) => add(total, entry.amount), add(add(tds, employeeEpf), add(employeeEsi, pt)));
  if (add(netPay, deducted) !== gross)
    fail(`Gross pay ${formatDecimal(gross)} must equal net pay ${formatDecimal(netPay)} plus deductions ${formatDecimal(deducted)} (out by ${formatDecimal(sub(gross, add(netPay, deducted)))}).`,
      "ACCOUNTING_PAYROLL_UNBALANCED");
  const credit = async (key, value, description) => { if (value > 0n) lines.push({ accountId: await account(key), credit: formatDecimal(value), description }); };
  await credit("salary_payable", netPay, `Net pay owed · ${input.period ?? number}`);
  await credit("tds_payable", tds, "TDS deducted from salaries");
  await credit("epf_payable", add(employeeEpf, employerEpf), "EPF — employee and employer share");
  await credit("esi_payable", add(employeeEsi, employerEsi), "ESI — employee and employer share");
  await credit("pt_payable", pt, "Professional tax deducted");
  for (const entry of others) if (entry.amount > 0n) lines.push({ accountId: entry.accountId, credit: formatDecimal(entry.amount), description: entry.description });
  return post(client, context, { event: "payroll_run", sourceId: runId, sourceNumber: number, date, description: `Payroll ${input.period ?? number}`, lines });
}

// input: { paymentId, number, paymentDate, amount, paidFromAccountId, payrollRunNumber? }
export async function postSalaryPayment(client, context, input = {}, options = {}) {
  authorise(context, options);
  const date = isoDate(input.paymentDate, "Payment date");
  const value = amount(input.amount, "Amount");
  if (value <= 0n) fail("Enter the amount paid.");
  const bank = await paidFrom(client, context, input.paidFromAccountId);
  const ledger = await getPrimaryLedger(client, context);
  const payable = (await getAccountMapping(client, context, ledger.id, "salary_payable", { date })).account_id;
  const number = requiredText(input.number, "Payment number", 100);
  return post(client, context, {
    event: "salary_payment", sourceId: uuid(input.paymentId, "Salary payment"), sourceNumber: number, date,
    description: `Salaries paid${input.payrollRunNumber ? ` · ${text(input.payrollRunNumber, 100)}` : ""}`,
    lines: [{ accountId: payable, debit: formatDecimal(value), description: "Net pay settled" }, { accountId: bank.id, credit: formatDecimal(value), description: `Paid from ${bank.name}` }],
  });
}

// input: { paymentId, number (challan), kind: tds | epf | esi | pt, paymentDate, amount, paidFromAccountId }
export async function postStatutoryPayment(client, context, input = {}, options = {}) {
  authorise(context, options);
  const key = STATUTORY[input.kind];
  if (!key) fail("Choose TDS, EPF, ESI or professional tax.", "ACCOUNTING_PAYROLL_INVALID", { field: "kind" });
  const date = isoDate(input.paymentDate, "Payment date");
  const value = amount(input.amount, "Amount");
  if (value <= 0n) fail("Enter the amount paid.");
  const bank = await paidFrom(client, context, input.paidFromAccountId);
  const ledger = await getPrimaryLedger(client, context);
  const payable = (await getAccountMapping(client, context, ledger.id, key, { date })).account_id;
  const number = requiredText(input.number, "Challan number", 100);
  return post(client, context, {
    event: "statutory_payment", sourceId: uuid(input.paymentId, "Statutory payment"), sourceNumber: number, date, description: `${STATUTORY_LABEL[input.kind]} paid · challan ${number}`,
    lines: [{ accountId: payable, debit: formatDecimal(value), description: `${STATUTORY_LABEL[input.kind]} settled` }, { accountId: bank.id, credit: formatDecimal(value), description: `Paid from ${bank.name}` }],
  });
}

// A payroll posting is corrected by reversing it (on a date in an open period) and posting the corrected run as a new revision — its own
// payrollRunId — so the trail reads original → reversal → revised run (a document is journalled once per entry type, by design).
export async function reversePayrollPosting(client, context, { event, sourceId, reason, accountingDate } = {}, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.journalReverse);
  if (!["payroll_run", "salary_payment", "statutory_payment"].includes(event)) fail("Unknown payroll posting.");
  const posting = (await client.query(
    `SELECT journal_entry_id FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = $2 AND source_id = $3 AND status = 'POSTED' LIMIT 1`,
    [context.organizationId, event, uuid(sourceId, "Source")])).rows[0];
  if (!posting) throw new AccountingError(409, "There is no posted entry to reverse.", "ACCOUNTING_PAYROLL_NOT_POSTED");
  const internal = { ...context, permissions: [...(context.permissions ?? []), ACCOUNTING_PERMISSIONS.journalReverse] };
  return reverseJournalEntry(client, internal, posting.journal_entry_id, { reason: requiredText(reason, "Reason", 500), accountingDate });
}
