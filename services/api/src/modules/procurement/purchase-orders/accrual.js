// Goods received, not yet invoiced. When the company keeps perpetual
// inventory (Procurement settings: post receipt accrual), posting a goods
// receipt books the stock it brought in — at the order's agreed price — as
// Dr Inventory, Cr GRNI, through Accounting's own journals; a reversed
// receipt reverses that journal. The supplier bill for those goods then
// debits GRNI instead of an expense, so the goods are recognised once. This
// is never Accounts Payable: only a posted supplier bill creates that.
import { add, decimal, div, formatDecimal, mul, roundMoney } from "../../../core/decimal.js";
import { createJournalEntry, getAccountMapping, getExchangeRate, getPrimaryLedger, loadOrganization, postJournalEntry, reverseJournalEntry } from "../../accounting/index.js";
import { AccountingError } from "../../accounting/core.js";
import { PurchaseOrderError, dayOf } from "./constants.js";

// Accounting runs these on the receipt's behalf; the receipt's own permissions were checked by the caller.
const accountingContext = (context) => ({ ...context, permissions: [...(context.permissions ?? []), "accounting.view", "accounting.journal.create", "accounting.journal.reverse"] });

async function accounted(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AccountingError) throw new PurchaseOrderError(error.status ?? 409, `Receipt accrual: ${error.message}`, "GOODS_RECEIPT_ACCRUAL_FAILED");
    throw error;
  }
}

export async function accrualEnabled(client, organizationId) {
  const row = (await client.query(`SELECT post_receipt_accrual FROM tenant.procurement_settings WHERE organization_id = $1`, [organizationId])).rows[0];
  return Boolean(row?.post_receipt_accrual);
}

async function journalOf(client, organizationId, ledgerId) {
  const row = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'purchase' AND status = 'active' ORDER BY created_at LIMIT 1`,
    [organizationId, ledgerId])).rows[0];
  if (!row) throw new PurchaseOrderError(409, "Receipt accrual: a Purchase accounting journal is not configured.", "GOODS_RECEIPT_ACCRUAL_FAILED");
  return row.id;
}

// The accrual a receipt would post: one debit per stocked line at the order's taxable value for what was taken in, one credit to GRNI.
export async function postReceiptAccrual(client, context, receipt, order, lines, orderLines) {
  if (!(await accrualEnabled(client, context.organizationId))) return null;
  const stocked = lines.filter((line) => line.product_type === "stock" && decimal(line.accepted_quantity) + decimal(line.held_quantity) > 0n);
  if (!stocked.length) return null;
  const ctx = accountingContext(context);
  return accounted(async () => {
    const ledger = await getPrimaryLedger(client, ctx);
    const organization = await loadOrganization(client, ctx);
    const date = dayOf(receipt.receipt_date);
    const grni = await getAccountMapping(client, ctx, ledger.id, "grni", { partyId: order.party_id, date });
    const journalLines = [];
    let total = 0n;
    for (const line of stocked) {
      const orderLine = orderLines.get(line.purchase_order_line_id);
      const amount = roundMoney(div(mul(orderLine.taxable_amount, add(line.accepted_quantity, line.held_quantity)), orderLine.ordered_quantity), 2);
      if (amount <= 0n) continue;
      const inventory = await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId: line.product_id, date });
      total += amount;
      journalLines.push({ accountId: inventory.account_id, description: `${receipt.receipt_number} · ${line.description}`, debit: formatDecimal(amount), credit: 0,
        referenceType: "goods_receipt_line", referenceId: line.id });
    }
    if (total <= 0n) return null;
    journalLines.push({ accountId: grni.account_id, partyId: order.party_id, description: `Goods received not invoiced · ${receipt.receipt_number}`, debit: 0, credit: formatDecimal(total),
      referenceType: "goods_receipt", referenceId: receipt.id });
    const currency = order.currency_code.trim();
    const rate = await getExchangeRate(client, ctx, currency, organization.base_currency, date);
    const journal = await createJournalEntry(client, ctx, {
      ledgerId: ledger.id, journalId: await journalOf(client, context.organizationId, ledger.id), entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger",
      reference: receipt.receipt_number, description: `Goods receipt ${receipt.receipt_number} (${order.purchase_order_number})`, currencyCode: currency, exchangeRate: formatDecimal(rate),
      lines: journalLines,
    }, { internal: true, sourceModule: "procurement", sourceType: "goods_receipt", sourceId: receipt.id, sourceNumber: receipt.receipt_number });
    await postJournalEntry(client, ctx, journal.entry.id, { internal: true, allowDraft: true });
    await client.query(`UPDATE tenant.goods_receipts SET accrual_journal_entry_id = $3, accrual_amount = $4 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, receipt.id, journal.entry.id, formatDecimal(total)]);
    return { journalEntryId: journal.entry.id, amount: formatDecimal(total) };
  });
}

export async function reverseReceiptAccrual(client, context, receipt, reason) {
  if (!receipt.accrual_journal_entry_id || receipt.accrual_reversal_journal_entry_id) return null;
  const ctx = accountingContext(context);
  return accounted(async () => {
    const reversal = await reverseJournalEntry(client, ctx, receipt.accrual_journal_entry_id, { reason: `Goods receipt ${receipt.receipt_number} reversed: ${reason}` });
    const id = reversal.entry?.id ?? reversal.id;
    await client.query(`UPDATE tenant.goods_receipts SET accrual_reversal_journal_entry_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, receipt.id, id]);
    return id;
  });
}

// The account a bill line books to when it bills goods whose receipt accrued them: GRNI, so the cost is not recognised twice.
export async function grniAccountFor(client, context, order, receiptLineIds) {
  if (!receiptLineIds.length) return null;
  const accrued = (await client.query(
    `SELECT 1 FROM tenant.goods_receipt_lines line JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
      WHERE line.organization_id = $1 AND line.id = ANY($2::uuid[]) AND receipt.accrual_journal_entry_id IS NOT NULL AND receipt.accrual_reversal_journal_entry_id IS NULL LIMIT 1`,
    [context.organizationId, receiptLineIds])).rows[0];
  if (!accrued) return null;
  const ctx = accountingContext(context);
  return accounted(async () => {
    const ledger = await getPrimaryLedger(client, ctx);
    return (await getAccountMapping(client, ctx, ledger.id, "grni", { partyId: order.party_id })).account_id;
  });
}


// A purchase return of goods whose receipt accrued them takes them back out of stock at the value they were accrued at: Dr GRNI, Cr
// Inventory. Unbilled, that undoes the receipt's accrual for those goods; billed, the debit note that corrects the bill credits GRNI (the
// account the bill debited), so GRNI is cleared exactly once either way. lines: [{ receiptLine, orderLine, quantity }].
export async function postReturnAccrual(client, context, purchaseReturn, order, lines) {
  const accrued = [];
  for (const entry of lines) {
    if (entry.receiptLine.product_type !== "stock") continue;
    const receipt = (await client.query(`SELECT accrual_journal_entry_id, accrual_reversal_journal_entry_id FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, entry.receiptLine.goods_receipt_id])).rows[0];
    if (receipt?.accrual_journal_entry_id && !receipt.accrual_reversal_journal_entry_id) accrued.push(entry);
  }
  if (!accrued.length) return null;
  const ctx = accountingContext(context);
  return accounted(async () => {
    const ledger = await getPrimaryLedger(client, ctx);
    const organization = await loadOrganization(client, ctx);
    const date = dayOf(purchaseReturn.dispatch_date ?? purchaseReturn.return_date);
    const grni = await getAccountMapping(client, ctx, ledger.id, "grni", { partyId: order.party_id, date });
    const journalLines = [];
    let total = 0n;
    for (const { receiptLine, orderLine, quantity } of accrued) {
      const amount = roundMoney(div(mul(orderLine.taxable_amount, quantity), orderLine.ordered_quantity), 2);
      if (amount <= 0n) continue;
      const inventory = await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId: receiptLine.product_id, date });
      total += amount;
      journalLines.push({ accountId: inventory.account_id, description: `${purchaseReturn.return_number} · ${receiptLine.description}`, debit: 0, credit: formatDecimal(amount),
        referenceType: "purchase_return", referenceId: purchaseReturn.id });
    }
    if (total <= 0n) return null;
    journalLines.unshift({ accountId: grni.account_id, partyId: order.party_id, description: `Goods returned to the supplier · ${purchaseReturn.return_number}`, debit: formatDecimal(total), credit: 0,
      referenceType: "purchase_return", referenceId: purchaseReturn.id });
    const currency = order.currency_code.trim();
    const rate = await getExchangeRate(client, ctx, currency, organization.base_currency, date);
    const journal = await createJournalEntry(client, ctx, {
      ledgerId: ledger.id, journalId: await journalOf(client, context.organizationId, ledger.id), entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger",
      reference: purchaseReturn.return_number, description: `Purchase return ${purchaseReturn.return_number} (${order.purchase_order_number})`, currencyCode: currency,
      exchangeRate: formatDecimal(rate), lines: journalLines,
    }, { internal: true, sourceModule: "procurement", sourceType: "purchase_return", sourceId: purchaseReturn.id, sourceNumber: purchaseReturn.return_number });
    await postJournalEntry(client, ctx, journal.entry.id, { internal: true, allowDraft: true });
    return { journalEntryId: journal.entry.id, amount: formatDecimal(total) };
  });
}

export async function reverseReturnAccrual(client, context, purchaseReturn, reason) {
  if (!purchaseReturn.accrual_journal_entry_id) return null;
  const ctx = accountingContext(context);
  return accounted(async () => {
    const reversal = await reverseJournalEntry(client, ctx, purchaseReturn.accrual_journal_entry_id, { reason: `Purchase return ${purchaseReturn.return_number} reversed: ${reason}` });
    return reversal.entry?.id ?? reversal.id;
  });
}
