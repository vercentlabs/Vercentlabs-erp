// Automatic Accounting Posting — the one shared posting service between every module and the general ledger.
//
// A module that reaches a financial event (a sales invoice issued, a goods receipt, a supplier payment, a POS day …) writes one balanced
// journal through createJournalEntry/postJournalEntry (journals.js). Those two calls register it here as a posting: one row per posting
// event per source document, linked both ways (source → journal, journal → source). The database refuses a second live posting of the same
// event for the same document, so a retry or a double click never duplicates an entry.
//
//   atomic   a document and its journal commit together (a sales invoice, a supplier bill, a payment …): if the posting cannot be made the
//            document is not issued either, and the person sees why in plain words ("Select a sales revenue account …").
//   outbox   an operational event the business must not be blocked by (a POS sale at the counter, a provider settlement): the posting row is
//            committed with the event, attempted inside a savepoint, and when it fails it stays FAILED — visible on the Automatic postings
//            screen with its reason — and is retried in place once the cause is fixed.
//
// A scan also finds documents that reached their posting state without any journal, so nothing is left silently unposted.
import { ACCOUNTING_PERMISSIONS, AccountingError, hasPermission, requirePermission, text, uuid } from "./core.js";
import { POSTING_ACCOUNTS } from "./posting-accounts.js";
export { POSTING_ACCOUNTS, postingAccountLabel } from "./posting-accounts.js";

// ------------------------------------------------------------------ the catalogue
// Every financial event that posts, in plain words: the module, what happened, what it records, whether a document posts it once, and
// where its source document lives.
const E = (module, label, effect, once, href = null) => Object.freeze({ module, label, effect, once, href });
export const POSTING_EVENTS = Object.freeze({
  customer_invoice: E("Sales", "Sales invoice issued", "Customer receivable · sales revenue · output GST", true, "/sales/invoices/{id}"),
  customer_credit_note: E("Sales", "Credit note issued", "Reverses the revenue, receivable and GST it credits", true, "/sales/credit-notes/{id}"),
  customer_receipt: E("Sales", "Customer payment received", "Bank or cash up · customer receivable down", true, "/accounting/receipts/{id}"),
  customer_refund: E("Sales", "Customer refund paid", "Refund owed to the customer settled · bank or cash down", true, "/accounting/customer-refunds/{id}"),
  vendor_bill: E("Procurement", "Supplier invoice posted", "Supplier payable · purchase, expense or goods received · input GST", true, "/procurement/supplier-bills/{id}"),
  vendor_credit_note: E("Procurement", "Supplier credit note", "Reduces the supplier payable, the purchase and its input GST", true, "/procurement/supplier-bills/{id}"),
  vendor_bill_reverse_charge: E("Procurement", "Reverse-charge GST", "GST the business pays itself on a supplier invoice", true, "/procurement/supplier-bills/{id}"),
  vendor_payment: E("Procurement", "Supplier payment", "Supplier payable down · bank or cash down", true, "/accounting/payments/{id}"),
  vendor_credit_refund: E("Procurement", "Supplier credit refunded", "Money a supplier returned against a credit", false),
  goods_receipt: E("Inventory", "Goods received", "Inventory up · goods received not invoiced (perpetual inventory)", true, "/procurement/goods-receipts/{id}"),
  purchase_return: E("Procurement", "Goods returned to a supplier", "Inventory down · goods received not invoiced released", true, "/procurement/purchase-returns/{id}"),
  procurement_receipt: E("Inventory", "Goods received", "Inventory up · goods received not invoiced", true, "/procurement/goods-receipts/{id}"),
  sales_delivery: E("Inventory", "Goods delivered", "Cost of goods sold · inventory down", true, "/sales/deliveries/{id}"),
  sales_return: E("Inventory", "Customer return restocked", "Inventory back · cost of goods sold reversed", true, "/sales/returns/{id}"),
  goods_issue: E("Inventory", "Goods issued for use", "Expense or write-off · inventory down", true, "/inventory/goods-issues/{id}"),
  goods_issue_reversal: E("Inventory", "Goods issue reversed", "The issue's expense reversed · inventory back", true),
  inventory_adjustment: E("Inventory", "Stock adjustment", "Inventory gain or loss", true, "/inventory/adjustments/{id}"),
  inventory_adjustment_reversal: E("Inventory", "Stock adjustment reversed", "The adjustment's gain or loss reversed", true, "/inventory/adjustments/{id}"),
  stock_adjustment: E("Inventory", "Stock adjustment", "Inventory gain or loss", true, "/inventory/adjustments/{id}"),
  inventory_transfer: E("Inventory", "Stock transfer", "Inventory moved between locations", true, "/inventory/transfers/{id}"),
  opening_stock: E("Inventory", "Opening stock", "Inventory · opening balance equity", true, "/inventory/opening-stock/{id}"),
  inventory_valuation: E("Inventory", "Inventory valuation correction", "Inventory restated against cost of goods sold", false),
  manufacturing_material_issue: E("Manufacturing", "Material issued to production", "Work in progress up · inventory down", true, "/manufacturing/orders"),
  manufacturing_material_return: E("Manufacturing", "Material returned from production", "Inventory back · work in progress down", true, "/manufacturing/orders"),
  manufacturing_goods_receipt: E("Manufacturing", "Finished goods received", "Finished-goods inventory up · work in progress down", true, "/manufacturing/orders"),
  manufacturing_goods_receipt_reversal: E("Manufacturing", "Finished-goods receipt reversed", "Work in progress back up · finished-goods inventory down", true, "/manufacturing/finished-goods-receipts"),
  manufacturing_scrap: E("Manufacturing", "Manufacturing scrap", "Abnormal loss to manufacturing variance, or recoverable scrap to inventory · work in progress down", true, "/manufacturing/scrap"),
  manufacturing_scrap_reversal: E("Manufacturing", "Manufacturing scrap reversed", "Work in progress back up · the loss or scrap inventory reversed", true, "/manufacturing/scrap"),
  manufacturing_order_close: E("Manufacturing", "Manufacturing order closed", "Work in progress left at completion to manufacturing variance", true, "/manufacturing/orders/{id}"),
  manufacturing_cost_application: E("Manufacturing", "Labor or overhead applied", "Work in progress up · labor or overhead applied", true, "/manufacturing/orders"),
  manufacturing_cost_adjustment: E("Manufacturing", "Production cost adjustment", "Work in progress against manufacturing variance, as approved", true, "/manufacturing/orders"),
  pos_sale: E("POS", "POS sale", "Revenue · output GST · tender clearing · cost of goods sold", true, "/pos/receipts/{id}"),
  pos_return: E("POS", "POS return", "Revenue, GST and tender reversed · stock back", true, "/pos/returns/{id}"),
  payment_settlement_batch: E("POS", "Card / UPI settlement", "Clearing relieved · fees · net to bank", true, "/pos/reconciliation"),
  expense: E("Expenses", "Expense posted", "Expense · input GST (when claimable) · cash, bank or expense claims payable", true, "/accounting/expenses?id={id}"),
  expense_payment: E("Expenses", "Expense claim paid", "Expense claims payable down · cash or bank down", true, "/accounting/expenses?id={id}"),
  fund_transfer: E("Finance", "Bank / cash transfer", "Money moved between cash and bank accounts", true, "/accounting/fund-transfers?id={id}"),
  opening_balance: E("Finance", "Opening balances", "Opening balances · difference to opening balance equity", true, "/accounting/opening-balances?id={id}"),
  manual_journal: E("Finance", "Manual journal", "The approved debits and credits", false, "/accounting/journals/{journal}"),
  itc_decision: E("Finance", "Input tax credit decided", "Input GST moved from awaiting confirmation to claimable, or to cost", true, "/accounting/input-tax-credit"),
  year_end_close: E("Finance", "Year-end close", "Profit and loss closed to retained earnings", true, "/accounting/close-checklist"),
  payroll_run: E("Payroll", "Payroll run approved", "Salaries and employer contributions · net pay, TDS, EPF, ESI and PT owed", true),
  salary_payment: E("Payroll", "Salaries paid", "Salaries payable down · bank or cash down", true),
  statutory_payment: E("Payroll", "Statutory dues paid", "TDS, EPF, ESI or PT payable down · bank or cash down", true),
  asset_capitalization: E("Assets", "Asset capitalised", "Fixed asset recognised", true),
  asset_disposal: E("Assets", "Asset disposed", "Asset and depreciation removed · gain or loss", true),
  asset_depreciation_run: E("Assets", "Depreciation", "Depreciation expense · accumulated depreciation", true),
});
const REVERSAL_EVENTS = new Set(["journal_reversal"]);

export function postingEventOf(key) {
  return POSTING_EVENTS[key] ?? E("Finance", String(key ?? "posting").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()), "", false);
}
export function sourceHref(eventKey, sourceId, journalEntryId = null) {
  const template = POSTING_EVENTS[eventKey]?.href;
  if (!template) return null;
  return template.replace("{id}", sourceId ?? "").replace("{journal}", journalEntryId ?? sourceId ?? "");
}

// ------------------------------------------------------------------ helpers
const dayText = (value) => {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return String(value).slice(0, 10);
};
const LIVE = ["PENDING", "DRAFT", "POSTED", "FAILED"];

async function attempt(client, context, postingId, outcome, details = {}) {
  await client.query(
    `INSERT INTO tenant.accounting_posting_attempts (organization_id, posting_id, outcome, journal_entry_id, error_code, message, actor_user_id, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,
    [context.organizationId, postingId, outcome, details.journalEntryId ?? null, details.code ?? null, details.message ? String(details.message).slice(0, 2000) : null, context.userId ?? null],
  );
}

// Why a posting failed, in words a non-accountant can act on: { code, message, hint }.
export function explainPostingError(error) {
  const raw = String(error?.message ?? error ?? "The posting failed.").replace(/^[A-Za-z ]+: (?=[A-Z])/, (prefix) => (/^(Finance|Receipt accrual): $/.test(prefix) ? "" : prefix));
  const code = error?.code && /^[A-Z_]+$/.test(String(error.code)) ? String(error.code) : "ACCOUNTING_POSTING_FAILED";
  const rules = [
    [/ACCOUNTING_MAPPING_MISSING|Account mapping ([a-z_]+) is not configured|Select an? (.+?) account/, () => "Choose the missing account in Accounting › Posting accounts, then retry.", "ACCOUNTING_MAPPING_MISSING"],
    [/No fiscal period covers/, () => "Create the accounting period for this date in Accounting › Fiscal periods, then retry.", "ACCOUNTING_PERIOD_MISSING"],
    [/ACCOUNTING_PERIOD_CLOSED|(Fiscal|Accounting) period .+ is (soft_closed|in closing review|closed|locked)|period is (closed|not open)|Accounting period is not open/i, () => "The accounting period is closed. Reopen it, or correct the document's date, then retry.", "ACCOUNTING_PERIOD_CLOSED"],
    [/cannot receive this posting|is disabled/, () => "An account used by this posting is disabled or is a group heading. Choose another in Accounting › Posting accounts.", "ACCOUNTING_ACCOUNT_UNUSABLE"],
    [/No exchange rate exists/, () => "Add the exchange rate for this date in Accounting, then retry.", "ACCOUNTING_RATE_MISSING"],
    [/not balanced/i, () => "The entry did not balance, so nothing was written. Report this to support.", "ACCOUNTING_UNBALANCED"],
    [/journal is not configured|accounting journal is (not configured|unavailable)/i, () => "The journal this posting uses is missing or inactive. Check Accounting › Journals.", "ACCOUNTING_JOURNAL_MISSING"],
    [/already recorded in the accounts/, () => "Nothing to do: the entry already exists.", "ACCOUNTING_DUPLICATE_POSTING"],
  ];
  const text_ = `${code} ${raw}`;
  for (const [pattern, hint, mapped] of rules) if (pattern.test(text_)) return { code: code === "ACCOUNTING_POSTING_FAILED" || code === "ACCOUNTING_ERROR" ? mapped : code, message: raw.slice(0, 1000), hint: hint() };
  return { code, message: raw.slice(0, 1000), hint: "Fix the cause shown, then retry." };
}

// ------------------------------------------------------------------ the posting lifecycle (journals.js calls these)
// Opens (or re-opens, for a retry) the posting for an event about to write its journal. A document that already has a live posting of the
// event is refused: the entry exists.
export async function openPosting(client, context, descriptor) {
  const eventKey = text(descriptor.postingEvent || descriptor.sourceType, 100);
  if (!eventKey || REVERSAL_EVENTS.has(eventKey)) return null;
  const sourceId = uuid(descriptor.sourceId, "Source");
  const once = descriptor.once ?? postingEventOf(eventKey).once;
  const values = [context.organizationId, eventKey, text(descriptor.sourceModule, 50) || "accounting", text(descriptor.sourceType, 100) || eventKey, sourceId,
    text(descriptor.sourceNumber, 100) || null, once, descriptor.automatic ?? true, dayText(descriptor.transactionDate), dayText(descriptor.postingDate), context.userId ?? null];
  if (!once) {
    return (await client.query(
      `INSERT INTO tenant.accounting_postings (organization_id, posting_event, source_module, source_type, source_id, source_number, once_per_source, automatic, transaction_date, posting_date, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING') RETURNING *`, values)).rows[0];
  }
  await client.query(
    `INSERT INTO tenant.accounting_postings (organization_id, posting_event, source_module, source_type, source_id, source_number, once_per_source, automatic, transaction_date, posting_date, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING')
     ON CONFLICT (organization_id, posting_event, source_id) WHERE once_per_source AND status IN ('PENDING', 'DRAFT', 'POSTED', 'FAILED') DO NOTHING`, values);
  const row = (await client.query(
    `SELECT posting.*, entry.entry_number FROM tenant.accounting_postings posting LEFT JOIN tenant.accounting_journal_entries entry ON entry.id = posting.journal_entry_id
      WHERE posting.organization_id = $1 AND posting.posting_event = $2 AND posting.source_id = $3 AND posting.once_per_source AND posting.status = ANY($4::text[])
      FOR UPDATE OF posting`, [context.organizationId, eventKey, sourceId, LIVE])).rows[0];
  if (row.status === "DRAFT" || row.status === "POSTED") {
    const event = postingEventOf(eventKey);
    throw new AccountingError(409, `${event.label} ${row.source_number ?? ""} is already recorded in the accounts${row.entry_number ? ` (journal ${row.entry_number})` : ""}.`.replace("  ", " "),
      "ACCOUNTING_DUPLICATE_POSTING");
  }
  return row;
}

// The journal is written (draft): the posting now points at it.
export async function attachPostingJournal(client, context, posting, entry, amount) {
  if (!posting) return;
  await client.query(
    `UPDATE tenant.accounting_postings SET status = 'DRAFT', journal_entry_id = $3, amount = $4, currency_code = $5, posting_date = $6, transaction_date = COALESCE(transaction_date, $7),
            attempts = attempts + 1, error_code = NULL, error_message = NULL, error_hint = NULL, failed_at = NULL
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, posting.id, entry.id, amount, entry.functional_currency_code, dayText(entry.accounting_date), dayText(entry.document_date ?? entry.entry_date)]);
  await attempt(client, context, posting.id, "DRAFTED", { journalEntryId: entry.id });
}

// A manual journal is its own source: its posting is opened once the entry exists.
export async function openManualPosting(client, context, entry, amount) {
  const posting = (await client.query(
    `INSERT INTO tenant.accounting_postings (organization_id, posting_event, source_module, source_type, source_id, source_number, once_per_source, automatic, status, journal_entry_id,
       transaction_date, posting_date, amount, currency_code, attempts, created_by)
     VALUES ($1,'manual_journal','accounting','journal_entry',$2,$3,false,false,'DRAFT',$2,$4,$5,$6,$7,1,$8) RETURNING *`,
    [context.organizationId, entry.id, entry.entry_number, dayText(entry.document_date ?? entry.entry_date), dayText(entry.accounting_date), amount, entry.functional_currency_code, context.userId ?? null])).rows[0];
  await attempt(client, context, posting.id, "DRAFTED", { journalEntryId: entry.id });
}

export async function markPostingPosted(client, context, entry) {
  const rows = (await client.query(
    `UPDATE tenant.accounting_postings SET status = 'POSTED', posted_at = now(), posted_by = $3
      WHERE organization_id = $1 AND journal_entry_id = $2 AND status IN ('PENDING', 'DRAFT', 'FAILED') RETURNING id`,
    [context.organizationId, entry.id, context.userId ?? null])).rows;
  for (const row of rows) await attempt(client, context, row.id, "POSTED", { journalEntryId: entry.id });
}

export async function markPostingReversed(client, context, original, reversalEntryId, reason) {
  const rows = (await client.query(
    `UPDATE tenant.accounting_postings SET status = 'REVERSED', reversal_journal_entry_id = $3, reversed_at = now(), reversed_by = $4, reversal_reason = $5
      WHERE organization_id = $1 AND journal_entry_id = $2 AND status = 'POSTED' RETURNING id`,
    [context.organizationId, original.id, reversalEntryId, context.userId ?? null, text(reason, 1000) || null])).rows;
  for (const row of rows) await attempt(client, context, row.id, "REVERSED", { journalEntryId: reversalEntryId, message: reason });
}

// A failed attempt of an outbox posting: the row (re-)opened as FAILED with its reason. Never overwrites a posted one.
export async function recordPostingFailure(client, context, descriptor, error) {
  const eventKey = text(descriptor.postingEvent || descriptor.sourceType, 100);
  const sourceId = uuid(descriptor.sourceId, "Source");
  const failure = explainPostingError(error);
  if (failure.code === "ACCOUNTING_DUPLICATE_POSTING") return { ...failure, duplicate: true };
  const inserted = (await client.query(
    `INSERT INTO tenant.accounting_postings (organization_id, posting_event, source_module, source_type, source_id, source_number, once_per_source, automatic, status,
       transaction_date, amount, currency_code, detected_by, error_code, error_message, error_hint, failed_at, attempts, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,true,true,'FAILED',$7,$8,$9,$10,$11,$12,$13,now(),1,$14)
     ON CONFLICT (organization_id, posting_event, source_id) WHERE once_per_source AND status IN ('PENDING', 'DRAFT', 'POSTED', 'FAILED') DO NOTHING RETURNING id`,
    [context.organizationId, eventKey, text(descriptor.sourceModule, 50) || "accounting", text(descriptor.sourceType, 100) || eventKey, sourceId, text(descriptor.sourceNumber, 100) || null,
      dayText(descriptor.transactionDate), descriptor.amount ?? null, descriptor.currencyCode ?? null, descriptor.detectedBy ?? "POSTING", failure.code, failure.message, failure.hint, context.userId ?? null])).rows[0];
  const outcome = descriptor.detectedBy === "SCAN" ? "DETECTED_MISSING" : "FAILED";
  if (inserted) {
    await attempt(client, context, inserted.id, outcome, { code: failure.code, message: failure.message });
    return { ...failure, postingId: inserted.id };
  }
  const row = (await client.query(
    `SELECT * FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = $2 AND source_id = $3 AND once_per_source AND status = ANY($4::text[]) FOR UPDATE`,
    [context.organizationId, eventKey, sourceId, LIVE])).rows[0];
  if (!row || row.status === "POSTED" || row.status === "DRAFT") return { ...failure, duplicate: true };
  // A scan that finds a document already known to be missing adds nothing.
  if (descriptor.detectedBy === "SCAN" && row.status === "FAILED") return { ...failure, postingId: row.id, known: true };
  {
    await client.query(
      `UPDATE tenant.accounting_postings SET status = 'FAILED', error_code = $3, error_message = $4, error_hint = $5, failed_at = now(), attempts = attempts + 1,
              amount = COALESCE($6, amount), detected_by = CASE WHEN detected_by = 'SCAN' THEN 'SCAN' ELSE $7 END
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, failure.code, failure.message, failure.hint, descriptor.amount ?? null, descriptor.detectedBy ?? "POSTING"]);
  }
  await attempt(client, context, row.id, outcome, { code: failure.code, message: failure.message });
  return { ...failure, postingId: row.id };
}

// Runs one outbox posting: the work (which writes and posts its journal) inside a savepoint. On failure nothing it wrote survives, the
// failure is recorded on the posting, and the caller carries on. Returns { ok, result } or { ok: false, failure }.
let savepointSequence = 0;
export async function runOutboxPosting(client, context, descriptor, work) {
  savepointSequence = (savepointSequence + 1) % 1_000_000;
  const savepoint = `accounting_posting_${savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return { ok: true, result };
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    const failure = await recordPostingFailure(client, context, descriptor, error);
    return { ok: false, failure };
  }
}

// ------------------------------------------------------------------ retry, dismiss, scan
// How a failed or missing posting is retried, by event: registered by the module that owns the source document (it rebuilds the journal
// from the document as it is now, so a corrected mapping or a reopened period takes effect). handler(client, context, sourceId).
const RETRY_HANDLERS = new Map();
export function registerPostingRetry(eventKey, handler) {
  RETRY_HANDLERS.set(eventKey, handler);
}

async function lockPosting(client, context, postingIdValue) {
  const id = uuid(postingIdValue, "Posting");
  const row = (await client.query(`SELECT * FROM tenant.accounting_postings WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, id])).rows[0];
  if (!row) throw new AccountingError(404, "Posting not found.", "ACCOUNTING_POSTING_NOT_FOUND");
  return row;
}

export async function retryPosting(client, context, postingIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalPost);
  const row = await lockPosting(client, context, postingIdValue);
  if (row.status === "POSTED" || row.status === "DRAFT") return getPosting(client, context, row.id);
  if (row.status !== "FAILED" && row.status !== "PENDING") throw new AccountingError(409, `A ${row.status.toLowerCase()} posting is not retried.`, "ACCOUNTING_POSTING_NOT_RETRYABLE");
  const handler = RETRY_HANDLERS.get(row.posting_event);
  const event = postingEventOf(row.posting_event);
  if (!handler) {
    throw new AccountingError(409, `Open the ${event.label.toLowerCase()} ${row.source_number ?? ""} and post it again from there; its journal is rebuilt from the document.`.replace("  ", " "),
      "ACCOUNTING_POSTING_RETRY_FROM_SOURCE");
  }
  await attempt(client, context, row.id, "RETRY_REQUESTED");
  const descriptor = { postingEvent: row.posting_event, sourceModule: row.source_module, sourceType: row.source_type, sourceId: row.source_id, sourceNumber: row.source_number,
    transactionDate: row.transaction_date, amount: row.amount, currencyCode: row.currency_code, detectedBy: row.detected_by === "SCAN" ? "SCAN" : "POSTING" };
  // The handler rebuilds and posts the journal; an outbox poster records its own failure, anything it throws is recorded here.
  await runOutboxPosting(client, context, descriptor, () => handler(client, context, row.source_id));
  return getPosting(client, context, row.id);
}

export async function retryFailedPostings(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalPost);
  const values = [context.organizationId, [...RETRY_HANDLERS.keys()]];
  let where = "";
  if (filters.postingEvent) { values.push(text(filters.postingEvent, 100)); where = ` AND posting_event = $${values.length}`; }
  const rows = (await client.query(
    `SELECT id FROM tenant.accounting_postings WHERE organization_id = $1 AND status IN ('FAILED', 'PENDING') AND posting_event = ANY($2::text[])${where} ORDER BY created_at LIMIT 100`, values)).rows;
  const results = { posted: 0, failed: 0 };
  for (const row of rows) {
    const after = await retryPosting(client, context, row.id);
    if (after.status === "POSTED") results.posted += 1; else results.failed += 1;
  }
  return results;
}

// A failed posting that should not be posted (the document was cancelled another way, or it was posted by hand) is closed with a reason.
export async function dismissPosting(client, context, postingIdValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalPost);
  const row = await lockPosting(client, context, postingIdValue);
  if (row.status !== "FAILED" && row.status !== "PENDING") throw new AccountingError(409, "Only a failed or waiting posting can be dismissed.", "ACCOUNTING_POSTING_NOT_DISMISSIBLE");
  const reason = text(input.reason, 500);
  if (reason.length < 5) throw new AccountingError(400, "Give the reason this posting is not needed.", "ACCOUNTING_POSTING_REASON_REQUIRED");
  await client.query(`UPDATE tenant.accounting_postings SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null, reason]);
  await attempt(client, context, row.id, "CANCELLED", { message: reason });
  return getPosting(client, context, row.id);
}

// Documents that reached their posting state without a journal. Each one found becomes (or stays) a FAILED posting that says so.
const MISSING_CHECKS = [
  ["pos_sale", "point_of_sale", `SELECT sale.id, sale.receipt_number AS number, sale.grand_total AS amount, sale.currency_code AS currency, sale.completed_at AS at, sale.accounting_posting_error AS error
      FROM tenant.pos_sales sale
     WHERE sale.organization_id = $1 AND sale.status IN ('completed', 'partially_returned', 'returned') AND sale.journal_entry_id IS NULL
       AND EXISTS (SELECT 1 FROM tenant.pos_day_end_reports report WHERE report.organization_id = sale.organization_id AND report.status = 'closed'
                    AND report.lineage -> 'saleIds' ? sale.id::text)`, "This POS sale's day is closed, but the sale has no accounting entry yet."],
  ["pos_return", "point_of_sale", `SELECT ret.id, ret.return_number AS number, ret.refund_total AS amount, NULL AS currency, ret.completed_at AS at, ret.accounting_posting_error AS error
      FROM tenant.pos_returns ret
     WHERE ret.organization_id = $1 AND ret.status = 'completed' AND ret.journal_entry_id IS NULL
       AND EXISTS (SELECT 1 FROM tenant.pos_day_end_reports report WHERE report.organization_id = ret.organization_id AND report.status = 'closed'
                    AND report.lineage -> 'returnIds' ? ret.id::text)`, "This POS return's day is closed, but the return has no accounting entry yet."],
  ["payment_settlement_batch", "point_of_sale", `SELECT batch.id, batch.provider_settlement_id AS number, batch.calculated_net_amount AS amount, batch.currency_code AS currency, batch.created_at AS at, NULL AS error
      FROM tenant.payment_settlement_batches batch
     WHERE batch.organization_id = $1 AND batch.status = 'BANK_MATCHED' AND batch.finance_status IN ('PENDING', 'FAILED')`,
    "This settlement reached the bank, but it has not been posted to the accounts."],
  ["customer_invoice", "accounting", `SELECT invoice.id, invoice.invoice_number AS number, invoice.grand_total AS amount, invoice.currency_code AS currency, invoice.posted_at AS at, NULL AS error
      FROM tenant.accounting_customer_invoices invoice
     WHERE invoice.organization_id = $1 AND invoice.invoice_type <> 'credit_note' AND invoice.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed') AND invoice.journal_entry_id IS NULL`,
    "This invoice is issued, but it has no accounting entry."],
  ["vendor_bill", "accounting", `SELECT bill.id, bill.bill_number AS number, bill.grand_total AS amount, bill.currency_code AS currency, bill.posted_at AS at, NULL AS error
      FROM tenant.accounting_vendor_bills bill
     WHERE bill.organization_id = $1 AND bill.bill_type <> 'credit_note' AND bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed') AND bill.journal_entry_id IS NULL`,
    "This supplier invoice is posted, but it has no accounting entry."],
  ["customer_receipt", "accounting", `SELECT receipt.id, receipt.receipt_number AS number, receipt.amount, receipt.currency_code AS currency, receipt.posted_at AS at, NULL AS error
      FROM tenant.accounting_customer_receipts receipt
     WHERE receipt.organization_id = $1 AND receipt.status NOT IN ('draft', 'cancelled', 'reversed') AND receipt.journal_entry_id IS NULL`,
    "This customer payment is recorded, but it has no accounting entry."],
  ["vendor_payment", "accounting", `SELECT payment.id, payment.payment_number AS number, payment.amount, payment.currency_code AS currency, payment.posted_at AS at, NULL AS error
      FROM tenant.accounting_vendor_payments payment
     WHERE payment.organization_id = $1 AND payment.status NOT IN ('draft', 'pending_approval', 'approved', 'cancelled', 'rejected', 'reversed') AND payment.journal_entry_id IS NULL`,
    "This supplier payment is recorded, but it has no accounting entry."],
];

export async function scanMissingPostings(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalPost);
  const found = [];
  for (const [eventKey, module, query, message] of MISSING_CHECKS) {
    const rows = (await client.query(query, [context.organizationId])).rows;
    for (const row of rows) {
      const failure = await recordPostingFailure(client, context, {
        postingEvent: eventKey, sourceModule: module, sourceType: eventKey, sourceId: row.id, sourceNumber: row.number, transactionDate: row.at, amount: row.amount,
        currencyCode: row.currency ? String(row.currency).trim() : null, detectedBy: "SCAN",
      }, new AccountingError(409, row.error ? `${message} Last attempt: ${row.error}` : message, "ACCOUNTING_POSTING_MISSING"));
      if (!failure.duplicate && !failure.known) found.push({ postingEvent: eventKey, sourceId: row.id, number: row.number });
    }
  }
  return { found: found.length, items: found };
}

// ------------------------------------------------------------------ reading
const POSTING_SELECT = `SELECT posting.*, entry.entry_number, entry.status AS journal_status, entry.accounting_date AS journal_date, reversal.entry_number AS reversal_number,
       creator.full_name AS created_by_name, poster.full_name AS posted_by_name
  FROM tenant.accounting_postings posting
  LEFT JOIN tenant.accounting_journal_entries entry ON entry.id = posting.journal_entry_id
  LEFT JOIN tenant.accounting_journal_entries reversal ON reversal.id = posting.reversal_journal_entry_id
  LEFT JOIN public.users creator ON creator.id = posting.created_by
  LEFT JOIN public.users poster ON poster.id = posting.posted_by`;

function postingView(row) {
  const event = postingEventOf(row.posting_event);
  return {
    id: row.id, postingEvent: row.posting_event, module: event.module, label: event.label, effect: event.effect, automatic: row.automatic,
    sourceModule: row.source_module, sourceType: row.source_type, sourceId: row.source_id, sourceNumber: row.source_number, sourceHref: sourceHref(row.posting_event, row.source_id, row.journal_entry_id),
    status: row.status, journalEntryId: row.journal_entry_id, journalNumber: row.entry_number ?? null, reversalJournalEntryId: row.reversal_journal_entry_id, reversalNumber: row.reversal_number ?? null,
    transactionDate: dayText(row.transaction_date), postingDate: dayText(row.posting_date ?? row.journal_date), amount: row.amount === null ? null : String(row.amount), currency: row.currency_code,
    attempts: row.attempts, detectedBy: row.detected_by, error: row.error_message ? { code: row.error_code, message: row.error_message, hint: row.error_hint, at: row.failed_at } : null,
    createdBy: row.created_by_name ?? null, createdAt: row.created_at, postedBy: row.posted_by_name ?? null, postedAt: row.posted_at, reversedAt: row.reversed_at, reversalReason: row.reversal_reason,
    cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason, retryable: RETRY_HANDLERS.has(row.posting_event),
  };
}

export async function listPostings(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const where = [];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.status && filters.status !== "all") {
    if (filters.status === "attention") where.push(`posting.status IN ('FAILED', 'PENDING')`);
    else where.push(`posting.status = ${bind(text(filters.status, 20).toUpperCase())}`);
  }
  if (filters.postingEvent) where.push(`posting.posting_event = ${bind(text(filters.postingEvent, 100))}`);
  if (filters.module) where.push(`posting.posting_event = ANY(${bind(Object.entries(POSTING_EVENTS).filter(([, event]) => event.module === filters.module).map(([key]) => key))}::text[])`);
  if (filters.from) where.push(`COALESCE(posting.posting_date, posting.transaction_date, posting.created_at::date) >= ${bind(dayText(filters.from))}::date`);
  if (filters.to) where.push(`COALESCE(posting.posting_date, posting.transaction_date, posting.created_at::date) <= ${bind(dayText(filters.to))}::date`);
  if (filters.search) where.push(`(posting.source_number ILIKE ${bind(`%${text(filters.search, 100)}%`)} OR entry.entry_number ILIKE $${values.length})`);
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const rows = (await client.query(`${POSTING_SELECT} WHERE posting.organization_id = $1${where.length ? ` AND ${where.join(" AND ")}` : ""}
    ORDER BY CASE posting.status WHEN 'FAILED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END, posting.created_at DESC LIMIT ${limit}`, values)).rows;
  return rows.map(postingView);
}

export async function getPosting(client, context, postingIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(postingIdValue, "Posting");
  const row = (await client.query(`${POSTING_SELECT} WHERE posting.organization_id = $1 AND posting.id = $2`, [context.organizationId, id])).rows[0];
  if (!row) throw new AccountingError(404, "Posting not found.", "ACCOUNTING_POSTING_NOT_FOUND");
  const history = (await client.query(
    `SELECT attempt.outcome, attempt.error_code, attempt.message, attempt.occurred_at, attempt.journal_entry_id, entry.entry_number, actor.full_name AS actor
       FROM tenant.accounting_posting_attempts attempt LEFT JOIN tenant.accounting_journal_entries entry ON entry.id = attempt.journal_entry_id
       LEFT JOIN public.users actor ON actor.id = attempt.actor_user_id
      WHERE attempt.organization_id = $1 AND attempt.posting_id = $2 ORDER BY attempt.occurred_at, attempt.id`, [context.organizationId, id])).rows;
  return { ...postingView(row), history: history.map((entry) => ({ outcome: entry.outcome, code: entry.error_code, message: entry.message, at: entry.occurred_at,
    journalEntryId: entry.journal_entry_id, journalNumber: entry.entry_number, actor: entry.actor })) };
}

async function journalLinesOf(client, context, entryIds) {
  if (!entryIds.length) return new Map();
  const rows = (await client.query(
    `SELECT line.journal_entry_id, line.sequence, line.description, line.base_debit_amount, line.base_credit_amount, line.metadata, account.id AS account_id, account.code, account.name
       FROM tenant.accounting_journal_lines line JOIN tenant.accounting_accounts account ON account.id = line.account_id
      WHERE line.organization_id = $1 AND line.journal_entry_id = ANY($2::uuid[]) ORDER BY line.journal_entry_id, line.sequence`, [context.organizationId, entryIds])).rows;
  const byEntry = new Map();
  for (const row of rows) {
    const list = byEntry.get(row.journal_entry_id) ?? [];
    list.push({ accountId: row.account_id, account: `${row.code} · ${row.name}`, description: row.description, debit: String(row.base_debit_amount), credit: String(row.base_credit_amount) });
    byEntry.set(row.journal_entry_id, list);
  }
  return byEntry;
}

// "Accounting recorded automatically" for a document: its postings and, for people who may see Accounting, each journal's lines summed
// by account.
export async function getSourceAccounting(client, context, sourceTypeValue, sourceIdValue) {
  const sourceId = uuid(sourceIdValue, "Source");
  const types = String(sourceTypeValue || "").split(",").map((value) => text(value, 100)).filter(Boolean);
  const rows = (await client.query(`${POSTING_SELECT} WHERE posting.organization_id = $1 AND posting.source_id = $2${types.length ? " AND posting.source_type = ANY($3::text[])" : ""}
      ORDER BY posting.created_at`, types.length ? [context.organizationId, sourceId, types] : [context.organizationId, sourceId])).rows;
  const itc = (await client.query(`${POSTING_SELECT} WHERE posting.organization_id = $1 AND posting.posting_event = 'itc_decision' AND posting.source_id = $2`, [context.organizationId, sourceId])).rows;
  const all = [...rows, ...itc.filter((row) => !rows.some((other) => other.id === row.id))];
  const detailed = hasPermission(context, ACCOUNTING_PERMISSIONS.view);
  const lines = detailed ? await journalLinesOf(client, context, all.flatMap((row) => [row.journal_entry_id, row.reversal_journal_entry_id]).filter(Boolean)) : new Map();
  const summarise = (entryId) => {
    const byAccount = new Map();
    for (const line of lines.get(entryId) ?? []) {
      const current = byAccount.get(line.accountId) ?? { account: line.account, debit: 0, credit: 0 };
      current.debit += Number(line.debit);
      current.credit += Number(line.credit);
      byAccount.set(line.accountId, current);
    }
    return [...byAccount.values()].map((row) => ({ account: row.account, debit: row.debit.toFixed(2), credit: row.credit.toFixed(2) }));
  };
  return {
    detailed,
    postings: all.map((row) => ({ ...postingView(row), lines: detailed && row.journal_entry_id ? summarise(row.journal_entry_id) : [],
      reversalLines: detailed && row.reversal_journal_entry_id ? summarise(row.reversal_journal_entry_id) : [] })),
  };
}

// The journal list: filter by date, account, document type, status and origin (automatic / manual).
export async function searchJournalEntries(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const where = [];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.from) where.push(`entry.accounting_date >= ${bind(dayText(filters.from))}::date`);
  if (filters.to) where.push(`entry.accounting_date <= ${bind(dayText(filters.to))}::date`);
  if (filters.status && filters.status !== "all") where.push(`entry.status = ${bind(text(filters.status, 30))}`);
  if (filters.documentType) where.push(`COALESCE(entry.source_type, 'manual_journal') = ${bind(text(filters.documentType, 100))}`);
  if (filters.origin === "automatic") where.push(`entry.source_type IS NOT NULL`);
  if (filters.origin === "manual") where.push(`entry.source_type IS NULL`);
  if (filters.accountId) where.push(`EXISTS (SELECT 1 FROM tenant.accounting_journal_lines filter_line WHERE filter_line.journal_entry_id = entry.id AND filter_line.account_id = ${bind(uuid(filters.accountId, "Account"))})`);
  if (filters.search) where.push(`(entry.entry_number ILIKE ${bind(`%${text(filters.search, 100)}%`)} OR entry.description ILIKE $${values.length} OR entry.reference ILIKE $${values.length} OR entry.source_number ILIKE $${values.length})`);
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
  const rows = (await client.query(
    `SELECT entry.id, entry.entry_number, entry.entry_date, entry.accounting_date, entry.document_date, entry.entry_type, entry.description, entry.reference, entry.status,
            entry.source_module, entry.source_type, entry.source_id, entry.source_number, entry.functional_currency_code, entry.created_at, entry.posted_at,
            creator.full_name AS created_by_name, poster.full_name AS posted_by_name,
            (SELECT COALESCE(sum(line.base_debit_amount), 0) FROM tenant.accounting_journal_lines line WHERE line.journal_entry_id = entry.id) AS total,
            (SELECT posting.posting_event FROM tenant.accounting_postings posting WHERE posting.journal_entry_id = entry.id ORDER BY posting.created_at LIMIT 1) AS posting_event
       FROM tenant.accounting_journal_entries entry
       LEFT JOIN public.users creator ON creator.id = entry.created_by
       LEFT JOIN public.users poster ON poster.id = entry.posted_by
      WHERE entry.organization_id = $1${where.length ? ` AND ${where.join(" AND ")}` : ""}
      ORDER BY entry.accounting_date DESC, entry.created_at DESC LIMIT ${limit}`, values)).rows;
  return rows.map((row) => {
    const eventKey = row.posting_event ?? row.source_type ?? (row.entry_type === "reversal" ? "journal_reversal" : "manual_journal");
    return {
      id: row.id, number: row.entry_number, accountingDate: dayText(row.accounting_date), transactionDate: dayText(row.document_date ?? row.entry_date), type: row.entry_type,
      description: row.description, reference: row.reference, status: row.status, automatic: row.source_type !== null && row.entry_type !== "reversal",
      documentType: eventKey, documentLabel: eventKey === "journal_reversal" ? "Reversal" : postingEventOf(eventKey).label, sourceNumber: row.source_number,
      sourceHref: row.source_id ? sourceHref(eventKey, row.source_id, row.id) : null, total: String(row.total), currency: row.functional_currency_code,
      createdBy: row.created_by_name, postedBy: row.posted_by_name, postedAt: row.posted_at,
    };
  });
}

// One journal, with its source document (journal → source), its posting history, and the entry it reverses or that reversed it.
export async function getJournalEntryDetail(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(idValue, "Journal entry");
  const entry = (await client.query(
    `SELECT entry.*, journal.code AS journal_code, journal.name AS journal_name, period.name AS period_name, period.status AS period_status,
            creator.full_name AS created_by_name, poster.full_name AS posted_by_name, approver.full_name AS approved_by_name,
            reversed_by.entry_number AS reversed_by_number, reversal_of.entry_number AS reversal_of_number
       FROM tenant.accounting_journal_entries entry
       JOIN tenant.accounting_journals journal ON journal.id = entry.journal_id
       JOIN tenant.fiscal_periods period ON period.id = entry.fiscal_period_id
       LEFT JOIN public.users creator ON creator.id = entry.created_by
       LEFT JOIN public.users poster ON poster.id = entry.posted_by
       LEFT JOIN public.users approver ON approver.id = entry.approved_by
       LEFT JOIN tenant.accounting_journal_entries reversed_by ON reversed_by.id = entry.reversed_by_id
       LEFT JOIN tenant.accounting_journal_entries reversal_of ON reversal_of.id = entry.reversal_of_id
      WHERE entry.organization_id = $1 AND entry.id = $2`, [context.organizationId, id])).rows[0];
  if (!entry) throw new AccountingError(404, "Journal entry not found.", "ACCOUNTING_JOURNAL_NOT_FOUND");
  const lines = (await client.query(
    `SELECT line.sequence, line.description, line.currency_code, line.debit_amount, line.credit_amount, line.base_debit_amount, line.base_credit_amount, line.tax_code, line.metadata,
            account.id AS account_id, account.code AS account_code, account.name AS account_name, account.account_class, party.display_name AS party_name,
            department.name AS department_name, cost_center.name AS cost_center_name
       FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_accounts account ON account.id = line.account_id
       LEFT JOIN tenant.business_parties party ON party.id = line.party_id
       LEFT JOIN public.departments department ON department.id = line.department_id
       LEFT JOIN public.cost_centers cost_center ON cost_center.id = line.cost_center_id
      WHERE line.organization_id = $1 AND line.journal_entry_id = $2 ORDER BY line.sequence`, [context.organizationId, id])).rows;
  const posting = (await client.query(`SELECT id FROM tenant.accounting_postings WHERE organization_id = $1 AND (journal_entry_id = $2 OR reversal_journal_entry_id = $2) ORDER BY created_at LIMIT 1`,
    [context.organizationId, id])).rows[0];
  const reversalOf = entry.reversal_of_id ? (await client.query(`SELECT id FROM tenant.accounting_postings WHERE organization_id = $1 AND journal_entry_id = $2 LIMIT 1`,
    [context.organizationId, entry.reversal_of_id])).rows[0] : null;
  const postingDetail = posting ? await getPosting(client, context, posting.id) : reversalOf ? await getPosting(client, context, reversalOf.id) : null;
  const eventKey = postingDetail?.postingEvent ?? entry.source_type ?? (entry.entry_type === "reversal" ? "journal_reversal" : "manual_journal");
  const sum = (key) => lines.reduce((total, line) => total + Number(line[key]), 0).toFixed(2);
  return {
    id: entry.id, number: entry.entry_number, journal: `${entry.journal_code} · ${entry.journal_name}`, period: entry.period_name, periodStatus: entry.period_status,
    entryDate: dayText(entry.entry_date), accountingDate: dayText(entry.accounting_date), documentDate: dayText(entry.document_date), type: entry.entry_type,
    description: entry.description, reference: entry.reference, status: entry.status, contentHash: entry.content_hash, currency: entry.currency_code, functionalCurrency: entry.functional_currency_code, exchangeRate: String(entry.exchange_rate),
    automatic: entry.source_type !== null && entry.entry_type !== "reversal",
    source: entry.source_type && entry.entry_type !== "reversal"
      ? { type: entry.source_type, label: postingEventOf(eventKey).label, module: postingEventOf(eventKey).module, number: entry.source_number, href: sourceHref(eventKey, entry.source_id, entry.id) }
      : null,
    createdBy: entry.created_by_name, createdAt: entry.created_at, approvedBy: entry.approved_by_name, approvedAt: entry.approved_at, postedBy: entry.posted_by_name, postedAt: entry.posted_at,
    reversedBy: entry.reversed_by_id ? { id: entry.reversed_by_id, number: entry.reversed_by_number, reason: entry.reversal_reason } : null,
    reversalOf: entry.reversal_of_id ? { id: entry.reversal_of_id, number: entry.reversal_of_number } : null,
    lines: lines.map((line) => ({ sequence: line.sequence, accountId: line.account_id, account: `${line.account_code} · ${line.account_name}`, accountClass: line.account_class,
      description: line.description, party: line.party_name, department: line.department_name, costCenter: line.cost_center_name, taxType: line.metadata?.taxType ?? null,
      currency: line.currency_code, debit: String(line.base_debit_amount), credit: String(line.base_credit_amount) })),
    totals: { debit: sum("base_debit_amount"), credit: sum("base_credit_amount") },
    posting: postingDetail,
  };
}

// An account's ledger between two dates: the balance brought forward, every posted line with a running balance, and each line's journal
// and source document.
export async function getAccountLedger(client, context, accountIdValue, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const accountId = uuid(accountIdValue, "Account");
  const account = (await client.query(`SELECT id, code, name, account_class, account_type, normal_balance, status, is_group FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, accountId])).rows[0];
  if (!account) throw new AccountingError(404, "Account not found.", "ACCOUNTING_ACCOUNT_NOT_FOUND");
  const from = dayText(filters.from) ?? "1900-01-01";
  const to = dayText(filters.to) ?? "9999-12-31";
  const sign = account.normal_balance === "credit" ? -1 : 1;
  // Department and cost centre narrow the lines (the General Ledger passes its filter through to the account it opens).
  const dimensionValues = [];
  let dimensionWhere = "";
  if (filters.departmentId) { dimensionValues.push(uuid(filters.departmentId, "Department")); dimensionWhere += ` AND line.department_id = $DIM${dimensionValues.length}`; }
  if (filters.costCenterId) { dimensionValues.push(uuid(filters.costCenterId, "Cost centre")); dimensionWhere += ` AND line.cost_center_id = $DIM${dimensionValues.length}`; }
  const dims = (offset) => dimensionWhere.replace(/\$DIM(\d)/g, (_, index) => `$${offset + Number(index)}`);
  const opening = (await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS amount FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id
      WHERE line.organization_id = $1 AND line.account_id = $2 AND entry.status IN ('posted', 'reversed') AND entry.accounting_date < $3::date${dims(3)}`,
    [context.organizationId, accountId, from, ...dimensionValues])).rows[0].amount;
  const rows = (await client.query(
    `SELECT entry.id AS entry_id, entry.entry_number, entry.accounting_date, entry.description AS entry_description, entry.source_type, entry.source_id, entry.source_number, entry.entry_type,
            line.description, line.base_debit_amount, line.base_credit_amount, party.display_name AS party_name,
            (SELECT posting.posting_event FROM tenant.accounting_postings posting WHERE posting.journal_entry_id = entry.id LIMIT 1) AS posting_event
       FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id
       LEFT JOIN tenant.business_parties party ON party.id = line.party_id
      WHERE line.organization_id = $1 AND line.account_id = $2 AND entry.status IN ('posted', 'reversed') AND entry.accounting_date BETWEEN $3::date AND $4::date${dims(4)}
      ORDER BY entry.accounting_date, entry.posted_at, entry.entry_number, line.sequence LIMIT 2000`, [context.organizationId, accountId, from, to, ...dimensionValues])).rows;
  let running = Number(opening);
  const lines = rows.map((row) => {
    running += Number(row.base_debit_amount) - Number(row.base_credit_amount);
    const eventKey = row.posting_event ?? row.source_type ?? (row.entry_type === "reversal" ? "journal_reversal" : "manual_journal");
    return { journalEntryId: row.entry_id, journalNumber: row.entry_number, date: dayText(row.accounting_date), description: row.description || row.entry_description, party: row.party_name,
      document: eventKey === "journal_reversal" ? "Reversal" : postingEventOf(eventKey).label, sourceNumber: row.source_number,
      sourceHref: row.source_id ? sourceHref(eventKey, row.source_id, row.entry_id) : null, debit: String(row.base_debit_amount), credit: String(row.base_credit_amount),
      balance: (running * sign).toFixed(2) };
  });
  const debit = rows.reduce((total, row) => total + Number(row.base_debit_amount), 0);
  const credit = rows.reduce((total, row) => total + Number(row.base_credit_amount), 0);
  return { account: { id: account.id, code: account.code, name: account.name, accountClass: account.account_class, normalBalance: account.normal_balance, status: account.status },
    from: filters.from ? from : null, to: filters.to ? to : null, opening: (Number(opening) * sign).toFixed(2), debit: debit.toFixed(2), credit: credit.toFixed(2),
    closing: (running * sign).toFixed(2), lines };
}

// ------------------------------------------------------------------ health: the books balance, nothing is stuck
export async function getPostingHealth(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const totals = (await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount), 0) AS debit, COALESCE(sum(line.base_credit_amount), 0) AS credit
       FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id
      WHERE line.organization_id = $1 AND entry.status IN ('posted', 'reversed')`, [context.organizationId])).rows[0];
  const unbalanced = (await client.query(
    `SELECT entry.id, entry.entry_number FROM tenant.accounting_journal_entries entry
      WHERE entry.organization_id = $1 AND entry.status IN ('posted', 'reversed')
        AND (SELECT COALESCE(sum(base_debit_amount - base_credit_amount), 0) FROM tenant.accounting_journal_lines line WHERE line.journal_entry_id = entry.id) <> 0 LIMIT 20`,
    [context.organizationId])).rows;
  const counts = (await client.query(`SELECT status, count(*)::int AS count FROM tenant.accounting_postings WHERE organization_id = $1 GROUP BY status`, [context.organizationId])).rows;
  const byStatus = Object.fromEntries(["PENDING", "DRAFT", "POSTED", "FAILED", "REVERSED", "CANCELLED"].map((status) => [status, counts.find((row) => row.status === status)?.count ?? 0]));
  const stale = (await client.query(
    `SELECT count(*)::int AS count FROM tenant.accounting_postings posting JOIN tenant.accounting_journal_entries entry ON entry.id = posting.journal_entry_id
      WHERE posting.organization_id = $1 AND posting.status = 'DRAFT' AND posting.automatic AND entry.status = 'draft' AND posting.updated_at < now() - interval '1 hour'`,
    [context.organizationId])).rows[0].count;
  const unlinked = (await client.query(
    `SELECT count(*)::int AS count FROM tenant.accounting_journal_entries entry
      WHERE entry.organization_id = $1 AND entry.entry_type <> 'reversal' AND entry.status IN ('posted', 'reversed')
        AND NOT EXISTS (SELECT 1 FROM tenant.accounting_postings posting WHERE posting.journal_entry_id = entry.id)`, [context.organizationId])).rows[0].count;
  const oldestFailure = (await client.query(`SELECT min(COALESCE(failed_at, created_at)) AS at FROM tenant.accounting_postings WHERE organization_id = $1 AND status = 'FAILED'`, [context.organizationId])).rows[0].at;
  const byModule = (await client.query(
    `SELECT posting_event, status, count(*)::int AS count FROM tenant.accounting_postings WHERE organization_id = $1 GROUP BY 1, 2`, [context.organizationId])).rows;
  const modules = {};
  for (const row of byModule) {
    const module = postingEventOf(row.posting_event).module;
    modules[module] ??= { module, posted: 0, failed: 0, other: 0 };
    if (row.status === "POSTED" || row.status === "REVERSED") modules[module].posted += row.count;
    else if (row.status === "FAILED" || row.status === "PENDING") modules[module].failed += row.count;
    else modules[module].other += row.count;
  }
  const debit = Number(totals.debit);
  const credit = Number(totals.credit);
  return {
    trialBalance: { debit: debit.toFixed(2), credit: credit.toFixed(2), balanced: Math.abs(debit - credit) < 0.005, difference: (debit - credit).toFixed(2) },
    unbalancedEntries: unbalanced.map((row) => ({ id: row.id, number: row.entry_number })),
    postings: byStatus, stuckDrafts: stale, unlinkedJournals: unlinked, oldestFailureAt: oldestFailure,
    modules: Object.values(modules).sort((a, b) => a.module.localeCompare(b.module)),
    healthy: Math.abs(debit - credit) < 0.005 && !unbalanced.length && !byStatus.FAILED && !byStatus.PENDING && !stale,
  };
}

// The event catalogue as the coverage map shows it: every event, what it records, how many posted and how many need attention.
export async function getPostingCoverage(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const counts = (await client.query(`SELECT posting_event, status, count(*)::int AS count FROM tenant.accounting_postings WHERE organization_id = $1 GROUP BY 1, 2`, [context.organizationId])).rows;
  return Object.entries(POSTING_EVENTS).map(([key, event]) => {
    const of = (status) => counts.filter((row) => row.posting_event === key && status.includes(row.status)).reduce((total, row) => total + row.count, 0);
    return { postingEvent: key, module: event.module, label: event.label, effect: event.effect, oncePerDocument: event.once, retryable: RETRY_HANDLERS.has(key),
      posted: of(["POSTED"]), reversed: of(["REVERSED"]), attention: of(["FAILED", "PENDING"]) };
  });
}

// ------------------------------------------------------------------ posting accounts (the company's default account per mapping key)
const POSTING_ACCOUNT_SQL = `SELECT mapping.id, mapping.mapping_key, mapping.priority, mapping.effective_from, mapping.effective_to, mapping.status, mapping.created_at, mapping.updated_at,
       account.id AS account_id, account.code, account.name, account.account_class, account.account_type, account.status AS account_status, account.is_group,
       creator.full_name AS changed_by
  FROM tenant.accounting_account_mappings mapping
  JOIN tenant.accounting_accounts account ON account.id = mapping.account_id
  LEFT JOIN public.users creator ON creator.id = COALESCE(mapping.updated_by, mapping.created_by)
 WHERE mapping.organization_id = $1 AND mapping.ledger_id = $2 AND mapping.party_id IS NULL AND mapping.item_id IS NULL AND mapping.item_group_id IS NULL AND mapping.tax_category_id IS NULL`;

async function primaryLedgerId(client, context) {
  const ledger = (await client.query(`SELECT id FROM tenant.accounting_ledgers WHERE organization_id = $1 AND ledger_type = 'primary' AND status = 'active' LIMIT 1`, [context.organizationId])).rows[0];
  if (!ledger) throw new AccountingError(409, "An active accounting ledger is not configured for the organisation.", "ACCOUNTING_LEDGER_MISSING");
  return ledger.id;
}

// Every posting account in plain words, the account it uses today, whether that account can take postings, and how many product, party
// or category overrides refine it.
export async function listPostingAccounts(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const ledgerId = await primaryLedgerId(client, context);
  const today = dayText(new Date());
  const rows = (await client.query(`${POSTING_ACCOUNT_SQL} ORDER BY mapping.mapping_key, mapping.priority, mapping.effective_from DESC NULLS LAST`, [context.organizationId, ledgerId])).rows;
  const overrides = (await client.query(
    `SELECT mapping_key, count(*)::int AS count FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND ledger_id = $2 AND status = 'active'
        AND (party_id IS NOT NULL OR item_id IS NOT NULL OR item_group_id IS NOT NULL OR tax_category_id IS NOT NULL) GROUP BY 1`, [context.organizationId, ledgerId])).rows;
  const accounts = (await client.query(
    `SELECT id, code, name, account_class, account_type FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND status = 'active' AND NOT is_group ORDER BY code`,
    [context.organizationId, ledgerId])).rows;
  const isCurrent = (row) => row.status === "active" && (!row.effective_from || dayText(row.effective_from) <= today) && (!row.effective_to || dayText(row.effective_to) >= today);
  const items = Object.entries(POSTING_ACCOUNTS).map(([key, spec]) => {
    const row = rows.find((entry) => entry.mapping_key === key && isCurrent(entry));
    let state = "ok";
    let problem = null;
    if (!row) {
      state = spec.optional ? "not_used" : "missing";
      problem = spec.optional ? null : `Choose the ${spec.label.toLowerCase()} account — postings that need it fail until then.`;
    } else if (row.account_status !== "active" || row.is_group) {
      state = "unusable";
      problem = `${row.code} · ${row.name} is ${row.is_group ? "a group heading" : "disabled"}; choose another.`;
    } else if (!spec.classes.includes(row.account_class)) {
      state = "incompatible";
      problem = `${row.code} · ${row.name} is a ${row.account_class} account; this needs ${spec.classes.join(" or ")}.`;
    }
    const history = rows.filter((entry) => entry.mapping_key === key && entry !== row).slice(0, 5).map((entry) => ({ account: `${entry.code} · ${entry.name}`,
      from: dayText(entry.effective_from), to: dayText(entry.effective_to), status: entry.status, changedBy: entry.changed_by }));
    return { key, group: spec.group, label: spec.label, purpose: spec.purpose, optional: spec.optional, classes: spec.classes, state, problem,
      account: row ? { id: row.account_id, code: row.code, name: row.name, accountClass: row.account_class, since: dayText(row.effective_from) } : null,
      overrides: overrides.find((entry) => entry.mapping_key === key)?.count ?? 0, history };
  });
  return { ledgerId, items, accounts: accounts.map((row) => ({ id: row.id, code: row.code, name: row.name, accountClass: row.account_class, accountType: row.account_type })) };
}

// Changes the account a posting uses from today on. Earlier entries keep the account they were posted to, and a transaction dated before
// today still resolves the account that applied then; the change is recorded with who made it.
export async function setPostingAccount(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
  const key = text(input.key, 100);
  const spec = POSTING_ACCOUNTS[key];
  if (!spec) throw new AccountingError(400, "Choose a posting account from the list.", "ACCOUNTING_POSTING_ACCOUNT_UNKNOWN");
  const ledgerId = await primaryLedgerId(client, context);
  const accountId = uuid(input.accountId, "Account");
  const account = (await client.query(`SELECT id, code, name, account_class, status, is_group FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND id = $3`,
    [context.organizationId, ledgerId, accountId])).rows[0];
  if (!account) throw new AccountingError(404, "Account not found.", "ACCOUNTING_ACCOUNT_NOT_FOUND");
  if (account.status !== "active" || account.is_group) {
    throw new AccountingError(409, `${account.code} · ${account.name} is ${account.is_group ? "a group heading" : "disabled"}; choose an account that takes postings.`, "ACCOUNTING_ACCOUNT_UNUSABLE");
  }
  if (!spec.classes.includes(account.account_class)) {
    throw new AccountingError(409, `${spec.label} needs a ${spec.classes.join(" or ")} account; ${account.code} · ${account.name} is ${account.account_class}.`, "ACCOUNTING_ACCOUNT_INCOMPATIBLE");
  }
  const today = dayText(new Date());
  const live = (await client.query(`${POSTING_ACCOUNT_SQL} AND mapping.mapping_key = $3 AND mapping.status = 'active' AND (mapping.effective_to IS NULL OR mapping.effective_to >= $4::date)
      ORDER BY mapping.priority FOR UPDATE OF mapping`, [context.organizationId, ledgerId, key, today])).rows;
  const before = live.find((row) => !row.effective_from || dayText(row.effective_from) <= today);
  if (before && before.account_id === account.id && before.priority <= 100) return { key, account: { id: account.id, code: account.code, name: account.name }, changed: false };
  for (const row of live) {
    if (row.priority > 100) continue; // the seeded fallback stays underneath
    if (row.effective_from && dayText(row.effective_from) >= today) {
      await client.query(`UPDATE tenant.accounting_account_mappings SET status = 'inactive', updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, row.id, context.userId ?? null]);
    } else {
      await client.query(`UPDATE tenant.accounting_account_mappings SET effective_to = ($3::date - 1), updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, row.id, today, context.userId ?? null]);
    }
  }
  await client.query(
    `INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, effective_from, status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,100,$5,'active',$6,$6)`, [context.organizationId, ledgerId, key, account.id, today, context.userId ?? null]);
  await client.query(
    `INSERT INTO tenant.accounting_events (organization_id, entity_type, entity_id, event_type, metadata, actor_user_id) VALUES ($1,'accounting_settings',$1,'accounting.posting_account.changed',$2::jsonb,$3)`,
    [context.organizationId, JSON.stringify({ key, from: before ? { id: before.account_id, code: before.code } : null, to: { id: account.id, code: account.code }, effectiveFrom: today }), context.userId ?? null]);
  return { key, account: { id: account.id, code: account.code, name: account.name }, changed: true, effectiveFrom: today };
}

