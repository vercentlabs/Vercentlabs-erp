import { randomUUID } from "node:crypto";
import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  asDatabaseDecimal,
  currency,
  decimal,
  ensureParty,
  event,
  getAccountMapping,
  getCurrencyPrecision,
  getExchangeRate,
  getPrimaryLedger,
  isoDate,
  loadOrganization,
  mul,
  optionalUuid,
  positiveAmount,
  requirePermission,
  requiredText,
  roundMoney,
  text,
  toBaseAmount,
  uuid,
} from "./core.js";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "./journals.js";
import { div, sub } from "./money.js";
import { recordDocumentTaxLedger } from "./tax.js";
import { refreshSalesOrderProgress } from "../sales/orders/progress.js";
import { resolvePaymentSchedule } from "./schedules.js";
import { createCustomerSettlementAdjustment } from "./settlements.js";

async function salesJournal(client, context, ledgerId) {
  const result = await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND ledger_id=$2 AND journal_type='sales' AND status='active' ORDER BY created_at LIMIT 1`, [context.organizationId, ledgerId]);
  if (!result.rows[0]) throw new AccountingError(409, "A Sales accounting journal is not configured.");
  return result.rows[0].id;
}

async function bankJournal(client, context, ledgerId, bankAccountId = null) {
  if (bankAccountId) {
    const bank = await client.query(`SELECT bank.*,journal.id AS journal_id FROM tenant.accounting_bank_accounts bank LEFT JOIN tenant.accounting_journals journal ON journal.organization_id=bank.organization_id AND journal.ledger_id=bank.ledger_id AND journal.journal_type='bank' AND journal.status='active' WHERE bank.organization_id=$1 AND bank.ledger_id=$2 AND bank.id=$3 AND bank.status='active' ORDER BY journal.created_at LIMIT 1`, [context.organizationId, ledgerId, uuid(bankAccountId, "Bank account")]);
    if (!bank.rows[0]) throw new AccountingError(409, "Bank account is unavailable for this ledger.");
    return bank.rows[0];
  }
  const result = await client.query(`SELECT journal.id AS journal_id,account.id AS gl_account_id FROM tenant.accounting_journals journal LEFT JOIN tenant.accounting_account_mappings mapping ON mapping.organization_id=journal.organization_id AND mapping.ledger_id=journal.ledger_id AND mapping.mapping_key='bank' AND mapping.status='active' LEFT JOIN tenant.accounting_accounts account ON account.id=mapping.account_id WHERE journal.organization_id=$1 AND journal.ledger_id=$2 AND journal.journal_type='bank' AND journal.status='active' ORDER BY journal.created_at LIMIT 1`, [context.organizationId, ledgerId]);
  if (!result.rows[0]?.gl_account_id) throw new AccountingError(409, "A bank journal and bank account mapping are required.");
  return result.rows[0];
}

async function reduceInvoiceSchedules(client, context, invoiceId, amountValue, scheduleId = null) {
  let remaining = decimal(amountValue);
  const values = [context.organizationId, invoiceId];
  let scheduleFilter = "";
  if (scheduleId) { values.push(scheduleId); scheduleFilter = ` AND id=$${values.length}`; }
  const schedules = await client.query(
    `SELECT * FROM tenant.accounting_customer_invoice_schedules
      WHERE organization_id=$1 AND customer_invoice_id=$2 AND outstanding_amount>0${scheduleFilter}
      ORDER BY due_date,sequence FOR UPDATE`,
    values,
  );
  for (const schedule of schedules.rows) {
    if (remaining <= 0n) break;
    const outstanding = decimal(schedule.outstanding_amount);
    const applied = remaining < outstanding ? remaining : outstanding;
    const scheduleRemaining = outstanding - applied;
    await client.query(
      `UPDATE tenant.accounting_customer_invoice_schedules
        SET outstanding_amount=$3,status=$4 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, schedule.id, asDatabaseDecimal(scheduleRemaining),
        scheduleRemaining === 0n ? "paid" : "partially_paid"],
    );
    remaining -= applied;
  }
  if (remaining !== 0n) throw new AccountingError(409, "Invoice schedules do not reconcile to the requested allocation.");
}

function reversePostingLines(lines) {
  return lines.map((line) => ({ ...line, debit: line.credit || 0, credit: line.debit || 0 }));
}

async function normalizeInvoiceLines(client, context, organization, ledger, invoiceDate, lines, suppliedCurrency, exchangeRate) {
  if (!Array.isArray(lines) || lines.length < 1) throw new AccountingError(400, "At least one invoice line is required.");
  const precision = await getCurrencyPrecision(client, context, suppliedCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, organization.base_currency);
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  let grandTotal = 0n;
  const normalized = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const quantity = positiveAmount(line.quantity || 1, `Line ${index + 1} quantity`);
    const unitPrice = positiveAmount(line.unitPrice, `Line ${index + 1} unit price`);
    const gross = roundMoney(mul(quantity, unitPrice), precision);
    const discount = roundMoney(decimal(line.discountAmount || 0), precision);
    const tax = roundMoney(decimal(line.taxAmount || 0), precision);
    if (discount < 0n || discount > gross) throw new AccountingError(400, `Line ${index + 1} discount is invalid.`);
    if (tax < 0n) throw new AccountingError(400, `Line ${index + 1} tax is invalid.`);
    const net = sub(gross, discount);
    const total = net + tax;
    const revenue = line.accountId
      ? { account_id: uuid(line.accountId, "Revenue account") }
      : await getAccountMapping(client, context, ledger.id, "revenue", { itemId: line.itemId || null, date: invoiceDate });
    const taxAccount = tax > 0n
      ? (line.taxAccountId ? { account_id: uuid(line.taxAccountId, "Tax account") } : await getAccountMapping(client, context, ledger.id, "output_tax", { date: invoiceDate }))
      : null;
    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
    grandTotal += total;
    normalized.push({
      sequence: index + 1,
      sourceSalesOrderLineId: optionalUuid(line.sourceSalesOrderLineId, "Sales order line"),
      sourceSalesDeliveryLineId: optionalUuid(line.sourceSalesDeliveryLineId, "Delivery line"),
      itemId: optionalUuid(line.itemId, "Item"),
      description: requiredText(line.description, `Line ${index + 1} description`, 1000),
      hsnSacCode: text(line.hsnSacCode, 30) || null,
      quantity,
      uomId: optionalUuid(line.uomId, "Unit of measure"),
      unitPrice,
      discount,
      net,
      tax,
      total,
      revenueAccountId: revenue.account_id,
      taxAccountId: taxAccount?.account_id || null,
      taxDetails: Array.isArray(line.taxDetails) ? line.taxDetails : [],
      departmentId: optionalUuid(line.departmentId, "Department"),
      costCenterId: optionalUuid(line.costCenterId, "Cost centre"),
    });
  }
  return {
    lines: normalized,
    subtotal,
    discountTotal,
    taxTotal,
    grandTotal,
    baseTotal: toBaseAmount(grandTotal, exchangeRate, basePrecision),
    precision,
    basePrecision,
  };
}

async function insertInvoiceLines(client, context, invoiceId, lines) {
  const ids = [];
  for (const line of lines) {
    const inserted = await client.query(
      `INSERT INTO tenant.accounting_customer_invoice_lines (
        organization_id,customer_invoice_id,sequence,source_sales_order_line_id,item_id,description,hsn_sac_code,
        quantity,uom_id,unit_price,discount_amount,net_amount,tax_amount,line_total,revenue_account_id,
        tax_account_id,tax_details,department_id,cost_center_id,created_by,source_sales_delivery_line_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21) RETURNING id`,
      [context.organizationId, invoiceId, line.sequence, line.sourceSalesOrderLineId, line.itemId, line.description,
        line.hsnSacCode, asDatabaseDecimal(line.quantity), line.uomId, asDatabaseDecimal(line.unitPrice),
        asDatabaseDecimal(line.discount), asDatabaseDecimal(line.net), asDatabaseDecimal(line.tax),
        asDatabaseDecimal(line.total), line.revenueAccountId, line.taxAccountId, JSON.stringify(line.taxDetails),
        line.departmentId, line.costCenterId, context.userId, line.sourceSalesDeliveryLineId ?? null],
    );
    ids.push(inserted.rows[0].id);
  }
  return ids;
}


export async function createCustomerInvoice(client, context, input, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.receivablesManage);
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context, input.ledgerId);
  const party = await ensureParty(client, context, input.partyId, ["customer", "both"]);
  const invoiceDate = isoDate(input.invoiceDate || new Date().toISOString().slice(0, 10), "Invoice date");
  const accountingDate = isoDate(input.accountingDate || invoiceDate, "Accounting date");
  const explicitDueDate = input.dueDate ? isoDate(input.dueDate, "Due date") : null;
  const invoiceCurrency = currency(input.currencyCode || party.currency_code || organization.base_currency);
  const exchangeRate = await getExchangeRate(client, context, invoiceCurrency, organization.base_currency, accountingDate, input.exchangeRate);
  const totals = await normalizeInvoiceLines(client, context, organization, ledger, invoiceDate, input.lines, invoiceCurrency, exchangeRate);
  const chargeTotal = roundMoney(decimal(input.chargeTotal || 0), totals.precision);
  const roundingAdjustment = roundMoney(decimal(input.roundingAdjustment || 0), totals.precision);
  if (chargeTotal < 0n) throw new AccountingError(400, "Invoice charges cannot be negative.");
  const grandTotal = totals.grandTotal + chargeTotal + roundingAdjustment;
  if (grandTotal <= 0n) throw new AccountingError(400, "Invoice grand total must be positive.");
  const baseTotal = toBaseAmount(grandTotal, exchangeRate, totals.basePrecision);
  const paymentSchedule = await resolvePaymentSchedule(client, context, {
    documentDate: invoiceDate, explicitDueDate, paymentTermId: input.paymentTermId,
    partyPaymentTermId: party.payment_term_id, snapshot: input.paymentTermSnapshot,
    total: grandTotal, precision: totals.precision,
  });
  const dueDate = paymentSchedule.dueDate;
  const invoiceType = ["invoice", "credit_note", "debit_note", "opening"].includes(input.invoiceType) ? input.invoiceType : "invoice";
  const sourceInvoiceId = optionalUuid(input.sourceInvoiceId, "Source invoice");
  if (sourceInvoiceId) {
    const source = await client.query(
      `SELECT id,invoice_type,currency_code FROM tenant.accounting_customer_invoices
       WHERE organization_id=$1 AND id=$2 AND ledger_id=$3 AND party_id=$4`,
      [context.organizationId, sourceInvoiceId, ledger.id, party.id],
    );
    if (!source.rows[0]) throw new AccountingError(409, "The source customer document does not belong to this ledger and customer.");
    if (source.rows[0].currency_code !== invoiceCurrency) throw new AccountingError(409, "The source customer document currency must match.");
    if (invoiceType === "credit_note" && source.rows[0].invoice_type === "credit_note") throw new AccountingError(409, "A customer credit note cannot be credited again.");    // A credit note against an invoice reverses that invoice's own values: it
    // cannot credit more taxable value or more tax than the invoice still carries.
    if (invoiceType === "credit_note") {
      const carried = (await client.query(
        `SELECT source.subtotal - source.discount_total AS taxable, source.tax_total AS tax,
                COALESCE(sum(credit.subtotal - credit.discount_total), 0) AS credited_taxable, COALESCE(sum(credit.tax_total), 0) AS credited_tax
           FROM tenant.accounting_customer_invoices source
           LEFT JOIN tenant.accounting_customer_invoices credit ON credit.organization_id=source.organization_id AND credit.source_invoice_id=source.id
                AND credit.invoice_type='credit_note' AND credit.status NOT IN ('cancelled','reversed')
          WHERE source.organization_id=$1 AND source.id=$2 GROUP BY source.id`,
        [context.organizationId, sourceInvoiceId],
      )).rows[0];
      const creditTaxable = totals.subtotal - totals.discountTotal;
      if (creditTaxable + decimal(carried.credited_taxable) > decimal(carried.taxable))
        throw new AccountingError(409, "The credit note is for more than the taxable value left on the invoice.", "ACCOUNTING_CREDIT_EXCEEDS_INVOICE");
      if (totals.taxTotal + decimal(carried.credited_tax) > decimal(carried.tax))
        throw new AccountingError(409, "The credit note carries more tax than is left on the invoice.", "ACCOUNTING_CREDIT_TAX_EXCEEDS_INVOICE");
    }
  }
  const entityType = invoiceType === "credit_note" ? "customer_credit_note" : "customer_invoice";
  const invoiceNumber = await allocateNumber(client, context.organizationId, entityType);
  const result = await client.query(
    `INSERT INTO tenant.accounting_customer_invoices (
      organization_id,ledger_id,invoice_number,invoice_type,party_id,billing_address_id,
      source_sales_order_id,source_sales_invoice_request_id,source_invoice_id,invoice_date,accounting_date,due_date,
      currency_code,functional_currency_code,exchange_rate,customer_snapshot,billing_address_snapshot,payment_term_snapshot,
      place_of_supply,supply_type,subtotal,discount_total,charge_total,tax_total,rounding_adjustment,grand_total,
      base_currency_total,outstanding_amount,status,notes,terms_and_conditions,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,
      $19,$20,$21,$22,$23,$24,$25,$26,$27,$26,'draft',$28,$29,$30,$30) RETURNING *`,
    [context.organizationId, ledger.id, invoiceNumber, invoiceType, party.id,
      optionalUuid(input.billingAddressId, "Billing address"), optionalUuid(options.sourceSalesOrderId || input.sourceSalesOrderId, "Sales order"),
      optionalUuid(options.sourceSalesInvoiceRequestId || input.sourceSalesInvoiceRequestId, "Sales invoice request"),
      sourceInvoiceId, invoiceDate, accountingDate, dueDate, invoiceCurrency,
      organization.base_currency, asDatabaseDecimal(exchangeRate), JSON.stringify(input.customerSnapshot || { id: party.id, code: party.code, displayName: party.display_name, legalName: party.legal_name, gstin: party.gstin, pan: party.pan }),
      JSON.stringify(input.billingAddressSnapshot || {}), JSON.stringify(paymentSchedule.snapshot), text(input.placeOfSupply, 100) || null,
      ["domestic", "export", "sez", "exempt", "non_gst"].includes(input.supplyType) ? input.supplyType : "domestic",
      asDatabaseDecimal(totals.subtotal), asDatabaseDecimal(totals.discountTotal), asDatabaseDecimal(chargeTotal),
      asDatabaseDecimal(totals.taxTotal), asDatabaseDecimal(roundingAdjustment),
      asDatabaseDecimal(grandTotal), asDatabaseDecimal(baseTotal), text(input.notes, 2000) || null,
      text(input.termsAndConditions, 5000) || null, context.userId],
  );
  const invoice = result.rows[0];
  const lineIds = await insertInvoiceLines(client, context, invoice.id, totals.lines);
  for (const installment of paymentSchedule.installments) {
    await client.query(
      `INSERT INTO tenant.accounting_customer_invoice_schedules
        (organization_id,customer_invoice_id,sequence,due_date,amount,outstanding_amount)
       VALUES ($1,$2,$3,$4,$5,$5)`,
      [context.organizationId, invoice.id, installment.sequence, installment.dueDate, asDatabaseDecimal(installment.amount)],
    );
  }
  await event(client, context, "customer_invoice", invoice.id, "accounting.customer_invoice.created", null, "draft", { invoiceNumber });
  if (options.returnLineIds) return { id: invoice.id, invoiceNumber, lineIds };
  return getCustomerInvoice(client, context, invoice.id);
}

// A draft's dates, lines and totals worked out again (a source module changing
// its draft, e.g. Sales changing the quantities). The number, customer and
// currency stay. input: as createCustomerInvoice (invoiceDate, accountingDate,
// dueDate, paymentTermSnapshot, lines, notes, termsAndConditions).
// Returns the new line ids in order.
export async function replaceCustomerInvoiceDraft(client, context, idValue, input, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.receivablesManage);
  const id = uuid(idValue, "Customer invoice");
  const invoice = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id])).rows[0];
  if (!invoice) throw new AccountingError(404, "Customer invoice not found.");
  if (invoice.status !== "draft") throw new AccountingError(409, "Only a draft customer invoice can be changed.", "ACCOUNTING_INVOICE_NOT_DRAFT");
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context, invoice.ledger_id);
  const invoiceDate = isoDate(input.invoiceDate || invoice.invoice_date, "Invoice date");
  const accountingDate = isoDate(input.accountingDate || invoiceDate, "Accounting date");
  const exchangeRate = await getExchangeRate(client, context, invoice.currency_code, organization.base_currency, accountingDate, invoice.exchange_rate);
  const totals = await normalizeInvoiceLines(client, context, organization, ledger, invoiceDate, input.lines, invoice.currency_code, exchangeRate);
  const grandTotal = totals.grandTotal + decimal(invoice.charge_total || 0) + decimal(invoice.rounding_adjustment || 0);
  if (grandTotal <= 0n) throw new AccountingError(400, "Invoice grand total must be positive.");
  const paymentSchedule = await resolvePaymentSchedule(client, context, {
    documentDate: invoiceDate, explicitDueDate: input.dueDate ? isoDate(input.dueDate, "Due date") : null, paymentTermId: null,
    partyPaymentTermId: null, snapshot: input.paymentTermSnapshot ?? invoice.payment_term_snapshot, total: grandTotal, precision: totals.precision,
  });
  await client.query(`DELETE FROM tenant.accounting_customer_invoice_schedules WHERE organization_id=$1 AND customer_invoice_id=$2`, [context.organizationId, id]);
  await client.query(`DELETE FROM tenant.accounting_customer_invoice_lines WHERE organization_id=$1 AND customer_invoice_id=$2`, [context.organizationId, id]);
  await client.query(
    `UPDATE tenant.accounting_customer_invoices
        SET invoice_date=$3,accounting_date=$4,due_date=$5,exchange_rate=$6,payment_term_snapshot=$7::jsonb,subtotal=$8,discount_total=$9,tax_total=$10,grand_total=$11,
            base_currency_total=$12,outstanding_amount=$11,notes=$13,terms_and_conditions=$14,updated_by=$15,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, id, invoiceDate, accountingDate, paymentSchedule.dueDate, asDatabaseDecimal(exchangeRate), JSON.stringify(paymentSchedule.snapshot),
      asDatabaseDecimal(totals.subtotal), asDatabaseDecimal(totals.discountTotal), asDatabaseDecimal(totals.taxTotal), asDatabaseDecimal(grandTotal),
      asDatabaseDecimal(toBaseAmount(grandTotal, exchangeRate, totals.basePrecision)), input.notes === undefined ? invoice.notes : text(input.notes, 2000) || null,
      input.termsAndConditions === undefined ? invoice.terms_and_conditions : text(input.termsAndConditions, 5000) || null, context.userId]);
  const lineIds = await insertInvoiceLines(client, context, id, totals.lines);
  for (const installment of paymentSchedule.installments)
    await client.query(
      `INSERT INTO tenant.accounting_customer_invoice_schedules (organization_id,customer_invoice_id,sequence,due_date,amount,outstanding_amount) VALUES ($1,$2,$3,$4,$5,$5)`,
      [context.organizationId, id, installment.sequence, installment.dueDate, asDatabaseDecimal(installment.amount)]);
  await event(client, context, "customer_invoice", id, "accounting.customer_invoice.updated", "draft", "draft", {});
  return { lineIds, dueDate: paymentSchedule.dueDate };
}

// Cancels an invoice that was never posted. Its number is kept, cancelled; nothing reached the books.
export async function cancelCustomerInvoiceDraft(client, context, idValue, input = {}, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.receivablesManage);
  const id = uuid(idValue, "Customer invoice");
  const invoice = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id])).rows[0];
  if (!invoice) throw new AccountingError(404, "Customer invoice not found.");
  if (invoice.status === "cancelled") return { id, status: "cancelled", changed: false };
  if (!["draft", "approved"].includes(invoice.status))
    throw new AccountingError(409, invoice.status === "pending_approval" ? "Withdraw the approval request first." : "A posted invoice is reversed or credited, never cancelled.", "ACCOUNTING_INVOICE_NOT_DRAFT");
  await client.query(`UPDATE tenant.accounting_customer_invoices SET status='cancelled',outstanding_amount=0,updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, context.userId]);
  await event(client, context, "customer_invoice", id, "accounting.customer_invoice.cancelled", invoice.status, "cancelled", { reason: text(input.reason, 1000) || null });
  if (invoice.source_sales_order_id) await refreshSalesOrderProgress(client, context.organizationId, invoice.source_sales_order_id, context.userId ?? null);
  return { id, status: "cancelled", changed: true };
}

// Reverses a posted invoice that nothing has been applied to (no receipt, no credit, no credit note, tax not yet reported):
// the journal is reversed, the receivable and the output tax are taken back, and the invoice is kept, Reversed.
// input: { reason, accountingDate? }. Returns { id, status, reversalEntryId }.
export async function reverseCustomerInvoice(client, context, idValue, input = {}, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.receivablesManage);
  const id = uuid(idValue, "Customer invoice");
  const reason = requiredText(input.reason, "Reversal reason", 500);
  const invoice = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id])).rows[0];
  if (!invoice) throw new AccountingError(404, "Customer invoice not found.");
  if (invoice.status === "reversed") return { id, status: "reversed", changed: false };
  if (["partially_paid", "paid"].includes(invoice.status))
    throw new AccountingError(409, "A payment or credit is applied to this invoice. Correct it with a credit note instead.", "ACCOUNTING_INVOICE_HAS_ALLOCATIONS");
  if (!["posted", "overdue"].includes(invoice.status) || !invoice.journal_entry_id)
    throw new AccountingError(409, "Only a posted invoice with nothing applied to it can be reversed.", "ACCOUNTING_INVOICE_NOT_REVERSIBLE");
  const applied = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.accounting_customer_receipt_allocations WHERE organization_id=$1 AND customer_invoice_id=$2)::int AS receipts,
            (SELECT count(*) FROM tenant.accounting_customer_credit_allocations WHERE organization_id=$1 AND customer_invoice_id=$2)::int AS credits,
            (SELECT count(*) FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND source_invoice_id=$2 AND status<>'cancelled')::int AS credit_notes,
            (SELECT count(*) FROM tenant.accounting_tax_ledger WHERE organization_id=$1 AND source_id=$2 AND status IN ('reported','paid'))::int AS reported`,
    [context.organizationId, id])).rows[0];
  if (applied.receipts || applied.credits || applied.credit_notes)
    throw new AccountingError(409, "A payment or credit is applied to this invoice. Correct it with a credit note instead.", "ACCOUNTING_INVOICE_HAS_ALLOCATIONS");
  if (applied.reported) throw new AccountingError(409, "The invoice's tax has already been reported. Correct it with a credit note instead.", "ACCOUNTING_INVOICE_TAX_REPORTED");
  const reversal = await reverseJournalEntry(client, { ...context, permissions: [...(context.permissions ?? []), ACCOUNTING_PERMISSIONS.journalReverse] }, invoice.journal_entry_id,
    { reason: `Invoice ${invoice.invoice_number} reversed: ${reason}`, accountingDate: input.accountingDate });
  await client.query(`UPDATE tenant.accounting_tax_ledger SET status='reversed' WHERE organization_id=$1 AND source_id=$2 AND status='open'`, [context.organizationId, id]);
  await client.query(`UPDATE tenant.accounting_customer_invoice_schedules SET outstanding_amount=0 WHERE organization_id=$1 AND customer_invoice_id=$2`, [context.organizationId, id]);
  await client.query(`UPDATE tenant.accounting_customer_invoices SET status='reversed',outstanding_amount=0,updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, context.userId]);
  await event(client, context, "customer_invoice", id, "accounting.customer_invoice.reversed", invoice.status, "reversed", { reason, reversalEntryId: reversal.entry?.id ?? reversal.id });
  if (invoice.source_sales_order_id) await refreshSalesOrderProgress(client, context.organizationId, invoice.source_sales_order_id, context.userId ?? null);
  return { id, status: "reversed", changed: true, reversalEntryId: reversal.entry?.id ?? reversal.id };
}

// Accounting's canonical receivables document visibility rule (customer
// invoices and receipts): accounting.view grants every document in the
// organisation. Exported (via accounting/index.js) so CRM Account 360
// applies exactly this rule instead of re-deriving it.
export function receivablesDocumentVisibilitySql(context, _bind, _alias) {
  const allowed = context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(ACCOUNTING_PERMISSIONS.view);
  return allowed ? "" : " AND false";
}

export async function listCustomerInvoices(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId]; let where = "";
  where += receivablesDocumentVisibilitySql(context, (value) => { values.push(value); return `$${values.length}`; }, "invoice");
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 30)); where += ` AND invoice.status=$${values.length}`; }
  if (filters.partyId) { values.push(uuid(filters.partyId, "Customer")); where += ` AND invoice.party_id=$${values.length}`; }
  if (filters.search) { values.push(`%${text(filters.search, 100)}%`); where += ` AND (invoice.invoice_number ILIKE $${values.length} OR party.display_name ILIKE $${values.length})`; }
  const result = await client.query(
    `SELECT invoice.id,invoice.party_id,invoice.invoice_number,invoice.invoice_type,invoice.invoice_date,invoice.due_date,invoice.currency_code,
      invoice.grand_total,invoice.outstanding_amount,invoice.status,party.display_name AS customer_name
      FROM tenant.accounting_customer_invoices invoice JOIN tenant.business_parties party ON party.id=invoice.party_id
      WHERE invoice.organization_id=$1${where} ORDER BY invoice.invoice_date DESC,invoice.created_at DESC LIMIT 300`, values);
  return result.rows;
}

export async function getCustomerInvoice(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(idValue, "Customer invoice");
  const result = await client.query(`SELECT invoice.*,party.display_name AS customer_name FROM tenant.accounting_customer_invoices invoice JOIN tenant.business_parties party ON party.id=invoice.party_id WHERE invoice.organization_id=$1 AND invoice.id=$2`, [context.organizationId, id]);
  const invoice = result.rows[0];
  if (!invoice) throw new AccountingError(404, "Customer invoice not found.");
  // Sequential, not Promise.all: a single pg client can only run one query
  // at a time (concurrent queries on the same connection are deprecated
  // and will error in pg@9) -- this six-way Promise.all was surfacing as a
  // real DeprecationWarning when getCustomerInvoice was called from POS's
  // F290 invoice-generation path, which reuses this same connection.
  const lines = await client.query(`SELECT line.*,account.code AS revenue_account_code,account.name AS revenue_account_name FROM tenant.accounting_customer_invoice_lines line JOIN tenant.accounting_accounts account ON account.id=line.revenue_account_id WHERE line.organization_id=$1 AND line.customer_invoice_id=$2 ORDER BY line.sequence`, [context.organizationId, id]);
  const schedules = await client.query(`SELECT * FROM tenant.accounting_customer_invoice_schedules WHERE organization_id=$1 AND customer_invoice_id=$2 ORDER BY sequence`, [context.organizationId, id]);
  const allocations = await client.query(`SELECT allocation.*,receipt.receipt_number,receipt.receipt_date FROM tenant.accounting_customer_receipt_allocations allocation JOIN tenant.accounting_customer_receipts receipt ON receipt.id=allocation.receipt_id WHERE allocation.organization_id=$1 AND allocation.customer_invoice_id=$2 ORDER BY allocation.allocated_at DESC`, [context.organizationId, id]);
  const creditAllocations = await client.query(`SELECT allocation.*,credit.invoice_number AS credit_note_number,target.invoice_number AS target_invoice_number
      FROM tenant.accounting_customer_credit_allocations allocation
      JOIN tenant.accounting_customer_invoices credit ON credit.id=allocation.credit_note_id
      JOIN tenant.accounting_customer_invoices target ON target.id=allocation.customer_invoice_id
      WHERE allocation.organization_id=$1 AND (allocation.credit_note_id=$2 OR allocation.customer_invoice_id=$2)
      ORDER BY allocation.allocated_at DESC`, [context.organizationId, id]);
  const creditCandidates = invoice.invoice_type === "credit_note"
    ? await client.query(`SELECT id,invoice_number,invoice_date,due_date,currency_code,outstanding_amount
          FROM tenant.accounting_customer_invoices
          WHERE organization_id=$1 AND ledger_id=$2 AND party_id=$3
            AND invoice_type IN ('invoice','debit_note','opening')
            AND status IN ('posted','partially_paid','overdue','disputed') AND outstanding_amount>0
          ORDER BY due_date,invoice_date`, [context.organizationId, invoice.ledger_id, invoice.party_id])
    : { rows: [] };
  const events = await client.query(`SELECT * FROM tenant.accounting_events WHERE organization_id=$1 AND entity_type='customer_invoice' AND entity_id=$2 ORDER BY occurred_at DESC`, [context.organizationId, id]);
  return { invoice, lines: lines.rows, schedules: schedules.rows, allocations: allocations.rows,
    creditAllocations: creditAllocations.rows, creditCandidates: creditCandidates.rows, events: events.rows };
}

export async function postCustomerInvoice(client, context, idValue, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.receivablesManage);
  const id = uuid(idValue, "Customer invoice");
  const locked = await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  const invoice = locked.rows[0];
  if (!invoice) throw new AccountingError(404, "Customer invoice not found.");
  if (invoice.status === "posted" || invoice.status === "partially_paid" || invoice.status === "paid") return getCustomerInvoice(client, context, id);
  if (!options.fromSales && (await client.query(`SELECT 1 FROM tenant.sales_invoices WHERE organization_id=$1 AND customer_invoice_id=$2`, [context.organizationId, id])).rows[0])
    throw new AccountingError(409, "This is a Sales invoice: post it from Sales → Invoices, where its quantities and tax are checked first.", "ACCOUNTING_POST_FROM_SALES");
  if (invoice.status !== 'approved') throw new AccountingError(409, "Customer invoice must be approved before posting.");
  const detail = await getCustomerInvoice(client, context, id);
  const receivable = await getAccountMapping(client, context, invoice.ledger_id, "receivable", { partyId: invoice.party_id, date: invoice.accounting_date });
  const journalId = await salesJournal(client, context, invoice.ledger_id);
  const isCreditNote = invoice.invoice_type === "credit_note";
  let lines = [{ accountId: receivable.account_id, partyId: invoice.party_id, description: `Receivable ${invoice.invoice_number}`, debit: invoice.grand_total, credit: 0, dueDate: invoice.due_date, referenceType: "customer_invoice", referenceId: invoice.id }];
  for (const line of detail.lines) {
    if (decimal(line.net_amount) > 0n) lines.push({ accountId: line.revenue_account_id, partyId: invoice.party_id, departmentId: line.department_id, costCenterId: line.cost_center_id, description: line.description, debit: 0, credit: line.net_amount, referenceType: "customer_invoice", referenceId: invoice.id });
    if (decimal(line.tax_amount) > 0n && line.tax_account_id) lines.push({ accountId: line.tax_account_id, partyId: invoice.party_id, description: `Output tax ${line.description}`, debit: 0, credit: line.tax_amount, referenceType: "customer_invoice", referenceId: invoice.id, taxBaseAmount: line.net_amount });
  }
  if (decimal(invoice.charge_total) > 0n) {
    const chargeAccount = await getAccountMapping(client, context, invoice.ledger_id, "revenue", { partyId: invoice.party_id, date: invoice.accounting_date });
    lines.push({ accountId: chargeAccount.account_id, partyId: invoice.party_id, description: `Invoice charges ${invoice.invoice_number}`, debit: 0, credit: invoice.charge_total, referenceType: "customer_invoice", referenceId: invoice.id });
  }
  if (decimal(invoice.rounding_adjustment) !== 0n) {
    const rounding = await getAccountMapping(client, context, invoice.ledger_id, "rounding", { date: invoice.accounting_date });
    const amount = decimal(invoice.rounding_adjustment);
    lines.push({ accountId: rounding.account_id, description: `Rounding ${invoice.invoice_number}`, debit: amount < 0n ? asDatabaseDecimal(-amount) : 0, credit: amount > 0n ? asDatabaseDecimal(amount) : 0, referenceType: "customer_invoice", referenceId: invoice.id });
  }
  if (isCreditNote) lines = reversePostingLines(lines);
  const postedTotal = lines.slice(1).reduce((total, line) => total
    + (isCreditNote ? decimal(line.debit || 0) - decimal(line.credit || 0) : decimal(line.credit || 0) - decimal(line.debit || 0)), 0n);
  if (postedTotal !== decimal(invoice.grand_total)) {
    throw new AccountingError(409, "Customer invoice posting does not reconcile to the document grand total.");
  }
  const sourceType = isCreditNote ? "customer_credit_note" : "customer_invoice";
  const journal = await createJournalEntry(client, context, {
    ledgerId: invoice.ledger_id, journalId,
    entryDate: invoice.invoice_date, accountingDate: invoice.accounting_date, documentDate: invoice.invoice_date,
    entryType: "subledger", reference: invoice.invoice_number, description: `Customer invoice ${invoice.invoice_number}`,
    currencyCode: invoice.currency_code, exchangeRate: invoice.exchange_rate, lines,
  }, { internal: true, sourceModule: "accounting", sourceType, sourceId: invoice.id, sourceNumber: invoice.invoice_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  await recordDocumentTaxLedger(client, context, invoice, detail.lines, journal.entry.id, "output");
  await client.query(`UPDATE tenant.accounting_customer_invoices SET status='posted',journal_entry_id=$3,outstanding_amount=grand_total,posted_at=now(),posted_by=$4,updated_by=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, journal.entry.id, context.userId]);
  // The order's invoiced quantities and invoice status follow from its invoices.
  if (invoice.source_sales_order_id) await refreshSalesOrderProgress(client, context.organizationId, invoice.source_sales_order_id, context.userId ?? null);
  await event(client, context, "customer_invoice", id, "accounting.customer_invoice.posted", invoice.status, "posted", { journalEntryId: journal.entry.id });
  return getCustomerInvoice(client, context, id);
}

export async function createCustomerReceipt(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context, input.ledgerId);
  const party = await ensureParty(client, context, input.partyId, ["customer", "both"]);
  const receiptDate = isoDate(input.receiptDate || new Date().toISOString().slice(0, 10), "Receipt date");
  const accountingDate = isoDate(input.accountingDate || receiptDate, "Accounting date");
  const receiptCurrency = currency(input.currencyCode || party.currency_code || organization.base_currency);
  const rate = await getExchangeRate(client, context, receiptCurrency, organization.base_currency, accountingDate, input.exchangeRate);
  const precision = await getCurrencyPrecision(client, context, receiptCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, organization.base_currency);
  const amount = roundMoney(positiveAmount(input.amount, "Receipt amount"), precision);
  const baseAmount = toBaseAmount(amount, rate, basePrecision);
  const receiptNumber = await allocateNumber(client, context.organizationId, "customer_receipt");
  const result = await client.query(`INSERT INTO tenant.accounting_customer_receipts (organization_id,ledger_id,receipt_number,party_id,bank_account_id,receipt_date,accounting_date,currency_code,functional_currency_code,exchange_rate,amount,base_amount,unapplied_amount,payment_method,external_reference,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$13,$14,'draft',$15,$15) RETURNING *`, [context.organizationId, ledger.id, receiptNumber, party.id, optionalUuid(input.bankAccountId, "Bank account"), receiptDate, accountingDate, receiptCurrency, organization.base_currency, asDatabaseDecimal(rate), asDatabaseDecimal(amount), asDatabaseDecimal(baseAmount), ["cash","bank_transfer","card","upi","cheque","gateway","other"].includes(input.paymentMethod) ? input.paymentMethod : "bank_transfer", text(input.externalReference, 200) || null, context.userId]);
  await event(client, context, "customer_receipt", result.rows[0].id, "accounting.customer_receipt.created", null, "draft", { receiptNumber });
  return result.rows[0];
}

export async function postCustomerReceipt(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const id = uuid(idValue, "Customer receipt");
  const result = await client.query(`SELECT * FROM tenant.accounting_customer_receipts WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  const receipt = result.rows[0];
  if (!receipt) throw new AccountingError(404, "Customer receipt not found.");
  if (receipt.status !== "draft") return receipt;
  const bank = await bankJournal(client, context, receipt.ledger_id, receipt.bank_account_id);
  const receivable = await getAccountMapping(client, context, receipt.ledger_id, "receivable", { partyId: receipt.party_id, date: receipt.accounting_date });
  const journal = await createJournalEntry(client, context, {
    ledgerId: receipt.ledger_id, journalId: bank.journal_id,
    entryDate: receipt.receipt_date, accountingDate: receipt.accounting_date, entryType: "subledger",
    reference: receipt.external_reference || receipt.receipt_number, description: `Customer receipt ${receipt.receipt_number}`,
    currencyCode: receipt.currency_code, exchangeRate: receipt.exchange_rate,
    lines: [
      { accountId: bank.gl_account_id, description: `Bank receipt ${receipt.receipt_number}`, debit: receipt.amount, credit: 0, referenceType: "customer_receipt", referenceId: receipt.id },
      { accountId: receivable.account_id, partyId: receipt.party_id, description: `Customer receipt ${receipt.receipt_number}`, debit: 0, credit: receipt.amount, referenceType: "customer_receipt", referenceId: receipt.id },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "customer_receipt", sourceId: receipt.id, sourceNumber: receipt.receipt_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  const updated = await client.query(`UPDATE tenant.accounting_customer_receipts SET status='posted',journal_entry_id=$3,posted_at=now(),posted_by=$4,updated_by=$4 WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, id, journal.entry.id, context.userId]);
  await event(client, context, "customer_receipt", id, "accounting.customer_receipt.posted", "draft", "posted", { journalEntryId: journal.entry.id });
  return updated.rows[0];
}

export async function allocateCustomerReceipt(client, context, receiptIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const receiptId = uuid(receiptIdValue, "Customer receipt");
  const receiptResult = await client.query(
    `SELECT * FROM tenant.accounting_customer_receipts WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, receiptId],
  );
  const receipt = receiptResult.rows[0];
  if (!receipt || !["posted", "partially_applied"].includes(receipt.status)) {
    throw new AccountingError(409, "Receipt must be posted before allocation.");
  }
  if (!Array.isArray(input.allocations) || !input.allocations.length) {
    throw new AccountingError(400, "At least one invoice allocation is required.");
  }
  let totalReceiptAmount = 0n;
  let totalInvoiceSettlement = 0n;
  for (const allocation of input.allocations) {
    const invoiceId = uuid(allocation.invoiceId, "Customer invoice");
    const invoiceResult = await client.query(
      `SELECT * FROM tenant.accounting_customer_invoices
        WHERE organization_id=$1 AND id=$2 AND ledger_id=$3 AND party_id=$4 FOR UPDATE`,
      [context.organizationId, invoiceId, receipt.ledger_id, receipt.party_id],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice || !["posted", "partially_paid", "overdue", "disputed"].includes(invoice.status)) {
      throw new AccountingError(409, "An allocation invoice is unavailable or not open in the receipt ledger.");
    }
    const receiptAmount = positiveAmount(allocation.receiptAmount ?? allocation.amount, "Receipt allocation amount");
    const invoiceAmount = positiveAmount(allocation.invoiceAmount ?? allocation.amount, "Invoice allocation amount");
    const discountTaken = roundMoney(decimal(allocation.discountTaken || 0), await getCurrencyPrecision(client, context, invoice.currency_code));
    const writeoffAmount = roundMoney(decimal(allocation.writeoffAmount || 0), await getCurrencyPrecision(client, context, invoice.currency_code));
    if (discountTaken < 0n || writeoffAmount < 0n) throw new AccountingError(400, "Discount and write-off amounts cannot be negative.");
    const invoiceSettlement = invoiceAmount + discountTaken + writeoffAmount;
    if (invoiceSettlement > decimal(invoice.outstanding_amount)) {
      throw new AccountingError(409, `Allocation exceeds ${invoice.invoice_number} outstanding amount.`);
    }
    totalReceiptAmount += receiptAmount;
    totalInvoiceSettlement += invoiceSettlement;
    if (totalReceiptAmount > decimal(receipt.unapplied_amount)) {
      throw new AccountingError(409, "Allocations exceed the unapplied receipt amount.");
    }
    const scheduleId = optionalUuid(allocation.scheduleId, "Payment schedule");
    if (scheduleId) {
      const schedule = await client.query(
        `SELECT id,outstanding_amount FROM tenant.accounting_customer_invoice_schedules
          WHERE organization_id=$1 AND id=$2 AND customer_invoice_id=$3 AND outstanding_amount>0 FOR UPDATE`,
        [context.organizationId, scheduleId, invoice.id],
      );
      if (!schedule.rows[0] || invoiceSettlement > decimal(schedule.rows[0].outstanding_amount)) {
        throw new AccountingError(409, "The selected invoice installment is unavailable or smaller than the settlement.");
      }
    }
    const duplicate = await client.query(
      `SELECT id FROM tenant.accounting_customer_receipt_allocations
        WHERE organization_id=$1 AND receipt_id=$2 AND customer_invoice_id=$3
          AND COALESCE(schedule_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`,
      [context.organizationId, receipt.id, invoice.id, scheduleId],
    );
    if (duplicate.rows[0]) throw new AccountingError(409, "This receipt has already been allocated to the selected invoice installment.");
    const allocationId = randomUUID();
    const adjustment = await createCustomerSettlementAdjustment(client, context, {
      allocationId,
      ledgerId: receipt.ledger_id,
      partyId: receipt.party_id,
      accountingDate: receipt.accounting_date,
      reference: `${receipt.receipt_number}/${invoice.invoice_number}`,
      sourceAmount: receiptAmount,
      sourceExchangeRate: receipt.exchange_rate,
      documentAmount: invoiceAmount,
      documentExchangeRate: invoice.exchange_rate,
      adjustmentAmount: discountTaken + writeoffAmount,
    });
    await client.query(
      `INSERT INTO tenant.accounting_customer_receipt_allocations (
        id,organization_id,receipt_id,customer_invoice_id,schedule_id,allocated_amount,
        receipt_amount,invoice_amount,base_receipt_amount,base_invoice_amount,
        realized_gain_loss,discount_taken,writeoff_amount,adjustment_journal_entry_id,created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [allocationId, context.organizationId, receipt.id, invoice.id, scheduleId,
        asDatabaseDecimal(invoiceSettlement), asDatabaseDecimal(receiptAmount), asDatabaseDecimal(invoiceAmount),
        asDatabaseDecimal(adjustment.baseSourceAmount), asDatabaseDecimal(adjustment.baseDocumentAmount),
        adjustment.realizedGainLoss, asDatabaseDecimal(discountTaken), asDatabaseDecimal(writeoffAmount),
        adjustment.journalEntryId, context.userId],
    );
    await reduceInvoiceSchedules(client, context, invoice.id, invoiceSettlement, scheduleId);
    const remaining = decimal(invoice.outstanding_amount) - invoiceSettlement;
    const status = remaining === 0n ? "paid" : "partially_paid";
    await client.query(
      `UPDATE tenant.accounting_customer_invoices SET outstanding_amount=$3,status=$4,updated_by=$5
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, invoice.id, asDatabaseDecimal(remaining), status, context.userId],
    );
    await event(client, context, "customer_invoice", invoice.id, "accounting.customer_invoice.settled", invoice.status, status, {
      receiptId: receipt.id,
      receiptAmount: asDatabaseDecimal(receiptAmount),
      invoiceAmount: asDatabaseDecimal(invoiceAmount),
      discountTaken: asDatabaseDecimal(discountTaken),
      writeoffAmount: asDatabaseDecimal(writeoffAmount),
      realizedGainLoss: adjustment.realizedGainLoss,
      adjustmentJournalEntryId: adjustment.journalEntryId,
    });
  }
  const receiptRemaining = decimal(receipt.unapplied_amount) - totalReceiptAmount;
  const receiptStatus = receiptRemaining === 0n ? "applied" : "partially_applied";
  const updated = await client.query(
    `UPDATE tenant.accounting_customer_receipts SET unapplied_amount=$3,status=$4,updated_by=$5
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, receipt.id, asDatabaseDecimal(receiptRemaining), receiptStatus, context.userId],
  );
  await event(client, context, "customer_receipt", receipt.id, "accounting.customer_receipt.allocated", receipt.status, receiptStatus, {
    receiptAmount: asDatabaseDecimal(totalReceiptAmount),
    invoiceSettlementAmount: asDatabaseDecimal(totalInvoiceSettlement),
  });
  return updated.rows[0];
}

export async function applyCustomerCreditNote(client, context, creditNoteIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const creditNoteId = uuid(creditNoteIdValue, "Customer credit note");
  const creditResult = await client.query(
    `SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, creditNoteId],
  );
  const credit = creditResult.rows[0];
  if (!credit || credit.invoice_type !== "credit_note") throw new AccountingError(404, "Customer credit note not found.");
  if (!["posted", "partially_paid"].includes(credit.status) || decimal(credit.outstanding_amount) <= 0n) {
    throw new AccountingError(409, "Credit note must be posted and have an unapplied balance.");
  }
  if (!Array.isArray(input.allocations) || input.allocations.length < 1) {
    throw new AccountingError(400, "At least one invoice allocation is required.");
  }
  let totalAllocated = 0n;
  for (const allocation of input.allocations) {
    const invoiceId = uuid(allocation.invoiceId, "Customer invoice");
    const targetResult = await client.query(
      `SELECT * FROM tenant.accounting_customer_invoices
        WHERE organization_id=$1 AND id=$2 AND ledger_id=$3 AND party_id=$4 FOR UPDATE`,
      [context.organizationId, invoiceId, credit.ledger_id, credit.party_id],
    );
    const target = targetResult.rows[0];
    if (!target || !["invoice", "debit_note", "opening"].includes(target.invoice_type)
      || !["posted", "partially_paid", "overdue", "disputed"].includes(target.status)) {
      throw new AccountingError(409, "A target invoice is unavailable or not open.");
    }
    if (target.currency_code !== credit.currency_code) throw new AccountingError(409, "Credit and invoice currencies must match.");
    const amount = positiveAmount(allocation.amount, "Credit allocation amount");
    if (amount > decimal(target.outstanding_amount)) throw new AccountingError(409, `Allocation exceeds ${target.invoice_number} outstanding amount.`);
    totalAllocated += amount;
    if (totalAllocated > decimal(credit.outstanding_amount)) throw new AccountingError(409, "Allocations exceed the unapplied credit-note amount.");
    await client.query(
      `INSERT INTO tenant.accounting_customer_credit_allocations
        (organization_id,credit_note_id,customer_invoice_id,allocated_amount,created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id,credit_note_id,customer_invoice_id)
       DO UPDATE SET allocated_amount=tenant.accounting_customer_credit_allocations.allocated_amount+EXCLUDED.allocated_amount,
         allocated_at=now(),created_by=EXCLUDED.created_by`,
      [context.organizationId, credit.id, target.id, asDatabaseDecimal(amount), context.userId],
    );
    await reduceInvoiceSchedules(client, context, target.id, amount);
    const targetRemaining = decimal(target.outstanding_amount) - amount;
    await client.query(
      `UPDATE tenant.accounting_customer_invoices SET outstanding_amount=$3,status=$4,updated_by=$5,updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, target.id, asDatabaseDecimal(targetRemaining), targetRemaining === 0n ? "paid" : "partially_paid", context.userId],
    );
    await event(client, context, "customer_invoice", target.id, "accounting.customer_credit.applied", target.status,
      targetRemaining === 0n ? "paid" : "partially_paid", { creditNoteId: credit.id, amount: asDatabaseDecimal(amount) });
  }
  await reduceInvoiceSchedules(client, context, credit.id, totalAllocated);
  const creditRemaining = decimal(credit.outstanding_amount) - totalAllocated;
  const creditStatus = creditRemaining === 0n ? "paid" : "partially_paid";
  await client.query(
    `UPDATE tenant.accounting_customer_invoices SET outstanding_amount=$3,status=$4,updated_by=$5,updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, credit.id, asDatabaseDecimal(creditRemaining), creditStatus, context.userId],
  );
  await event(client, context, "customer_invoice", credit.id, "accounting.customer_credit.allocated", credit.status,
    creditStatus, { allocatedAmount: asDatabaseDecimal(totalAllocated) });
  return getCustomerInvoice(client, context, credit.id);
}
