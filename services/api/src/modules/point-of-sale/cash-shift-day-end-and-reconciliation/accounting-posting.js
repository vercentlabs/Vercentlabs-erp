// F305 — POS accounting posting. Posts a completed sale's (and a
// completed return's) financial facts into Accounting's own authoritative
// general ledger through its public contract
// (createJournalEntry/postJournalEntry, services/api/src/modules/
// accounting/index.js) -- never a POS-owned ledger, never a direct write
// to tenant.accounting_journal_entries/lines.
//
// ACCOUNT MAPPING REUSE: revenue/output_tax/rounding/cogs all reuse the
// SAME mapping_key vocabulary Sales' own receivables.js already posts
// through (tenant.accounting_account_mappings, resolved via
// getAccountMapping) -- these come pre-seeded for every company
// (foundation.js's MAPPING_SEED) and need zero POS-specific configuration.
// Tender clearing accounts (pos_card_clearing/pos_upi_clearing/
// pos_wallet_clearing/pos_store_credit_liability), inventory relief, and
// the two loyalty accrual accounts are genuinely POS-specific concepts
// with no Sales analog -- cash/bank_transfer reuse the already-seeded
// 'cash'/'bank' keys, everything else needs one-time admin configuration
// via Accounting's existing generic account-mapping API before F305
// posting will succeed for that mapping_key (there is no POS-specific
// mapping UI; this reuses Accounting's own configuration surface, per the
// task's own instruction not to add functionality outside canonical
// scope).
//
// NOT BUILT (disclosed, not silently skipped): a return's journal reverses
// revenue/tax/tender/COGS for the returned portion, but does NOT reverse
// any loyalty accrual the original sale posted -- a genuine, disclosed
// simplification, not an oversight.
import {
  createJournalEntry,
  postJournalEntry,
  getAccountMapping,
  loadCompany,
  getPrimaryLedger,
} from "../../accounting/index.js";
import { add, sub, mul, div, decimal, asDatabaseDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event as auditEvent } from "../shared/audit.js";
import { posAccountingContext } from "../shared/accounting-bridge.js";

const TENDER_MAPPING_KEY = Object.freeze({
  cash: "cash",
  bank_transfer: "bank",
  card: "pos_card_clearing",
  upi: "pos_upi_clearing",
  wallet: "pos_wallet_clearing",
  store_credit: "pos_store_credit_liability",
});

function event(client, context, aggregateId, eventType, payload = {}) {
  return auditEvent(client, context, "pos_accounting_posting", aggregateId, eventType, payload);
}

// Reuses the SAME "sales" journal type Accounting's own postCustomerInvoice
// posts through (foundation.js's own JOURNAL_SEED provisions a 'SAL' sales
// journal for every company — zero POS-specific configuration needed). A
// POS return posts through the same journal as the sale it reverses; a
// credit note within the sales journal is standard practice, not a new
// journal type.
async function salesJournalId(client, context, companyId, ledgerId) {
  const result = await client.query(
    `SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='sales' AND status='active' ORDER BY created_at LIMIT 1`,
    [context.organizationId, companyId, ledgerId],
  );
  if (!result.rows[0]) throw posError(409, "A Sales accounting journal is not configured for this company.", "POS_ACCOUNTING_JOURNAL_NOT_CONFIGURED");
  return result.rows[0].id;
}

async function tenderMappingAccount(client, accountingContext, company, ledger, method, date) {
  const mappingKey = TENDER_MAPPING_KEY[method];
  if (!mappingKey) throw posError(409, `No accounting mapping is defined for payment method ${method}.`, "POS_ACCOUNTING_TENDER_MAPPING_UNKNOWN");
  return getAccountMapping(client, accountingContext, company.id, ledger.id, mappingKey, { date });
}

async function buildSaleJournalLines(client, context, accountingContext, company, ledger, sale) {
  const date = new Date(sale.completed_at || sale.sale_date).toISOString().slice(0, 10);
  const lineRows = await client.query(
    `SELECT * FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2 ORDER BY line_number`,
    [context.organizationId, sale.id],
  );
  if (!lineRows.rows.length) throw posError(409, "This sale has no lines to post.", "POS_ACCOUNTING_NO_LINES");

  const paymentRows = await client.query(
    `SELECT payment_method,sum(amount)::text AS amount
       FROM tenant.pos_payments
      WHERE organization_id=$1 AND sale_id=$2 AND status IN ('captured','refunded','partially_refunded')
      GROUP BY payment_method`,
    [context.organizationId, sale.id],
  );
  if (!paymentRows.rows.length) throw posError(409, "This sale has no captured payment to post.", "POS_ACCOUNTING_NO_PAYMENTS");

  const cogsRow = await client.query(
    `SELECT coalesce(sum(abs(movement.quantity)*movement.unit_cost),0)::numeric(20,6)::text AS cogs_total
       FROM tenant.pos_sale_lines line
       JOIN tenant.stock_movements movement
         ON movement.organization_id=line.organization_id AND movement.id=line.stock_movement_id
      WHERE line.organization_id=$1 AND line.sale_id=$2`,
    [context.organizationId, sale.id],
  );
  const cogsTotal = decimal(cogsRow.rows[0].cogs_total);

  const lines = [];

  // Tender debit lines. Each pos_payments row's captured amount is the
  // FULL amount received AT THE TIME of this sale -- a later refund posts
  // its own separate reversing entry on the return (see
  // buildReturnJournalLines below), never a retroactive edit here.
  let tenderTotal = decimal(0);
  for (const row of paymentRows.rows) {
    const amount = decimal(row.amount);
    if (amount === 0n) continue;
    const account = await tenderMappingAccount(client, accountingContext, company, ledger, row.payment_method, date);
    lines.push({
      accountId: account.account_id,
      description: `POS ${row.payment_method} tender — ${sale.receipt_number}`,
      debit: asDatabaseDecimal(amount),
      credit: 0,
      referenceType: "pos_sale",
      referenceId: sale.id,
    });
    tenderTotal = add(tenderTotal, amount);
  }

  // Revenue credit, one line per sale line (net of every discount, pre-tax
  // — same "revenue" mapping key Sales' own invoices post through).
  for (const line of lineRows.rows) {
    const net = sub(mul(decimal(line.quantity), decimal(line.unit_price)), decimal(line.discount_amount));
    if (net === 0n) continue;
    const revenue = await getAccountMapping(client, accountingContext, company.id, ledger.id, "revenue", { itemId: line.item_id, date });
    lines.push({
      accountId: revenue.account_id,
      description: line.description,
      debit: 0,
      credit: asDatabaseDecimal(net),
      referenceType: "pos_sale",
      referenceId: sale.id,
    });
  }

  const taxTotal = decimal(sale.tax_total);
  if (taxTotal > 0n) {
    const tax = await getAccountMapping(client, accountingContext, company.id, ledger.id, "output_tax", { date });
    lines.push({
      accountId: tax.account_id,
      description: `Output tax — ${sale.receipt_number}`,
      debit: 0,
      credit: asDatabaseDecimal(taxTotal),
      referenceType: "pos_sale",
      referenceId: sale.id,
      taxBaseAmount: sale.subtotal,
    });
  }

  const rounding = decimal(sale.rounding_adjustment);
  if (rounding !== 0n) {
    const roundingAccount = await getAccountMapping(client, accountingContext, company.id, ledger.id, "rounding", { date });
    lines.push({
      accountId: roundingAccount.account_id,
      description: `Rounding — ${sale.receipt_number}`,
      debit: rounding < 0n ? asDatabaseDecimal(-rounding) : 0,
      credit: rounding > 0n ? asDatabaseDecimal(rounding) : 0,
      referenceType: "pos_sale",
      referenceId: sale.id,
    });
  }

  if (cogsTotal > 0n) {
    const cogs = await getAccountMapping(client, accountingContext, company.id, ledger.id, "cogs", { date });
    const inventory = await getAccountMapping(client, accountingContext, company.id, ledger.id, "inventory", { date });
    lines.push({
      accountId: cogs.account_id,
      description: `Cost of goods sold — ${sale.receipt_number}`,
      debit: asDatabaseDecimal(cogsTotal),
      credit: 0,
      referenceType: "pos_sale",
      referenceId: sale.id,
    });
    lines.push({
      accountId: inventory.account_id,
      description: `Inventory relief — ${sale.receipt_number}`,
      debit: 0,
      credit: asDatabaseDecimal(cogsTotal),
      referenceType: "pos_sale",
      referenceId: sale.id,
    });
  }

  // F306 loyalty deferred-revenue accrual, when this sale's own points
  // program was active. Valued at the program's CURRENT redemption value
  // per point (a disclosed simplification -- not a sale-time snapshot).
  const pointsEarned = decimal(sale.loyalty_points_earned || 0);
  const redeemAmount = decimal(sale.loyalty_redeem_amount || 0);
  if (pointsEarned > 0n || redeemAmount > 0n) {
    const program = await client.query(
      `SELECT redemption_value_per_point FROM tenant.pos_loyalty_programs WHERE organization_id=$1 AND company_id=$2`,
      [context.organizationId, sale.company_id],
    );
    const redemptionValue = decimal(program.rows[0]?.redemption_value_per_point || 0);
    if (pointsEarned > 0n && redemptionValue > 0n) {
      const accrualAmount = mul(pointsEarned, redemptionValue);
      if (accrualAmount > 0n) {
        const expense = await getAccountMapping(client, accountingContext, company.id, ledger.id, "pos_loyalty_program_expense", { date });
        const liability = await getAccountMapping(client, accountingContext, company.id, ledger.id, "pos_loyalty_liability", { date });
        lines.push({ accountId: expense.account_id, description: `Loyalty points accrual — ${sale.receipt_number}`, debit: asDatabaseDecimal(accrualAmount), credit: 0, referenceType: "pos_sale", referenceId: sale.id });
        lines.push({ accountId: liability.account_id, description: `Loyalty points accrual — ${sale.receipt_number}`, debit: 0, credit: asDatabaseDecimal(accrualAmount), referenceType: "pos_sale", referenceId: sale.id });
      }
    }
    if (redeemAmount > 0n) {
      const liability = await getAccountMapping(client, accountingContext, company.id, ledger.id, "pos_loyalty_liability", { date });
      const revenue = await getAccountMapping(client, accountingContext, company.id, ledger.id, "revenue", { date });
      lines.push({ accountId: liability.account_id, description: `Loyalty points redeemed — ${sale.receipt_number}`, debit: asDatabaseDecimal(redeemAmount), credit: 0, referenceType: "pos_sale", referenceId: sale.id });
      lines.push({ accountId: revenue.account_id, description: `Loyalty points redeemed — ${sale.receipt_number}`, debit: 0, credit: asDatabaseDecimal(redeemAmount), referenceType: "pos_sale", referenceId: sale.id });
    }
  }

  return { lines, tenderTotal, date };
}

async function buildReturnJournalLines(client, context, accountingContext, company, ledger, posReturn) {
  const date = new Date(posReturn.completed_at || posReturn.created_at).toISOString().slice(0, 10);
  const lineRows = await client.query(
    `SELECT return_line.*,sale_line.item_id,sale_line.description,sale_line.tax_amount AS original_tax_amount,
            sale_line.quantity AS original_quantity
       FROM tenant.pos_return_lines return_line
       JOIN tenant.pos_sale_lines sale_line
         ON sale_line.organization_id=return_line.organization_id AND sale_line.id=return_line.sale_line_id
      WHERE return_line.organization_id=$1 AND return_line.return_id=$2`,
    [context.organizationId, posReturn.id],
  );
  if (!lineRows.rows.length) throw posError(409, "This return has no lines to post.", "POS_ACCOUNTING_NO_LINES");

  const lines = [];
  let taxTotal = decimal(0);
  let netTotal = decimal(0);
  for (const line of lineRows.rows) {
    const refund = decimal(line.refund_amount);
    if (refund === 0n) continue;
    // Proportional to the ORIGINAL sale line's own tax, same
    // originalLineValue*(returnedQty/originalSoldQty) shape F306 already
    // established for loyalty reversal — net is derived as refund minus
    // tax rather than computed independently, so the two always
    // reconstruct exactly to the real refunded amount.
    const originalQuantity = decimal(line.original_quantity);
    const returnedTax = originalQuantity > 0n
      ? mul(decimal(line.original_tax_amount), div(decimal(line.quantity), originalQuantity))
      : decimal(0);
    const returnedNet = sub(refund, returnedTax);
    taxTotal = add(taxTotal, returnedTax);
    netTotal = add(netTotal, returnedNet);
    if (returnedNet !== 0n) {
      const revenue = await getAccountMapping(client, accountingContext, company.id, ledger.id, "revenue", { itemId: line.item_id, date });
      lines.push({ accountId: revenue.account_id, description: `Return — ${line.description}`, debit: asDatabaseDecimal(returnedNet), credit: 0, referenceType: "pos_return", referenceId: posReturn.id });
    }
    if (line.restock && line.stock_movement_id) {
      const movement = await client.query(
        `SELECT (abs(quantity)*unit_cost)::numeric(20,6) AS cost FROM tenant.stock_movements WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, line.stock_movement_id],
      );
      const cost = decimal(movement.rows[0]?.cost || 0);
      if (cost > 0n) {
        const cogs = await getAccountMapping(client, accountingContext, company.id, ledger.id, "cogs", { date });
        const inventory = await getAccountMapping(client, accountingContext, company.id, ledger.id, "inventory", { date });
        lines.push({ accountId: inventory.account_id, description: `Inventory restocked — ${line.description}`, debit: asDatabaseDecimal(cost), credit: 0, referenceType: "pos_return", referenceId: posReturn.id });
        lines.push({ accountId: cogs.account_id, description: `Cost of goods sold reversal — ${line.description}`, debit: 0, credit: asDatabaseDecimal(cost), referenceType: "pos_return", referenceId: posReturn.id });
      }
    }
  }

  if (taxTotal > 0n) {
    const tax = await getAccountMapping(client, accountingContext, company.id, ledger.id, "output_tax", { date });
    lines.push({ accountId: tax.account_id, description: `Output tax reversal — ${posReturn.return_number}`, debit: asDatabaseDecimal(taxTotal), credit: 0, referenceType: "pos_return", referenceId: posReturn.id });
  }

  // Returns/refunds are cash-only today (F292's own current, disclosed
  // scope — see the POS gap matrix); the tender-side reversal always
  // credits 'cash' until a non-cash refund path exists.
  const refundTotal = decimal(posReturn.refund_total);
  if (refundTotal > 0n) {
    const cash = await getAccountMapping(client, accountingContext, company.id, ledger.id, "cash", { date });
    lines.push({ accountId: cash.account_id, description: `POS cash refund — ${posReturn.return_number}`, debit: 0, credit: asDatabaseDecimal(refundTotal), referenceType: "pos_return", referenceId: posReturn.id });
  }

  return { lines, date };
}

async function lockPosSale(client, context, saleId) {
  const result = await client.query(
    `SELECT * FROM tenant.pos_sales WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, saleId],
  );
  if (!result.rows[0]) throw posError(404, "POS sale was not found.", "POS_SALE_NOT_FOUND");
  return result.rows[0];
}

async function lockPosReturn(client, context, returnId) {
  const result = await client.query(
    `SELECT * FROM tenant.pos_returns WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, returnId],
  );
  if (!result.rows[0]) throw posError(404, "POS return was not found.", "POS_RETURN_NOT_FOUND");
  return result.rows[0];
}

export async function postPosSaleToAccounting(client, context, saleId) {
  requirePermission(context, "pos.accounting.post");
  const sale = await lockPosSale(client, context, saleId);
  await assertPosStoreAccess(client, context, sale.store_id);
  if (sale.journal_entry_id) {
    return { posted: true, replayed: true, journalEntryId: sale.journal_entry_id };
  }
  if (!["completed", "partially_returned", "returned"].includes(sale.status)) {
    throw posError(409, "Only a completed POS sale can be posted to accounting.", "POS_ACCOUNTING_SALE_NOT_COMPLETED");
  }

  const accountingContext = posAccountingContext(context);
  await client.query("SAVEPOINT pos_accounting_sale_posting");
  try {
    const company = await loadCompany(client, accountingContext, sale.company_id);
    const ledger = await getPrimaryLedger(client, accountingContext, company.id);
    const { lines, date } = await buildSaleJournalLines(client, context, accountingContext, company, ledger, sale);
    const journalId = await salesJournalId(client, context, company.id, ledger.id);
    const journal = await createJournalEntry(client, accountingContext, {
      companyId: company.id, ledgerId: ledger.id, journalId, entryDate: date, accountingDate: date, documentDate: date,
      entryType: "subledger", reference: sale.receipt_number, description: `POS sale ${sale.receipt_number}`,
      currencyCode: sale.currency_code, lines,
    }, { internal: true, sourceModule: "point_of_sale", sourceType: "pos_sale", sourceId: sale.id, sourceNumber: sale.receipt_number });
    await postJournalEntry(client, accountingContext, journal.entry.id, { internal: true, allowDraft: true });
    await client.query("RELEASE SAVEPOINT pos_accounting_sale_posting");
    await client.query(
      `UPDATE tenant.pos_sales SET journal_entry_id=$3,accounting_posting_status='posted',accounting_posted_at=now(),accounting_posting_error=NULL
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, sale.id, journal.entry.id],
    );
    await event(client, context, sale.id, "pos.accounting_posting.posted", { journalEntryId: journal.entry.id });
    return { posted: true, replayed: false, journalEntryId: journal.entry.id };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    await client.query("ROLLBACK TO SAVEPOINT pos_accounting_sale_posting");
    await client.query("RELEASE SAVEPOINT pos_accounting_sale_posting");
    await client.query(
      `UPDATE tenant.pos_sales SET accounting_posting_status='failed',accounting_posting_error=$3 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, sale.id, message],
    );
    await event(client, context, sale.id, "pos.accounting_posting.failed", { message });
    return { posted: false, failed: true, message };
  }
}

export async function postPosReturnToAccounting(client, context, returnId) {
  requirePermission(context, "pos.accounting.post");
  const posReturn = await lockPosReturn(client, context, returnId);
  await assertPosStoreAccess(client, context, posReturn.store_id);
  if (posReturn.journal_entry_id) {
    return { posted: true, replayed: true, journalEntryId: posReturn.journal_entry_id };
  }
  if (posReturn.status !== "completed") {
    throw posError(409, "Only a completed POS return can be posted to accounting.", "POS_ACCOUNTING_RETURN_NOT_COMPLETED");
  }

  const accountingContext = posAccountingContext(context);
  await client.query("SAVEPOINT pos_accounting_return_posting");
  try {
    const company = await loadCompany(client, accountingContext, posReturn.company_id);
    const ledger = await getPrimaryLedger(client, accountingContext, company.id);
    const { lines, date } = await buildReturnJournalLines(client, context, accountingContext, company, ledger, posReturn);
    const originalSale = await client.query(
      `SELECT currency_code FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, posReturn.sale_id],
    );
    const journalId = await salesJournalId(client, context, company.id, ledger.id);
    const journal = await createJournalEntry(client, accountingContext, {
      companyId: company.id, ledgerId: ledger.id, journalId, entryDate: date, accountingDate: date, documentDate: date,
      entryType: "subledger", reference: posReturn.return_number, description: `POS return ${posReturn.return_number}`,
      currencyCode: originalSale.rows[0]?.currency_code || null, lines,
    }, { internal: true, sourceModule: "point_of_sale", sourceType: "pos_return", sourceId: posReturn.id, sourceNumber: posReturn.return_number });
    await postJournalEntry(client, accountingContext, journal.entry.id, { internal: true, allowDraft: true });
    await client.query("RELEASE SAVEPOINT pos_accounting_return_posting");
    await client.query(
      `UPDATE tenant.pos_returns SET journal_entry_id=$3,accounting_posting_status='posted',accounting_posted_at=now(),accounting_posting_error=NULL
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, posReturn.id, journal.entry.id],
    );
    await event(client, context, posReturn.id, "pos.accounting_posting.posted", { journalEntryId: journal.entry.id });
    return { posted: true, replayed: false, journalEntryId: journal.entry.id };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    await client.query("ROLLBACK TO SAVEPOINT pos_accounting_return_posting");
    await client.query("RELEASE SAVEPOINT pos_accounting_return_posting");
    await client.query(
      `UPDATE tenant.pos_returns SET accounting_posting_status='failed',accounting_posting_error=$3 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, posReturn.id, message],
    );
    await event(client, context, posReturn.id, "pos.accounting_posting.failed", { message });
    return { posted: false, failed: true, message };
  }
}

// Best-effort batch poster over a day-end report's own lineage (see F303's
// day-end-reports.js) — mirrors procurement-accounting-vendor-bill.js's own
// documented "best-effort, not strict" precedent: one sale/return's
// posting failure never blocks another's, and never blocks the day-end
// report itself (already closed/immutable by the time this runs).
export async function postPosDayEndReportToAccounting(client, context, reportId) {
  requirePermission(context, "pos.accounting.post");
  const reportResult = await client.query(
    `SELECT * FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, reportId],
  );
  const report = reportResult.rows[0];
  if (!report) throw posError(404, "POS day-end report was not found.", "POS_DAY_END_REPORT_NOT_FOUND");
  await assertPosStoreAccess(client, context, report.store_id);
  if (!["reviewed", "closed"].includes(report.status)) {
    throw posError(409, "Only a reviewed or closed day-end report's sales can be posted to accounting.", "POS_DAY_END_STATE_INVALID");
  }
  const lineage = report.lineage && typeof report.lineage === "object" ? report.lineage : {};
  const saleIds = Array.isArray(lineage.saleIds) ? lineage.saleIds : [];
  const returnIds = Array.isArray(lineage.returnIds) ? lineage.returnIds : [];

  const posted = [];
  const alreadyPosted = [];
  const failed = [];
  for (const saleId of saleIds) {
    const outcome = await postPosSaleToAccounting(client, context, saleId);
    if (outcome.replayed) alreadyPosted.push({ type: "pos_sale", id: saleId });
    else if (outcome.posted) posted.push({ type: "pos_sale", id: saleId, journalEntryId: outcome.journalEntryId });
    else failed.push({ type: "pos_sale", id: saleId, message: outcome.message });
  }
  for (const returnId of returnIds) {
    const outcome = await postPosReturnToAccounting(client, context, returnId);
    if (outcome.replayed) alreadyPosted.push({ type: "pos_return", id: returnId });
    else if (outcome.posted) posted.push({ type: "pos_return", id: returnId, journalEntryId: outcome.journalEntryId });
    else failed.push({ type: "pos_return", id: returnId, message: outcome.message });
  }
  return { reportId, posted, alreadyPosted, failed };
}

export async function listPosAccountingPostingQueue(client, context, options = {}) {
  requirePermission(context, "pos.accounting.view");
  const values = [context.organizationId, context.companyId];
  const clauses = [];
  const status = ["pending", "posted", "failed", "not_applicable"].includes(options.status) ? options.status : null;
  if (status) {
    values.push(status);
    clauses.push(`accounting_posting_status=$${values.length}`);
  } else {
    clauses.push(`accounting_posting_status IN ('pending','failed')`);
  }
  if (options.storeId) {
    values.push(options.storeId);
    clauses.push(`store_id=$${values.length}`);
  }
  values.push(Math.min(Number(options.limit) || 100, 200));
  const sales = await client.query(
    `SELECT id,'pos_sale' AS document_type,receipt_number AS document_number,store_id,grand_total,currency_code,
            accounting_posting_status,accounting_posting_error,accounting_posted_at,completed_at
       FROM tenant.pos_sales
      WHERE organization_id=$1 AND company_id=$2 AND status IN ('completed','partially_returned','returned') AND ${clauses.join(" AND ")}
      ORDER BY completed_at DESC LIMIT $${values.length}`,
    values,
  );
  const returns = await client.query(
    `SELECT id,'pos_return' AS document_type,return_number AS document_number,store_id,refund_total AS grand_total,NULL AS currency_code,
            accounting_posting_status,accounting_posting_error,accounting_posted_at,completed_at
       FROM tenant.pos_returns
      WHERE organization_id=$1 AND company_id=$2 AND status='completed' AND ${clauses.join(" AND ")}
      ORDER BY completed_at DESC LIMIT $${values.length}`,
    values,
  );
  return [...sales.rows, ...returns.rows].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
}
