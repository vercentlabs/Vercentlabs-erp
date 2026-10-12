// Input tax credit: input GST on a supplier invoice (or an expense) is not claimable merely because the invoice exists. It waits on the
// "Input GST awaiting ITC confirmation" account until someone confirms the statutory conditions are met (the invoice appears in GSTR-2B,
// the goods or services were received, the supplier filed) — then one journal moves it to the claimable CGST / SGST / IGST / cess accounts —
// or decides it cannot be claimed, and it becomes a cost. One decision per document, posted through the shared posting service; undoing it
// reverses that journal and the credit waits again.
import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  asDatabaseDecimal,
  decimal,
  getAccountMapping,
  getPrimaryLedger,
  requirePermission,
  text,
  uuid,
} from "./core.js";
import { randomUUID } from "node:crypto";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "./journals.js";

const GST = ["cgst", "sgst", "igst", "cess"];
const SOURCES = Object.freeze({
  vendor_bill: { label: "Supplier invoice", table: "accounting_vendor_bills", number: "bill_number", href: "/procurement/supplier-bills/{id}" },
  vendor_credit_note: { label: "Supplier credit note", table: "accounting_vendor_bills", number: "bill_number", href: "/procurement/supplier-bills/{id}" },
  expense: { label: "Expense", table: "accounting_expenses", number: "expense_number", href: "/accounting/expenses?id={id}" },
});
const today = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

// The documents with input GST, one row each: their GST by component, the supplier and its GSTIN, the period, and the ITC status.
export async function listInputTaxCredit(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const status = ["PENDING", "ELIGIBLE", "INELIGIBLE"].includes(String(filters.status ?? "").toUpperCase()) ? String(filters.status).toUpperCase() : null;
  const rows = (await client.query(
    `SELECT tax.source_type, tax.source_id, min(tax.tax_period) AS tax_period, max(tax.tax_registration) AS gstin, max(party.display_name) AS supplier,
            sum(tax.tax_amount) AS tax, sum(tax.tax_amount) FILTER (WHERE tax.tax_type = 'cgst') AS cgst, sum(tax.tax_amount) FILTER (WHERE tax.tax_type = 'sgst') AS sgst,
            sum(tax.tax_amount) FILTER (WHERE tax.tax_type = 'igst') AS igst, sum(tax.tax_amount) FILTER (WHERE tax.tax_type = 'cess') AS cess,
            array_agg(DISTINCT tax.itc_status) AS statuses, max(tax.itc_decided_at) AS decided_at, max(decider.full_name) AS decided_by, max(tax.itc_reason) AS reason,
            COALESCE(max(bill.bill_number), max(expense.expense_number)) AS number, COALESCE(max(bill.bill_date), max(expense.expense_date)) AS document_date
       FROM tenant.accounting_tax_ledger tax
       LEFT JOIN tenant.business_parties party ON party.id = tax.party_id
       LEFT JOIN public.users decider ON decider.id = tax.itc_decided_by
       LEFT JOIN tenant.accounting_vendor_bills bill ON bill.id = tax.source_id AND tax.source_type IN ('vendor_bill', 'vendor_credit_note')
       LEFT JOIN tenant.accounting_expenses expense ON expense.id = tax.source_id AND tax.source_type = 'expense'
      WHERE tax.organization_id = $1 AND tax.direction = 'input' AND tax.status <> 'reversed' AND tax.tax_type = ANY($2::text[]) AND tax.itc_status <> 'NOT_APPLICABLE'
      GROUP BY tax.source_type, tax.source_id
      ORDER BY min(tax.tax_period) DESC, COALESCE(max(bill.bill_date), max(expense.expense_date)) DESC NULLS LAST LIMIT 500`,
    [context.organizationId, GST])).rows;
  const view = rows.map((row) => {
    const statuses = row.statuses.filter(Boolean);
    const itcStatus = statuses.length === 1 ? statuses[0] : "PENDING";
    const source = SOURCES[row.source_type] ?? { label: row.source_type, href: null };
    return { sourceType: row.source_type, sourceId: row.source_id, document: source.label, number: row.number, href: source.href?.replace("{id}", row.source_id) ?? null,
      documentDate: row.document_date, supplier: row.supplier, gstin: row.gstin, taxPeriod: row.tax_period, itcStatus,
      tax: String(row.tax ?? 0), cgst: String(row.cgst ?? 0), sgst: String(row.sgst ?? 0), igst: String(row.igst ?? 0), cess: String(row.cess ?? 0),
      decidedAt: row.decided_at, decidedBy: row.decided_by, reason: row.reason };
  });
  const filtered = status ? view.filter((row) => row.itcStatus === status) : view;
  const total = (state) => view.filter((row) => row.itcStatus === state).reduce((sum, row) => sum + Number(row.tax), 0).toFixed(2);
  return { rows: filtered, totals: { pending: total("PENDING"), eligible: total("ELIGIBLE"), ineligible: total("INELIGIBLE") } };
}

async function journalFor(client, context, ledgerId) {
  const row = (await client.query(
    `SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type IN ('tax', 'general') AND status = 'active'
      ORDER BY (journal_type = 'tax') DESC, created_at LIMIT 1`, [context.organizationId, ledgerId])).rows[0];
  if (!row) throw new AccountingError(409, "A Tax or General journal is required to record input tax credit.", "ACCOUNTING_JOURNAL_MISSING");
  return row.id;
}

// decision: ELIGIBLE (claimable — e.g. matched in GSTR-2B) or INELIGIBLE (blocked credit, supplier did not file …), with the reason and an
// optional reference (the GSTR-2B period, a notice …).
export async function decideInputTaxCredit(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const sourceType = text(input.sourceType, 50);
  const source = SOURCES[sourceType];
  if (!source) throw new AccountingError(400, "Choose a supplier invoice, credit note or expense.", "ACCOUNTING_ITC_SOURCE_INVALID");
  const sourceId = uuid(input.sourceId, "Document");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["ELIGIBLE", "INELIGIBLE"].includes(decision)) throw new AccountingError(400, "Choose whether the credit is claimable or not.", "ACCOUNTING_ITC_DECISION_INVALID");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw new AccountingError(400, decision === "ELIGIBLE" ? "Say how the credit was confirmed (for example, the GSTR-2B period)." : "Say why the credit cannot be claimed.",
    "ACCOUNTING_ITC_REASON_REQUIRED");
  const rows = (await client.query(
    `SELECT * FROM tenant.accounting_tax_ledger WHERE organization_id = $1 AND source_type = $2 AND source_id = $3 AND direction = 'input' AND status <> 'reversed'
        AND tax_type = ANY($4::text[]) AND itc_status = 'PENDING' FOR UPDATE`, [context.organizationId, sourceType, sourceId, GST])).rows;
  if (!rows.length) throw new AccountingError(409, "No input tax credit on this document is waiting for a decision.", "ACCOUNTING_ITC_NOTHING_PENDING");
  const document = (await client.query(`SELECT ${source.number} AS number, ${sourceType === "expense" ? "expense_account_id" : "NULL::uuid"} AS cost_account_id
      FROM tenant.${source.table} WHERE organization_id = $1 AND id = $2`, [context.organizationId, sourceId])).rows[0];
  if (!document) throw new AccountingError(404, `${source.label} not found.`, "ACCOUNTING_ITC_SOURCE_NOT_FOUND");
  const ledger = await getPrimaryLedger(client, context);
  const date = text(input.date, 10) || today();
  const pending = await getAccountMapping(client, context, ledger.id, "input_tax_pending", { date });
  const ineligible = decision === "INELIGIBLE" ? (document.cost_account_id ? { account_id: document.cost_account_id } : await getAccountMapping(client, context, ledger.id, "itc_ineligible", { date })) : null;
  const totals = new Map();
  const book = (accountId, amount, label) => totals.set(accountId, { amount: (totals.get(accountId)?.amount ?? 0n) + amount, label });
  for (const row of rows) {
    const amount = decimal(row.tax_amount);
    const target = decision === "ELIGIBLE" ? await getAccountMapping(client, context, ledger.id, `input_${row.tax_type}`, { date }) : ineligible;
    book(target.account_id, amount, decision === "ELIGIBLE" ? `Input ${row.tax_type.toUpperCase()} claimable` : "Input GST not claimable");
    book(pending.account_id, -amount, "Input GST awaiting confirmation");
  }
  const lines = [...totals].filter(([, entry]) => entry.amount !== 0n).map(([accountId, entry]) => ({
    accountId, description: `${entry.label} · ${document.number}`, debit: entry.amount > 0n ? asDatabaseDecimal(entry.amount) : 0, credit: entry.amount < 0n ? asDatabaseDecimal(-entry.amount) : 0,
    referenceType: sourceType, referenceId: sourceId, metadata: { itcDecision: decision },
  }));
  if (lines.length < 2) throw new AccountingError(409, "The credit on this document nets to zero; nothing to move.", "ACCOUNTING_ITC_NOTHING_PENDING");
  const journal = await createJournalEntry(client, context, {
    ledgerId: ledger.id, journalId: await journalFor(client, context, ledger.id), entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger",
    reference: text(input.reference, 200) || document.number, description: `Input tax credit ${decision === "ELIGIBLE" ? "confirmed" : "not claimable"} · ${document.number}`, lines,
  }, { internal: true, sourceModule: "accounting", sourceType: "itc_decision", sourceId: randomUUID(), sourceNumber: document.number, postingEvent: "itc_decision",
    postingSourceType: sourceType, postingSourceId: sourceId });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  await client.query(
    `UPDATE tenant.accounting_tax_ledger SET itc_status = $4, itc_decided_at = now(), itc_decided_by = $5, itc_reason = $6, itc_journal_entry_id = $7,
            recoverable_amount = CASE WHEN $4 = 'ELIGIBLE' THEN tax_amount ELSE 0 END
      WHERE organization_id = $1 AND source_type = $2 AND source_id = $3 AND direction = 'input' AND status <> 'reversed' AND tax_type = ANY($8::text[]) AND itc_status = 'PENDING'`,
    [context.organizationId, sourceType, sourceId, decision, context.userId ?? null, `${reason}${input.reference ? ` (${text(input.reference, 200)})` : ""}`, journal.entry.id, GST]);
  return { sourceType, sourceId, itcStatus: decision, journalEntryId: journal.entry.id, journalNumber: journal.entry.entry_number };
}

// A decision made in error: its journal is reversed and the credit waits again.
export async function undoInputTaxCreditDecision(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const sourceType = text(input.sourceType, 50);
  if (!SOURCES[sourceType]) throw new AccountingError(400, "Choose a supplier invoice, credit note or expense.", "ACCOUNTING_ITC_SOURCE_INVALID");
  const sourceId = uuid(input.sourceId, "Document");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw new AccountingError(400, "Say why the decision is undone.", "ACCOUNTING_ITC_REASON_REQUIRED");
  const posting = (await client.query(`SELECT journal_entry_id FROM tenant.accounting_postings WHERE organization_id = $1 AND posting_event = 'itc_decision' AND source_id = $2 AND status = 'POSTED' FOR UPDATE`,
    [context.organizationId, sourceId])).rows[0];
  if (!posting) throw new AccountingError(409, "This document has no input tax credit decision to undo.", "ACCOUNTING_ITC_NOTHING_DECIDED");
  const reversing = { ...context, permissions: [...new Set([...(context.permissions ?? []), ACCOUNTING_PERMISSIONS.journalReverse])] };
  await reverseJournalEntry(client, reversing, posting.journal_entry_id, { reason: `Input tax credit decision undone: ${reason}` });
  await client.query(
    `UPDATE tenant.accounting_tax_ledger SET itc_status = 'PENDING', itc_decided_at = NULL, itc_decided_by = NULL, itc_reason = $4, itc_journal_entry_id = NULL, recoverable_amount = 0
      WHERE organization_id = $1 AND source_type = $2 AND source_id = $3 AND direction = 'input' AND status <> 'reversed' AND itc_journal_entry_id = $5`,
    [context.organizationId, sourceType, sourceId, `Decision undone: ${reason}`, posting.journal_entry_id]);
  return { sourceType, sourceId, itcStatus: "PENDING" };
}
