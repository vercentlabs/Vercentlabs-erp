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
  loadCompany,
  mul,
  optionalUuid,
  positiveAmount,
  requirePermission,
  requiredText,
  roundMoney,
  text,
  toBaseAmount,
  uuid,
  validateBranch,
} from "./core.js";
import { createJournalEntry, postJournalEntry } from "./journals.js";
import { div, sub } from "./money.js";
import { recordDocumentTaxLedger } from "./tax.js";
import { resolvePaymentSchedule } from "./schedules.js";
import { createCustomerSettlementAdjustment } from "./settlements.js";

async function salesJournal(client, context, companyId, ledgerId) {
  const result = await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='sales' AND status='active' ORDER BY created_at LIMIT 1`, [context.organizationId, companyId, ledgerId]);
  if (!result.rows[0]) throw new AccountingError(409, "A Sales accounting journal is not configured.");
  return result.rows[0].id;
}

async function bankJournal(client, context, companyId, ledgerId, bankAccountId = null) {
  if (bankAccountId) {
    const bank = await client.query(`SELECT bank.*,journal.id AS journal_id FROM tenant.accounting_bank_accounts bank LEFT JOIN tenant.accounting_journals journal ON journal.organization_id=bank.organization_id AND journal.company_id=bank.company_id AND journal.ledger_id=bank.ledger_id AND journal.journal_type='bank' AND journal.status='active' WHERE bank.organization_id=$1 AND bank.company_id=$2 AND bank.ledger_id=$3 AND bank.id=$4 AND bank.status='active' ORDER BY journal.created_at LIMIT 1`, [context.organizationId, companyId, ledgerId, uuid(bankAccountId, "Bank account")]);
    if (!bank.rows[0]) throw new AccountingError(409, "Bank account is unavailable for this company ledger.");
    return bank.rows[0];
  }
  const result = await client.query(`SELECT journal.id AS journal_id,account.id AS gl_account_id FROM tenant.accounting_journals journal LEFT JOIN tenant.accounting_account_mappings mapping ON mapping.organization_id=journal.organization_id AND mapping.company_id=journal.company_id AND mapping.ledger_id=journal.ledger_id AND mapping.mapping_key='bank' AND mapping.status='active' LEFT JOIN tenant.accounting_accounts account ON account.id=mapping.account_id WHERE journal.organization_id=$1 AND journal.company_id=$2 AND journal.ledger_id=$3 AND journal.journal_type='bank' AND journal.status='active' ORDER BY journal.created_at LIMIT 1`, [context.organizationId, companyId, ledgerId]);
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

async function normalizeInvoiceLines(client, context, company, ledger, invoiceDate, lines, suppliedCurrency, exchangeRate) {
  if (!Array.isArray(lines) || lines.length < 1) throw new AccountingError(400, "At least one invoice line is required.");
  const precision = await getCurrencyPrecision(client, context, suppliedCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, company.base_currency);
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
      : await getAccountMapping(client, context, company.id, ledger.id, "revenue", { itemId: line.itemId || null, date: invoiceDate, branchId: line.branchId || null });
    const taxAccount = tax > 0n
      ? (line.taxAccountId ? { account_id: uuid(line.taxAccountId, "Tax account") } : await getAccountMapping(client, context, company.id, ledger.id, "output_tax", { date: invoiceDate }))
      : null;
    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
    grandTotal += total;
    normalized.push({
      sequence: index + 1,
      sourceSalesOrderLineId: optionalUuid(line.sourceSalesOrderLineId, "Sales order line"),
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
      branchId: optionalUuid(line.branchId, "Branch"),
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
  for (const line of lines) {
    await client.query(
      `INSERT INTO tenant.accounting_customer_invoice_lines (
        organization_id,customer_invoice_id,sequence,source_sales_order_line_id,item_id,description,hsn_sac_code,
        quantity,uom_id,unit_price,discount_amount,net_amount,tax_amount,line_total,revenue_account_id,
        tax_account_id,tax_details,branch_id,department_id,cost_center_id,created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21)`,
      [context.organizationId, invoiceId, line.sequence, line.sourceSalesOrderLineId, line.itemId, line.description,
        line.hsnSacCode, asDatabaseDecimal(line.quantity), line.uomId, asDatabaseDecimal(line.unitPrice),
        asDatabaseDecimal(line.discount), asDatabaseDecimal(line.net), asDatabaseDecimal(line.tax),
        asDatabaseDecimal(line.total), line.revenueAccountId, line.taxAccountId, JSON.stringify(line.taxDetails),
        line.branchId, line.departmentId, line.costCenterId, context.userId],
    );
  }
}


export async function createCustomerInvoice(client, context, input, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.receivablesManage);
  const company = await loadCompany(client, context, input.companyId);
  const branch = await validateBranch(client, context, company.id, input.branchId || context.activeBranchId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const party = await ensureParty(client, context, company.id, input.partyId, ["customer", "both"]);
  const invoiceDate = isoDate(input.invoiceDate || new Date().toISOString().slice(0, 10), "Invoice date");
  const accountingDate = isoDate(input.accountingDate || invoiceDate, "Accounting date");
  const explicitDueDate = input.dueDate ? isoDate(input.dueDate, "Due date") : null;
  const invoiceCurrency = currency(input.currencyCode || party.currency_code || company.base_currency);
  const exchangeRate = await getExchangeRate(client, context, company.id, invoiceCurrency, company.base_currency, accountingDate, input.exchangeRate);
  const totals = await normalizeInvoiceLines(client, context, company, ledger, invoiceDate, input.lines, invoiceCurrency, exchangeRate);
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
       WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND ledger_id=$4 AND party_id=$5`,
      [context.organizationId, sourceInvoiceId, company.id, ledger.id, party.id],
    );
    if (!source.rows[0]) throw new AccountingError(409, "The source customer document does not belong to this company, ledger and customer.");
    if (source.rows[0].currency_code !== invoiceCurrency) throw new AccountingError(409, "The source customer document currency must match.");
    if (invoiceType === "credit_note" && source.rows[0].invoice_type === "credit_note") throw new AccountingError(409, "A customer credit note cannot be credited again.");
  }
  const entityType = invoiceType === "credit_note" ? "customer_credit_note" : "customer_invoice";
  const invoiceNumber = await allocateNumber(client, context.organizationId, entityType);
  const result = await client.query(
    `INSERT INTO tenant.accounting_customer_invoices (
      organization_id,company_id,branch_id,ledger_id,invoice_number,invoice_type,party_id,billing_address_id,
      source_sales_order_id,source_sales_invoice_request_id,source_invoice_id,invoice_date,accounting_date,due_date,
      currency_code,functional_currency_code,exchange_rate,customer_snapshot,billing_address_snapshot,payment_term_snapshot,
      place_of_supply,supply_type,subtotal,discount_total,charge_total,tax_total,rounding_adjustment,grand_total,
      base_currency_total,outstanding_amount,status,notes,terms_and_conditions,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$28,'draft',$30,$31,$32,$32) RETURNING *`,
    [context.organizationId, company.id, branch?.id || null, ledger.id, invoiceNumber, invoiceType, party.id,
      optionalUuid(input.billingAddressId, "Billing address"), optionalUuid(options.sourceSalesOrderId || input.sourceSalesOrderId, "Sales order"),
      optionalUuid(options.sourceSalesInvoiceRequestId || input.sourceSalesInvoiceRequestId, "Sales invoice request"),
      sourceInvoiceId, invoiceDate, accountingDate, dueDate, invoiceCurrency,
      company.base_currency, asDatabaseDecimal(exchangeRate), JSON.stringify(input.customerSnapshot || { id: party.id, code: party.code, displayName: party.display_name, legalName: party.legal_name, gstin: party.gstin, pan: party.pan }),
      JSON.stringify(input.billingAddressSnapshot || {}), JSON.stringify(paymentSchedule.snapshot), text(input.placeOfSupply, 100) || null,
      ["domestic", "export", "sez", "exempt", "non_gst"].includes(input.supplyType) ? input.supplyType : "domestic",
      asDatabaseDecimal(totals.subtotal), asDatabaseDecimal(totals.discountTotal), asDatabaseDecimal(chargeTotal),
      asDatabaseDecimal(totals.taxTotal), asDatabaseDecimal(roundingAdjustment),
      asDatabaseDecimal(grandTotal), asDatabaseDecimal(baseTotal), text(input.notes, 2000) || null,
      text(input.termsAndConditions, 5000) || null, context.userId],
  );
  const invoice = result.rows[0];
  await insertInvoiceLines(client, context, invoice.id, totals.lines);
  for (const installment of paymentSchedule.installments) {
    await client.query(
      `INSERT INTO tenant.accounting_customer_invoice_schedules
        (organization_id,customer_invoice_id,sequence,due_date,amount,outstanding_amount)
       VALUES ($1,$2,$3,$4,$5,$5)`,
      [context.organizationId, invoice.id, installment.sequence, installment.dueDate, asDatabaseDecimal(installment.amount)],
    );
  }
  await event(client, context, "customer_invoice", invoice.id, "accounting.customer_invoice.created", null, "draft", { invoiceNumber });
  return getCustomerInvoice(client, context, invoice.id);
}

export async function createInvoiceFromSalesRequest(client, context, requestIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receivablesManage);
  const requestId = uuid(requestIdValue, "Sales invoice request");
  const requestResult = await client.query(`SELECT * FROM tenant.sales_invoice_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, requestId]);
  const request = requestResult.rows[0];
  if (!request) throw new AccountingError(404, "Sales invoice request not found.");
  const existing = await client.query(`SELECT id FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND source_sales_invoice_request_id=$2`, [context.organizationId, request.id]);
  if (existing.rows[0]) return getCustomerInvoice(client, context, existing.rows[0].id);
  if (!['pending','failed'].includes(request.status)) throw new AccountingError(409, `Sales invoice request is ${request.status}.`);
  await client.query(`UPDATE tenant.sales_invoice_requests SET status='processing',retry_count=retry_count+1,last_error=NULL WHERE organization_id=$1 AND id=$2`, [context.organizationId, request.id]);
  await client.query("SAVEPOINT accounting_sales_invoice_import");
  try {
    const orderResult = await client.query(
      `SELECT sales_order.*,version.* FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version
         ON version.organization_id=sales_order.organization_id
        AND version.id=$3 AND version.sales_order_id=sales_order.id
       WHERE sales_order.organization_id=$1 AND sales_order.id=$2`,
      [context.organizationId, request.sales_order_id, request.sales_order_version_id],
    );
    const order = orderResult.rows[0];
    if (!order) throw new AccountingError(409, "The source sales order no longer exists.");
    const payloadLines = Array.isArray(request.payload?.lines) ? request.payload.lines : [];
    if (!payloadLines.length) throw new AccountingError(409, "Sales invoice request contains no billable lines.");
    const sourceLines = await client.query(
      `SELECT line.*,progress.fulfilled_quantity,progress.invoiced_quantity,progress.cancelled_quantity
         FROM tenant.sales_order_lines line
         JOIN tenant.sales_order_line_progress progress
           ON progress.organization_id=line.organization_id AND progress.sales_order_line_id=line.id
        WHERE line.organization_id=$1 AND line.sales_order_version_id=$2
          AND line.id=ANY($3::uuid[])`,
      [context.organizationId, request.sales_order_version_id,
        payloadLines.map((line) => uuid(line.salesOrderLineId, "Sales order line"))],
    );
    const sourceMap = new Map(sourceLines.rows.map((line) => [line.id, line]));
    const lines = payloadLines.map((payloadLine) => {
      const source = sourceMap.get(payloadLine.salesOrderLineId);
      if (!source) throw new AccountingError(409, "A requested sales-order line is unavailable.");
      const invoiceQuantity = positiveAmount(payloadLine.remainingQuantity, "Invoice quantity");
      const available = request.quantity_basis === "fulfilled"
        ? decimal(source.fulfilled_quantity) - decimal(source.invoiced_quantity)
        : decimal(source.quantity) - decimal(source.invoiced_quantity) - decimal(source.cancelled_quantity);
      if (invoiceQuantity > available) {
        throw new AccountingError(409, `Requested invoice quantity exceeds the remaining ${request.quantity_basis} quantity for ${source.item_code_snapshot}.`);
      }
      const ratio = div(invoiceQuantity, source.quantity);
      return {
        sourceSalesOrderLineId: source.id,
        itemId: source.item_id,
        description: source.description_snapshot || source.item_name_snapshot,
        hsnSacCode: source.hsn_sac_snapshot,
        quantity: asDatabaseDecimal(invoiceQuantity),
        uomId: source.uom_id,
        unitPrice: source.unit_price,
        discountAmount: asDatabaseDecimal(mul(source.discount_amount, ratio)),
        taxAmount: asDatabaseDecimal(mul(source.tax_amount, ratio)),
        taxDetails: source.tax_trace,
        branchId: order.branch_id,
      };
    });
    const invoice = await createCustomerInvoice(client, context, {
      companyId: order.company_id,
      branchId: order.branch_id,
      ledgerId: null,
      partyId: order.party_id,
      billingAddressId: order.billing_address_id,
      invoiceDate: new Date().toISOString().slice(0, 10),
      accountingDate: new Date().toISOString().slice(0, 10),
      currencyCode: order.currency_code,
      exchangeRate: order.exchange_rate,
      customerSnapshot: order.customer_snapshot,
      billingAddressSnapshot: order.billing_address_snapshot,
      paymentTermSnapshot: order.payment_term_snapshot,
      placeOfSupply: order.place_of_supply,
      supplyType: order.supply_type,
      termsAndConditions: order.terms_and_conditions,
      lines,
    }, { internal: true, sourceSalesOrderId: order.sales_order_id, sourceSalesInvoiceRequestId: request.id });
    await client.query("RELEASE SAVEPOINT accounting_sales_invoice_import");
    await client.query(`UPDATE tenant.sales_invoice_requests SET status='completed',completed_at=now(),last_error=NULL WHERE organization_id=$1 AND id=$2`, [context.organizationId, request.id]);
    return invoice;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    await client.query("ROLLBACK TO SAVEPOINT accounting_sales_invoice_import");
    await client.query("RELEASE SAVEPOINT accounting_sales_invoice_import");
    await client.query(`UPDATE tenant.sales_invoice_requests SET status='failed',last_error=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, request.id, message]);
    return { accountingImportFailed: true, requestId: request.id, message };
  }
}

// Accounting's canonical receivables document visibility rule (customer
// invoices and receipts): accounting.view, then the active company for a
// company-scoped caller. Exported (via accounting/index.js) so CRM Account
// 360 applies exactly this rule instead of re-deriving it.
export function receivablesDocumentVisibilitySql(context, bind, alias) {
  const allowed = context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(ACCOUNTING_PERMISSIONS.view);
  if (!allowed) return " AND false";
  return !context.allowAllCompanies && context.activeCompanyId ? ` AND ${alias}.company_id=${bind(context.activeCompanyId)}` : "";
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
      invoice.grand_total,invoice.outstanding_amount,invoice.status,party.display_name AS customer_name,company.name AS company_name
      FROM tenant.accounting_customer_invoices invoice JOIN tenant.business_parties party ON party.id=invoice.party_id
      JOIN public.companies company ON company.id=invoice.company_id
      WHERE invoice.organization_id=$1${where} ORDER BY invoice.invoice_date DESC,invoice.created_at DESC LIMIT 300`, values);
  return result.rows;
}

export async function getCustomerInvoice(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(idValue, "Customer invoice");
  const result = await client.query(`SELECT invoice.*,party.display_name AS customer_name,company.name AS company_name FROM tenant.accounting_customer_invoices invoice JOIN tenant.business_parties party ON party.id=invoice.party_id JOIN public.companies company ON company.id=invoice.company_id WHERE invoice.organization_id=$1 AND invoice.id=$2`, [context.organizationId, id]);
  const invoice = result.rows[0];
  if (!invoice) throw new AccountingError(404, "Customer invoice not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && invoice.company_id !== context.activeCompanyId) throw new AccountingError(403, "Switch to the invoice company to view it.");
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
          WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND party_id=$4
            AND invoice_type IN ('invoice','debit_note','opening')
            AND status IN ('posted','partially_paid','overdue','disputed') AND outstanding_amount>0
          ORDER BY due_date,invoice_date`, [context.organizationId, invoice.company_id, invoice.ledger_id, invoice.party_id])
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
  if (invoice.status !== 'approved') throw new AccountingError(409, "Customer invoice must be approved before posting.");
  const detail = await getCustomerInvoice(client, context, id);
  const receivable = await getAccountMapping(client, context, invoice.company_id, invoice.ledger_id, "receivable", { partyId: invoice.party_id, date: invoice.accounting_date, branchId: invoice.branch_id });
  const journalId = await salesJournal(client, context, invoice.company_id, invoice.ledger_id);
  const isCreditNote = invoice.invoice_type === "credit_note";
  let lines = [{ accountId: receivable.account_id, partyId: invoice.party_id, branchId: invoice.branch_id, description: `Receivable ${invoice.invoice_number}`, debit: invoice.grand_total, credit: 0, dueDate: invoice.due_date, referenceType: "customer_invoice", referenceId: invoice.id }];
  for (const line of detail.lines) {
    if (decimal(line.net_amount) > 0n) lines.push({ accountId: line.revenue_account_id, partyId: invoice.party_id, branchId: line.branch_id || invoice.branch_id, departmentId: line.department_id, costCenterId: line.cost_center_id, description: line.description, debit: 0, credit: line.net_amount, referenceType: "customer_invoice", referenceId: invoice.id });
    if (decimal(line.tax_amount) > 0n && line.tax_account_id) lines.push({ accountId: line.tax_account_id, partyId: invoice.party_id, branchId: line.branch_id || invoice.branch_id, description: `Output tax ${line.description}`, debit: 0, credit: line.tax_amount, referenceType: "customer_invoice", referenceId: invoice.id, taxBaseAmount: line.net_amount });
  }
  if (decimal(invoice.charge_total) > 0n) {
    const chargeAccount = await getAccountMapping(client, context, invoice.company_id, invoice.ledger_id, "revenue", { partyId: invoice.party_id, date: invoice.accounting_date, branchId: invoice.branch_id });
    lines.push({ accountId: chargeAccount.account_id, partyId: invoice.party_id, branchId: invoice.branch_id, description: `Invoice charges ${invoice.invoice_number}`, debit: 0, credit: invoice.charge_total, referenceType: "customer_invoice", referenceId: invoice.id });
  }
  if (decimal(invoice.rounding_adjustment) !== 0n) {
    const rounding = await getAccountMapping(client, context, invoice.company_id, invoice.ledger_id, "rounding", { date: invoice.accounting_date });
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
    companyId: invoice.company_id, branchId: invoice.branch_id, ledgerId: invoice.ledger_id, journalId,
    entryDate: invoice.invoice_date, accountingDate: invoice.accounting_date, documentDate: invoice.invoice_date,
    entryType: "subledger", reference: invoice.invoice_number, description: `Customer invoice ${invoice.invoice_number}`,
    currencyCode: invoice.currency_code, exchangeRate: invoice.exchange_rate, lines,
  }, { internal: true, sourceModule: "accounting", sourceType, sourceId: invoice.id, sourceNumber: invoice.invoice_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  await recordDocumentTaxLedger(client, context, invoice, detail.lines, journal.entry.id, "output");
  await client.query(`UPDATE tenant.accounting_customer_invoices SET status='posted',journal_entry_id=$3,outstanding_amount=grand_total,posted_at=now(),posted_by=$4,updated_by=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, journal.entry.id, context.userId]);
  for (const line of detail.lines) {
    if (!line.source_sales_order_line_id) continue;
    await client.query(`UPDATE tenant.sales_order_line_progress
      SET invoiced_quantity=GREATEST(0,invoiced_quantity+($3::numeric*$4::numeric)),updated_by=$5,updated_at=now()
      WHERE organization_id=$1 AND sales_order_line_id=$2`,
    [context.organizationId, line.source_sales_order_line_id, line.quantity, isCreditNote ? -1 : 1, context.userId]);
  }
  if (invoice.source_sales_order_id) {
    await client.query(`UPDATE tenant.sales_orders SET billing_status=CASE WHEN EXISTS (SELECT 1 FROM tenant.sales_order_line_progress progress JOIN tenant.sales_order_lines line ON line.id=progress.sales_order_line_id JOIN tenant.sales_orders sales_order ON sales_order.current_version_id=line.sales_order_version_id WHERE sales_order.id=$2 AND progress.invoiced_quantity < line.quantity-progress.cancelled_quantity) THEN 'partially_invoiced' ELSE 'fully_invoiced' END,updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, invoice.source_sales_order_id, context.userId]);
  }
  await event(client, context, "customer_invoice", id, "accounting.customer_invoice.posted", invoice.status, "posted", { journalEntryId: journal.entry.id });
  return getCustomerInvoice(client, context, id);
}

export async function createCustomerReceipt(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.receiptsManage);
  const company = await loadCompany(client, context, input.companyId);
  const branch = await validateBranch(client, context, company.id, input.branchId || context.activeBranchId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const party = await ensureParty(client, context, company.id, input.partyId, ["customer", "both"]);
  const receiptDate = isoDate(input.receiptDate || new Date().toISOString().slice(0, 10), "Receipt date");
  const accountingDate = isoDate(input.accountingDate || receiptDate, "Accounting date");
  const receiptCurrency = currency(input.currencyCode || party.currency_code || company.base_currency);
  const rate = await getExchangeRate(client, context, company.id, receiptCurrency, company.base_currency, accountingDate, input.exchangeRate);
  const precision = await getCurrencyPrecision(client, context, receiptCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, company.base_currency);
  const amount = roundMoney(positiveAmount(input.amount, "Receipt amount"), precision);
  const baseAmount = toBaseAmount(amount, rate, basePrecision);
  const receiptNumber = await allocateNumber(client, context.organizationId, "customer_receipt");
  const result = await client.query(`INSERT INTO tenant.accounting_customer_receipts (organization_id,company_id,branch_id,ledger_id,receipt_number,party_id,bank_account_id,receipt_date,accounting_date,currency_code,functional_currency_code,exchange_rate,amount,base_amount,unapplied_amount,payment_method,external_reference,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13,$15,$16,'draft',$17,$17) RETURNING *`, [context.organizationId, company.id, branch?.id || null, ledger.id, receiptNumber, party.id, optionalUuid(input.bankAccountId, "Bank account"), receiptDate, accountingDate, receiptCurrency, company.base_currency, asDatabaseDecimal(rate), asDatabaseDecimal(amount), asDatabaseDecimal(baseAmount), ["cash","bank_transfer","card","upi","cheque","gateway","other"].includes(input.paymentMethod) ? input.paymentMethod : "bank_transfer", text(input.externalReference, 200) || null, context.userId]);
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
  const bank = await bankJournal(client, context, receipt.company_id, receipt.ledger_id, receipt.bank_account_id);
  const receivable = await getAccountMapping(client, context, receipt.company_id, receipt.ledger_id, "receivable", { partyId: receipt.party_id, date: receipt.accounting_date, branchId: receipt.branch_id });
  const journal = await createJournalEntry(client, context, {
    companyId: receipt.company_id, branchId: receipt.branch_id, ledgerId: receipt.ledger_id, journalId: bank.journal_id,
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
        WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND ledger_id=$4 AND party_id=$5 FOR UPDATE`,
      [context.organizationId, invoiceId, receipt.company_id, receipt.ledger_id, receipt.party_id],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice || !["posted", "partially_paid", "overdue", "disputed"].includes(invoice.status)) {
      throw new AccountingError(409, "An allocation invoice is unavailable or not open in the receipt company ledger.");
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
      companyId: receipt.company_id,
      branchId: receipt.branch_id,
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
        WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND ledger_id=$4 AND party_id=$5 FOR UPDATE`,
      [context.organizationId, invoiceId, credit.company_id, credit.ledger_id, credit.party_id],
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
