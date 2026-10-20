// Receivables commands (Finance MVP F4): recording a customer's payment and settling invoices with it.
//
//   record      a receipt is recorded and posted in one step (Dr bank or cash · Cr the customer), then optionally applied — to chosen
//               invoices or to the oldest open ones. Whatever is not applied stays on the customer as an advance (an unapplied credit),
//               never revenue.
//   apply       one receipt settles many invoices, and many receipts settle one invoice; an invoice is never settled beyond what it
//               still owes, and a receipt never applies more than it has left.
//   undo        an application made to the wrong invoice is undone: the invoice is owed again and the receipt's money is free again.
//               The application stays on record (allocations are append-only), marked undone, with who, when and why.
//   reverse     a receipt that did not happen (a bounced cheque, entered in error) is reversed: every application is undone, its journal is
//               reversed, and it is kept, marked reversed. A receipt whose money was already refunded can't be reversed.
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { ACCOUNTING_PERMISSIONS, AccountingError, asDatabaseDecimal, event, isoDate, requirePermission, requiredText, text, uuid } from "../core.js";
import { reverseJournalEntry } from "../journals.js";
import { allocateCustomerReceipt, createCustomerReceipt, postCustomerReceipt, restoreInvoiceSchedules } from "../receivables.js";

const OPEN = ["posted", "partially_paid", "overdue", "disputed"];
const fail = (status, message, code, details) => { throw new AccountingError(status, message, code, details); };

async function lockReceipt(client, context, idValue) {
  const receipt = (await client.query("SELECT * FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, uuid(idValue, "Receipt")])).rows[0];
  if (!receipt) fail(404, "Receipt not found.", "ACCOUNTING_RECEIPT_NOT_FOUND");
  return receipt;
}

// The open invoices of a customer in the receipt's currency, oldest due first: what a receipt can settle.
export async function openInvoicesFor(client, context, partyId, currencyCode) {
  return (await client.query(
    `SELECT id, invoice_number, invoice_date, due_date, grand_total, outstanding_amount, currency_code
       FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND party_id = $2 AND currency_code = $3 AND invoice_type <> 'credit_note' AND status = ANY($4::text[]) AND outstanding_amount > 0
      ORDER BY due_date NULLS LAST, invoice_date, invoice_number`, [context.organizationId, partyId, currencyCode, OPEN])).rows;
}

// Settles invoices with a receipt. allocations: [{ invoiceId, amount, discountTaken?, writeoffAmount? }] — amounts in the shared currency.
export async function applyReceipt(client, context, receiptIdValue, { allocations } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const receipt = await lockReceipt(client, context, receiptIdValue);
  if (!["posted", "partially_applied"].includes(receipt.status)) fail(409, "Only a posted receipt with money left can be applied.", "ACCOUNTING_RECEIPT_NOT_APPLICABLE");
  // Each application moves money; an early-payment discount or a small write-off settles the rest of that invoice with it.
  const rows = (allocations ?? []).filter((entry) => decimal(entry.amount ?? 0) > 0n);
  if (!rows.length) fail(400, "Enter the amount to apply to at least one invoice.", "ACCOUNTING_RECEIPT_ALLOCATION_INVALID");
  if (rows.some((entry) => decimal(entry.discountTaken ?? 0) < 0n || decimal(entry.writeoffAmount ?? 0) < 0n))
    fail(400, "A discount or write-off can't be negative.", "ACCOUNTING_RECEIPT_ALLOCATION_INVALID");
  const total = rows.reduce((sum, entry) => add(sum, decimal(entry.amount ?? 0)), 0n);
  if (total > decimal(receipt.unapplied_amount))
    fail(409, `The receipt has ${formatDecimal(receipt.unapplied_amount, 2)} left to apply; ${formatDecimal(total, 2)} was entered.`, "ACCOUNTING_RECEIPT_OVER_APPLIED");
  const currency = String(receipt.currency_code).trim();
  for (const entry of rows) {
    const invoice = (await client.query("SELECT invoice_number, currency_code, outstanding_amount FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2",
      [context.organizationId, uuid(entry.invoiceId, "Invoice")])).rows[0];
    if (!invoice) fail(404, "Invoice not found.", "ACCOUNTING_INVOICE_NOT_FOUND");
    if (String(invoice.currency_code).trim() !== currency) fail(409, `${invoice.invoice_number} is in ${String(invoice.currency_code).trim()}; this receipt is in ${currency}.`, "ACCOUNTING_RECEIPT_CURRENCY");
    const settles = add(add(decimal(entry.amount ?? 0), decimal(entry.discountTaken ?? 0)), decimal(entry.writeoffAmount ?? 0));
    if (settles > decimal(invoice.outstanding_amount))
      fail(409, `${invoice.invoice_number} still owes ${formatDecimal(invoice.outstanding_amount, 2)}; it can't be settled by ${formatDecimal(settles, 2)}.`, "ACCOUNTING_INVOICE_OVER_SETTLED");
  }
  await allocateCustomerReceipt(client, context, receipt.id, {
    allocations: rows.map((entry) => ({
      invoiceId: entry.invoiceId, receiptAmount: formatDecimal(decimal(entry.amount ?? 0)), invoiceAmount: formatDecimal(decimal(entry.amount ?? 0)),
      discountTaken: entry.discountTaken || "0", writeoffAmount: entry.writeoffAmount || "0",
    })),
  });
  return { id: receipt.id };
}

// Applies what is left of a receipt to the customer's oldest open invoices.
export async function applyReceiptToOldest(client, context, receiptIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const receipt = await lockReceipt(client, context, receiptIdValue);
  let left = decimal(receipt.unapplied_amount);
  const allocations = [];
  for (const invoice of await openInvoicesFor(client, context, receipt.party_id, String(receipt.currency_code).trim())) {
    if (left <= 0n) break;
    const owed = decimal(invoice.outstanding_amount);
    const amount = owed < left ? owed : left;
    allocations.push({ invoiceId: invoice.id, amount: formatDecimal(amount) });
    left = sub(left, amount);
  }
  if (!allocations.length) fail(409, "This customer has no open invoice in the receipt's currency.", "ACCOUNTING_RECEIPT_NOTHING_OPEN");
  return applyReceipt(client, context, receipt.id, { allocations });
}

// input: { partyId, receiptDate, amount, currencyCode?, exchangeRate?, bankAccountId?, paymentMethod, reference?, notes?, allocations?, applyToOldest? }
export async function recordCustomerReceipt(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const created = await createCustomerReceipt(client, context, {
    partyId: input.partyId, receiptDate: input.receiptDate, accountingDate: input.receiptDate, amount: input.amount, currencyCode: input.currencyCode || undefined,
    exchangeRate: input.exchangeRate || undefined, bankAccountId: input.bankAccountId || undefined, paymentMethod: input.paymentMethod, externalReference: input.reference,
  });
  if (input.notes) await client.query("UPDATE tenant.accounting_customer_receipts SET notes = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, created.id, text(input.notes, 2000)]);
  await postCustomerReceipt(client, context, created.id);
  if (Array.isArray(input.allocations) && input.allocations.some((entry) => decimal(entry.amount ?? 0) > 0n)) await applyReceipt(client, context, created.id, { allocations: input.allocations });
  else if (input.applyToOldest === true && (await openInvoicesFor(client, context, created.party_id, String(created.currency_code).trim())).length) await applyReceiptToOldest(client, context, created.id);
  return { id: created.id, number: created.receipt_number };
}

async function undoAllocation(client, context, allocation, receipt, reason) {
  const invoice = (await client.query("SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, allocation.customer_invoice_id])).rows[0];
  const outstanding = add(decimal(invoice.outstanding_amount), decimal(allocation.allocated_amount));
  await restoreInvoiceSchedules(client, context, invoice.id, allocation.allocated_amount);
  const status = outstanding >= decimal(invoice.grand_total) ? "posted" : "partially_paid";
  await client.query("UPDATE tenant.accounting_customer_invoices SET outstanding_amount = $3, status = $4, updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, invoice.id, asDatabaseDecimal(outstanding), status, context.userId ?? null]);
  if (allocation.adjustment_journal_entry_id) {
    const reversing = { ...context, permissions: [...new Set([...(context.permissions ?? []), ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.view])] };
    await reverseJournalEntry(client, reversing, allocation.adjustment_journal_entry_id, { reason: `${receipt.receipt_number} / ${invoice.invoice_number} undone: ${reason}` });
  }
  await client.query(
    `INSERT INTO tenant.accounting_customer_receipt_allocation_reversals (organization_id, allocation_id, receipt_id, customer_invoice_id, amount, receipt_amount, reason, reversed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [context.organizationId, allocation.id, receipt.id, invoice.id, allocation.allocated_amount, allocation.receipt_amount, reason, context.userId ?? null]);
  await event(client, context, "customer_invoice", invoice.id, "accounting.customer_invoice.settlement_undone", invoice.status, status,
    { receiptId: receipt.id, amount: asDatabaseDecimal(decimal(allocation.allocated_amount)), reason });
  return decimal(allocation.receipt_amount);
}

async function liveAllocations(client, context, receiptId, allocationId = null) {
  return (await client.query(
    `SELECT allocation.* FROM tenant.accounting_customer_receipt_allocations allocation
      WHERE allocation.organization_id = $1 AND allocation.receipt_id = $2 AND ($3::uuid IS NULL OR allocation.id = $3)
        AND NOT EXISTS (SELECT 1 FROM tenant.accounting_customer_receipt_allocation_reversals undone WHERE undone.organization_id = $1 AND undone.allocation_id = allocation.id)`,
    [context.organizationId, receiptId, allocationId])).rows;
}

// Undoes one application of a receipt to an invoice.
export async function undoReceiptAllocation(client, context, allocationIdValue, { reason } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const why = requiredText(reason, "Reason", 500);
  const allocation = (await client.query("SELECT * FROM tenant.accounting_customer_receipt_allocations WHERE organization_id = $1 AND id = $2",
    [context.organizationId, uuid(allocationIdValue, "Application")])).rows[0];
  if (!allocation) fail(404, "That application was not found.", "ACCOUNTING_ALLOCATION_NOT_FOUND");
  const receipt = await lockReceipt(client, context, allocation.receipt_id);
  const [live] = await liveAllocations(client, context, receipt.id, allocation.id);
  if (!live) fail(409, "That application was already undone.", "ACCOUNTING_ALLOCATION_UNDONE");
  const freed = await undoAllocation(client, context, live, receipt, why);
  const unapplied = add(decimal(receipt.unapplied_amount), freed);
  const status = unapplied >= decimal(receipt.amount) ? "posted" : "partially_applied";
  await client.query("UPDATE tenant.accounting_customer_receipts SET unapplied_amount = $3, status = $4, updated_by = $5 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, receipt.id, asDatabaseDecimal(unapplied), status, context.userId ?? null]);
  await event(client, context, "customer_receipt", receipt.id, "accounting.customer_receipt.application_undone", receipt.status, status, { allocationId: live.id, reason: why });
  return { id: receipt.id };
}

// Reverses a receipt that did not happen. input: { reason, accountingDate? }
export async function reverseCustomerReceipt(client, context, receiptIdValue, { reason, accountingDate } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const why = requiredText(reason, "Reason", 500);
  const receipt = await lockReceipt(client, context, receiptIdValue);
  if (receipt.status === "reversed") fail(409, "This receipt is already reversed.", "ACCOUNTING_RECEIPT_REVERSED");
  if (!["posted", "partially_applied", "applied"].includes(receipt.status)) fail(409, "Only a posted receipt can be reversed.", "ACCOUNTING_RECEIPT_NOT_POSTED");
  const refunded = (await client.query(
    `SELECT refund.refund_number FROM tenant.accounting_customer_refund_allocations allocation
       JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id AND refund.status NOT IN ('cancelled', 'reversed')
      WHERE allocation.organization_id = $1 AND allocation.receipt_id = $2 LIMIT 1`, [context.organizationId, receipt.id])).rows[0];
  if (refunded) fail(409, `Part of this receipt was refunded (${refunded.refund_number}). Reverse or cancel the refund first.`, "ACCOUNTING_RECEIPT_REFUNDED");
  for (const allocation of await liveAllocations(client, context, receipt.id)) await undoAllocation(client, context, allocation, receipt, `Receipt reversed: ${why}`);
  const reversing = { ...context, permissions: [...new Set([...(context.permissions ?? []), ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.view])] };
  const reversal = await reverseJournalEntry(client, reversing, receipt.journal_entry_id, { reason: `${receipt.receipt_number}: ${why}`, accountingDate: accountingDate ? isoDate(accountingDate, "Reversal date") : undefined });
  await client.query(
    `UPDATE tenant.accounting_customer_receipts SET status = 'reversed', unapplied_amount = 0, reversed_at = now(), reversed_by = $3, reversal_reason = $4, reversal_journal_entry_id = $5,
            updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, receipt.id, context.userId ?? null, why, reversal.entry?.id ?? null]);
  await event(client, context, "customer_receipt", receipt.id, "accounting.customer_receipt.reversed", receipt.status, "reversed", { reason: why });
  return { id: receipt.id };
}

