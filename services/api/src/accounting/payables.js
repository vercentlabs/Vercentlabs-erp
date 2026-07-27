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
import { sub } from "./money.js";
import { recordDocumentTaxLedger } from "./tax.js";
import { resolvePaymentSchedule } from "./schedules.js";
import { createVendorSettlementAdjustment } from "./settlements.js";

async function purchaseJournal(client, context, companyId, ledgerId) {
  const result = await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='purchase' AND status='active' ORDER BY created_at LIMIT 1`, [context.organizationId, companyId, ledgerId]);
  if (!result.rows[0]) throw new AccountingError(409, "A Purchase accounting journal is not configured.");
  return result.rows[0].id;
}

async function paymentJournal(client, context, companyId, ledgerId, bankAccountId = null) {
  if (bankAccountId) {
    const result = await client.query(`SELECT bank.gl_account_id,journal.id AS journal_id FROM tenant.accounting_bank_accounts bank LEFT JOIN tenant.accounting_journals journal ON journal.organization_id=bank.organization_id AND journal.company_id=bank.company_id AND journal.ledger_id=bank.ledger_id AND journal.journal_type='bank' AND journal.status='active' WHERE bank.organization_id=$1 AND bank.company_id=$2 AND bank.ledger_id=$3 AND bank.id=$4 AND bank.status='active' ORDER BY journal.created_at LIMIT 1`, [context.organizationId, companyId, ledgerId, uuid(bankAccountId, "Bank account")]);
    if (!result.rows[0]?.journal_id) throw new AccountingError(409, "The selected bank account has no active bank journal.");
    return result.rows[0];
  }
  const journal = await client.query(`SELECT id AS journal_id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='bank' AND status='active' ORDER BY created_at LIMIT 1`, [context.organizationId, companyId, ledgerId]);
  const bank = await getAccountMapping(client, context, companyId, ledgerId, "bank", {});
  if (!journal.rows[0]) throw new AccountingError(409, "A bank journal is not configured.");
  return { journal_id: journal.rows[0].journal_id, gl_account_id: bank.account_id };
}

async function reduceBillSchedules(client, context, billId, amountValue, scheduleId = null) {
  let remaining = decimal(amountValue);
  const values = [context.organizationId, billId];
  let scheduleFilter = "";
  if (scheduleId) { values.push(scheduleId); scheduleFilter = ` AND id=$${values.length}`; }
  const schedules = await client.query(
    `SELECT * FROM tenant.accounting_vendor_bill_schedules
      WHERE organization_id=$1 AND vendor_bill_id=$2 AND outstanding_amount>0${scheduleFilter}
      ORDER BY due_date,sequence FOR UPDATE`,
    values,
  );
  for (const schedule of schedules.rows) {
    if (remaining <= 0n) break;
    const outstanding = decimal(schedule.outstanding_amount);
    const applied = remaining < outstanding ? remaining : outstanding;
    const scheduleRemaining = outstanding - applied;
    await client.query(
      `UPDATE tenant.accounting_vendor_bill_schedules
        SET outstanding_amount=$3,status=$4 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, schedule.id, asDatabaseDecimal(scheduleRemaining),
        scheduleRemaining === 0n ? "paid" : "partially_paid"],
    );
    remaining -= applied;
  }
  if (remaining !== 0n) throw new AccountingError(409, "Bill schedules do not reconcile to the requested allocation.");
}

function reversePostingLines(lines) {
  return lines.map((line) => ({ ...line, debit: line.credit || 0, credit: line.debit || 0 }));
}

async function normalizeBillLines(client, context, company, ledger, billDate, lines, billCurrency, exchangeRate) {
  if (!Array.isArray(lines) || !lines.length) throw new AccountingError(400, "At least one supplier bill line is required.");
  const precision = await getCurrencyPrecision(client, context, billCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, company.base_currency);
  let subtotal = 0n; let discountTotal = 0n; let taxTotal = 0n; let withholdingTotal = 0n; let grandTotal = 0n;
  const normalized = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const quantity = positiveAmount(line.quantity || 1, `Line ${index + 1} quantity`);
    const unitPrice = positiveAmount(line.unitPrice, `Line ${index + 1} unit price`);
    const gross = roundMoney(mul(quantity, unitPrice), precision);
    const discount = roundMoney(decimal(line.discountAmount || 0), precision);
    const tax = roundMoney(decimal(line.taxAmount || 0), precision);
    const withholding = roundMoney(decimal(line.withholdingAmount || 0), precision);
    if (discount < 0n || discount > gross || tax < 0n || withholding < 0n) throw new AccountingError(400, `Line ${index + 1} amounts are invalid.`);
    const net = sub(gross, discount);
    const total = net + tax - withholding;
    if (total <= 0n) throw new AccountingError(400, `Line ${index + 1} total must be positive.`);
    const expense = line.accountId ? { account_id: uuid(line.accountId, "Expense account") } : await getAccountMapping(client, context, company.id, ledger.id, "expense", { itemId: line.itemId || null, date: billDate, branchId: line.branchId || null });
    const taxAccount = tax > 0n ? (line.taxAccountId ? { account_id: uuid(line.taxAccountId, "Input tax account") } : await getAccountMapping(client, context, company.id, ledger.id, "input_tax", { date: billDate })) : null;
    const withholdingAccount = withholding > 0n ? (line.withholdingAccountId ? { account_id: uuid(line.withholdingAccountId, "Withholding account") } : await getAccountMapping(client, context, company.id, ledger.id, "withholding_tax", { date: billDate })) : null;
    subtotal += gross; discountTotal += discount; taxTotal += tax; withholdingTotal += withholding; grandTotal += total;
    normalized.push({ sequence: index + 1, itemId: optionalUuid(line.itemId, "Item"), description: requiredText(line.description, `Line ${index + 1} description`, 1000), hsnSacCode: text(line.hsnSacCode, 30) || null, quantity, uomId: optionalUuid(line.uomId, "Unit of measure"), unitPrice, discount, net, tax, withholding, total, expenseAccountId: expense.account_id, taxAccountId: taxAccount?.account_id || null, withholdingAccountId: withholdingAccount?.account_id || null, taxDetails: Array.isArray(line.taxDetails) ? line.taxDetails : [], branchId: optionalUuid(line.branchId, "Branch"), departmentId: optionalUuid(line.departmentId, "Department"), costCenterId: optionalUuid(line.costCenterId, "Cost centre") });
  }
  return { lines: normalized, subtotal, discountTotal, taxTotal, withholdingTotal, grandTotal, baseTotal: toBaseAmount(grandTotal, exchangeRate, basePrecision), precision, basePrecision };
}

export async function createVendorBill(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const company = await loadCompany(client, context, input.companyId);
  const branch = await validateBranch(client, context, company.id, input.branchId || context.activeBranchId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const supplier = await ensureParty(client, context, company.id, input.partyId, ["supplier", "both"]);
  const billDate = isoDate(input.billDate || new Date().toISOString().slice(0, 10), "Bill date");
  const accountingDate = isoDate(input.accountingDate || billDate, "Accounting date");
  const explicitDueDate = input.dueDate ? isoDate(input.dueDate, "Due date") : null;
  const billCurrency = currency(input.currencyCode || supplier.currency_code || company.base_currency);
  const rate = await getExchangeRate(client, context, company.id, billCurrency, company.base_currency, accountingDate, input.exchangeRate);
  const totals = await normalizeBillLines(client, context, company, ledger, billDate, input.lines, billCurrency, rate);
  const chargeTotal = roundMoney(decimal(input.chargeTotal || 0), totals.precision);
  const roundingAdjustment = roundMoney(decimal(input.roundingAdjustment || 0), totals.precision);
  if (chargeTotal < 0n) throw new AccountingError(400, "Bill charges cannot be negative.");
  const grandTotal = totals.grandTotal + chargeTotal + roundingAdjustment;
  if (grandTotal <= 0n) throw new AccountingError(400, "Bill grand total must be positive.");
  const baseTotal = toBaseAmount(grandTotal, rate, totals.basePrecision);
  const paymentSchedule = await resolvePaymentSchedule(client, context, {
    documentDate: billDate, explicitDueDate, paymentTermId: input.paymentTermId,
    partyPaymentTermId: supplier.payment_term_id, snapshot: input.paymentTermSnapshot,
    total: grandTotal, precision: totals.precision,
  });
  const dueDate = paymentSchedule.dueDate;
  const billType = ["bill", "credit_note", "debit_note", "opening"].includes(input.billType) ? input.billType : "bill";
  const sourceBillId = optionalUuid(input.sourceBillId, "Source bill");
  if (sourceBillId) {
    const source = await client.query(
      `SELECT id,bill_type,currency_code FROM tenant.accounting_vendor_bills
       WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND ledger_id=$4 AND party_id=$5`,
      [context.organizationId, sourceBillId, company.id, ledger.id, supplier.id],
    );
    if (!source.rows[0]) throw new AccountingError(409, "The source vendor document does not belong to this company, ledger and supplier.");
    if (source.rows[0].currency_code !== billCurrency) throw new AccountingError(409, "The source vendor document currency must match.");
    if (billType === "credit_note" && source.rows[0].bill_type === "credit_note") throw new AccountingError(409, "A vendor credit note cannot be credited again.");
  }
  const entityType = billType === "credit_note" ? "vendor_credit_note" : "vendor_bill";
  const billNumber = await allocateNumber(client, context.organizationId, entityType);
  const result = await client.query(`INSERT INTO tenant.accounting_vendor_bills (organization_id,company_id,branch_id,ledger_id,bill_number,supplier_invoice_number,bill_type,party_id,source_purchase_order_id,source_goods_receipt_id,source_bill_id,bill_date,accounting_date,due_date,currency_code,functional_currency_code,exchange_rate,supplier_snapshot,payment_term_snapshot,subtotal,discount_total,charge_total,tax_total,withholding_total,rounding_adjustment,grand_total,base_currency_total,outstanding_amount,matching_status,status,notes,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27,$26,$28,'draft',$29,$30,$30) RETURNING *`, [context.organizationId, company.id, branch?.id || null, ledger.id, billNumber, text(input.supplierInvoiceNumber, 100) || null, billType, supplier.id, optionalUuid(input.sourcePurchaseOrderId, "Purchase order"), optionalUuid(input.sourceGoodsReceiptId, "Goods receipt"), sourceBillId, billDate, accountingDate, dueDate, billCurrency, company.base_currency, asDatabaseDecimal(rate), JSON.stringify(input.supplierSnapshot || { id: supplier.id, code: supplier.code, displayName: supplier.display_name, legalName: supplier.legal_name, gstin: supplier.gstin, pan: supplier.pan }), JSON.stringify(paymentSchedule.snapshot), asDatabaseDecimal(totals.subtotal), asDatabaseDecimal(totals.discountTotal), asDatabaseDecimal(chargeTotal), asDatabaseDecimal(totals.taxTotal), asDatabaseDecimal(totals.withholdingTotal), asDatabaseDecimal(roundingAdjustment), asDatabaseDecimal(grandTotal), asDatabaseDecimal(baseTotal), input.matchingStatus && ["not_required","pending","matched","exception","overridden"].includes(input.matchingStatus) ? input.matchingStatus : "not_required", text(input.notes, 2000) || null, context.userId]);
  const bill = result.rows[0];
  for (const line of totals.lines) await client.query(`INSERT INTO tenant.accounting_vendor_bill_lines (organization_id,vendor_bill_id,sequence,item_id,description,hsn_sac_code,quantity,uom_id,unit_price,discount_amount,net_amount,tax_amount,withholding_amount,line_total,expense_account_id,tax_account_id,withholding_account_id,tax_details,branch_id,department_id,cost_center_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22)`, [context.organizationId, bill.id, line.sequence, line.itemId, line.description, line.hsnSacCode, asDatabaseDecimal(line.quantity), line.uomId, asDatabaseDecimal(line.unitPrice), asDatabaseDecimal(line.discount), asDatabaseDecimal(line.net), asDatabaseDecimal(line.tax), asDatabaseDecimal(line.withholding), asDatabaseDecimal(line.total), line.expenseAccountId, line.taxAccountId, line.withholdingAccountId, JSON.stringify(line.taxDetails), line.branchId, line.departmentId, line.costCenterId, context.userId]);
  for (const installment of paymentSchedule.installments) {
    await client.query(
      `INSERT INTO tenant.accounting_vendor_bill_schedules
        (organization_id,vendor_bill_id,sequence,due_date,amount,outstanding_amount)
       VALUES ($1,$2,$3,$4,$5,$5)`,
      [context.organizationId, bill.id, installment.sequence, installment.dueDate, asDatabaseDecimal(installment.amount)],
    );
  }
  await event(client, context, "vendor_bill", bill.id, "accounting.vendor_bill.created", null, "draft", { billNumber });
  return getVendorBill(client, context, bill.id);
}

export async function listVendorBills(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId]; let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); where += ` AND bill.company_id=$${values.length}`; }
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 30)); where += ` AND bill.status=$${values.length}`; }
  if (filters.partyId) { values.push(uuid(filters.partyId, "Supplier")); where += ` AND bill.party_id=$${values.length}`; }
  if (filters.search) { values.push(`%${text(filters.search, 100)}%`); where += ` AND (bill.bill_number ILIKE $${values.length} OR bill.supplier_invoice_number ILIKE $${values.length} OR party.display_name ILIKE $${values.length})`; }
  const result = await client.query(`SELECT bill.id,bill.bill_number,bill.supplier_invoice_number,bill.bill_type,bill.bill_date,bill.due_date,bill.currency_code,bill.grand_total,bill.outstanding_amount,bill.matching_status,bill.status,party.display_name AS supplier_name,company.name AS company_name FROM tenant.accounting_vendor_bills bill JOIN tenant.business_parties party ON party.id=bill.party_id JOIN public.companies company ON company.id=bill.company_id WHERE bill.organization_id=$1${where} ORDER BY bill.bill_date DESC,bill.created_at DESC LIMIT 300`, values);
  return result.rows;
}

export async function getVendorBill(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(idValue, "Vendor bill");
  const result = await client.query(`SELECT bill.*,party.display_name AS supplier_name,company.name AS company_name FROM tenant.accounting_vendor_bills bill JOIN tenant.business_parties party ON party.id=bill.party_id JOIN public.companies company ON company.id=bill.company_id WHERE bill.organization_id=$1 AND bill.id=$2`, [context.organizationId, id]);
  const bill = result.rows[0];
  if (!bill) throw new AccountingError(404, "Vendor bill not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && bill.company_id !== context.activeCompanyId) throw new AccountingError(403, "Switch to the bill company to view it.");
  const [lines, schedules, allocations, creditAllocations, creditCandidates, events] = await Promise.all([
    client.query(`SELECT line.*,account.code AS expense_account_code,account.name AS expense_account_name FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_accounts account ON account.id=line.expense_account_id WHERE line.organization_id=$1 AND line.vendor_bill_id=$2 ORDER BY line.sequence`, [context.organizationId, id]),
    client.query(`SELECT * FROM tenant.accounting_vendor_bill_schedules WHERE organization_id=$1 AND vendor_bill_id=$2 ORDER BY sequence`, [context.organizationId, id]),
    client.query(`SELECT allocation.*,payment.payment_number,payment.payment_date FROM tenant.accounting_vendor_payment_allocations allocation JOIN tenant.accounting_vendor_payments payment ON payment.id=allocation.payment_id WHERE allocation.organization_id=$1 AND allocation.vendor_bill_id=$2 ORDER BY allocation.allocated_at DESC`, [context.organizationId, id]),
    client.query(`SELECT allocation.*,credit.bill_number AS credit_note_number,target.bill_number AS target_bill_number
      FROM tenant.accounting_vendor_credit_allocations allocation
      JOIN tenant.accounting_vendor_bills credit ON credit.id=allocation.credit_note_id
      JOIN tenant.accounting_vendor_bills target ON target.id=allocation.vendor_bill_id
      WHERE allocation.organization_id=$1 AND (allocation.credit_note_id=$2 OR allocation.vendor_bill_id=$2)
      ORDER BY allocation.allocated_at DESC`, [context.organizationId, id]),
    bill.bill_type === "credit_note"
      ? client.query(`SELECT id,bill_number,bill_date,due_date,currency_code,outstanding_amount
          FROM tenant.accounting_vendor_bills
          WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND party_id=$4
            AND bill_type IN ('bill','debit_note','opening')
            AND status IN ('posted','partially_paid','overdue','disputed') AND outstanding_amount>0
          ORDER BY due_date,bill_date`, [context.organizationId, bill.company_id, bill.ledger_id, bill.party_id])
      : Promise.resolve({ rows: [] }),
    client.query(`SELECT * FROM tenant.accounting_events WHERE organization_id=$1 AND entity_type='vendor_bill' AND entity_id=$2 ORDER BY occurred_at DESC`, [context.organizationId, id]),
  ]);
  return { bill, lines: lines.rows, schedules: schedules.rows, allocations: allocations.rows,
    creditAllocations: creditAllocations.rows, creditCandidates: creditCandidates.rows, events: events.rows };
}

export async function postVendorBill(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const id = uuid(idValue, "Vendor bill");
  const result = await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  const bill = result.rows[0];
  if (!bill) throw new AccountingError(404, "Vendor bill not found.");
  if (['posted','partially_paid','paid'].includes(bill.status)) return getVendorBill(client, context, id);
  if (bill.status !== 'approved') throw new AccountingError(409, "Vendor bill must be approved before posting.");
  if (bill.matching_status === 'exception') throw new AccountingError(409, "Resolve or override the matching exception before posting.");
  const detail = await getVendorBill(client, context, id);
  const payable = await getAccountMapping(client, context, bill.company_id, bill.ledger_id, "payable", { partyId: bill.party_id, date: bill.accounting_date, branchId: bill.branch_id });
  const journalId = await purchaseJournal(client, context, bill.company_id, bill.ledger_id);
  const isCreditNote = bill.bill_type === "credit_note";
  let lines = [];
  for (const line of detail.lines) {
    if (decimal(line.net_amount) > 0n) lines.push({ accountId: line.expense_account_id, partyId: bill.party_id, branchId: line.branch_id || bill.branch_id, departmentId: line.department_id, costCenterId: line.cost_center_id, description: line.description, debit: line.net_amount, credit: 0, referenceType: "vendor_bill", referenceId: bill.id });
    if (decimal(line.tax_amount) > 0n && line.tax_account_id) lines.push({ accountId: line.tax_account_id, partyId: bill.party_id, branchId: line.branch_id || bill.branch_id, description: `Input tax ${line.description}`, debit: line.tax_amount, credit: 0, referenceType: "vendor_bill", referenceId: bill.id, taxBaseAmount: line.net_amount });
    if (decimal(line.withholding_amount) > 0n && line.withholding_account_id) lines.push({ accountId: line.withholding_account_id, partyId: bill.party_id, description: `Withholding ${line.description}`, debit: 0, credit: line.withholding_amount, referenceType: "vendor_bill", referenceId: bill.id });
  }
  if (decimal(bill.charge_total) > 0n) {
    const chargeAccount = await getAccountMapping(client, context, bill.company_id, bill.ledger_id, "expense", { partyId: bill.party_id, date: bill.accounting_date, branchId: bill.branch_id });
    lines.push({ accountId: chargeAccount.account_id, partyId: bill.party_id, branchId: bill.branch_id, description: `Bill charges ${bill.bill_number}`, debit: bill.charge_total, credit: 0, referenceType: "vendor_bill", referenceId: bill.id });
  }
  if (decimal(bill.rounding_adjustment) !== 0n) {
    const rounding = await getAccountMapping(client, context, bill.company_id, bill.ledger_id, "rounding", { date: bill.accounting_date });
    const amount = decimal(bill.rounding_adjustment);
    lines.push({ accountId: rounding.account_id, description: `Rounding ${bill.bill_number}`, debit: amount > 0n ? asDatabaseDecimal(amount) : 0, credit: amount < 0n ? asDatabaseDecimal(-amount) : 0, referenceType: "vendor_bill", referenceId: bill.id });
  }
  lines.push({ accountId: payable.account_id, partyId: bill.party_id, branchId: bill.branch_id, description: `Payable ${bill.bill_number}`, debit: 0, credit: bill.grand_total, dueDate: bill.due_date, referenceType: "vendor_bill", referenceId: bill.id });
  if (isCreditNote) lines = reversePostingLines(lines);
  const commercialTotal = lines.slice(0, -1).reduce((total, line) => total
    + (isCreditNote ? decimal(line.credit || 0) - decimal(line.debit || 0) : decimal(line.debit || 0) - decimal(line.credit || 0)), 0n);
  if (commercialTotal !== decimal(bill.grand_total)) {
    throw new AccountingError(409, "Vendor bill posting does not reconcile to the document grand total.");
  }
  const sourceType = isCreditNote ? "vendor_credit_note" : "vendor_bill";
  const journal = await createJournalEntry(client, context, { companyId: bill.company_id, branchId: bill.branch_id, ledgerId: bill.ledger_id, journalId, entryDate: bill.bill_date, accountingDate: bill.accounting_date, documentDate: bill.bill_date, entryType: "subledger", reference: bill.supplier_invoice_number || bill.bill_number, description: `Vendor bill ${bill.bill_number}`, currencyCode: bill.currency_code, exchangeRate: bill.exchange_rate, lines }, { internal: true, sourceModule: "accounting", sourceType, sourceId: bill.id, sourceNumber: bill.bill_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  await recordDocumentTaxLedger(client, context, bill, detail.lines, journal.entry.id, "input");
  await client.query(`UPDATE tenant.accounting_vendor_bills SET status='posted',journal_entry_id=$3,outstanding_amount=grand_total,posted_at=now(),posted_by=$4,updated_by=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, journal.entry.id, context.userId]);
  await event(client, context, "vendor_bill", id, "accounting.vendor_bill.posted", bill.status, "posted", { journalEntryId: journal.entry.id });
  return getVendorBill(client, context, id);
}

export async function createVendorPayment(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const company = await loadCompany(client, context, input.companyId);
  const branch = await validateBranch(client, context, company.id, input.branchId || context.activeBranchId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const supplier = await ensureParty(client, context, company.id, input.partyId, ["supplier", "both"]);
  const paymentDate = isoDate(input.paymentDate || new Date().toISOString().slice(0, 10), "Payment date");
  const accountingDate = isoDate(input.accountingDate || paymentDate, "Accounting date");
  const paymentCurrency = currency(input.currencyCode || supplier.currency_code || company.base_currency);
  const rate = await getExchangeRate(client, context, company.id, paymentCurrency, company.base_currency, accountingDate, input.exchangeRate);
  const precision = await getCurrencyPrecision(client, context, paymentCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, company.base_currency);
  const amount = roundMoney(positiveAmount(input.amount, "Payment amount"), precision);
  const baseAmount = toBaseAmount(amount, rate, basePrecision);
  const paymentNumber = await allocateNumber(client, context.organizationId, "vendor_payment");
  const result = await client.query(`INSERT INTO tenant.accounting_vendor_payments (organization_id,company_id,branch_id,ledger_id,payment_number,party_id,bank_account_id,payment_date,accounting_date,currency_code,functional_currency_code,exchange_rate,amount,base_amount,unapplied_amount,payment_method,external_reference,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13,$15,$16,'draft',$17,$17) RETURNING *`, [context.organizationId, company.id, branch?.id || null, ledger.id, paymentNumber, supplier.id, optionalUuid(input.bankAccountId, "Bank account"), paymentDate, accountingDate, paymentCurrency, company.base_currency, asDatabaseDecimal(rate), asDatabaseDecimal(amount), asDatabaseDecimal(baseAmount), ["cash","bank_transfer","card","upi","cheque","gateway","other"].includes(input.paymentMethod) ? input.paymentMethod : "bank_transfer", text(input.externalReference, 200) || null, context.userId]);
  await event(client, context, "vendor_payment", result.rows[0].id, "accounting.vendor_payment.created", null, "draft", { paymentNumber });
  return result.rows[0];
}

export async function postVendorPayment(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const id = uuid(idValue, "Vendor payment");
  const result = await client.query(`SELECT * FROM tenant.accounting_vendor_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  const payment = result.rows[0];
  if (!payment) throw new AccountingError(404, "Vendor payment not found.");
  if (payment.status !== "approved") {
    if (["posted", "partially_applied", "applied"].includes(payment.status)) return payment;
    throw new AccountingError(409, "Vendor payment must be approved before posting.");
  }
  const bank = await paymentJournal(client, context, payment.company_id, payment.ledger_id, payment.bank_account_id);
  const payable = await getAccountMapping(client, context, payment.company_id, payment.ledger_id, "payable", { partyId: payment.party_id, date: payment.accounting_date, branchId: payment.branch_id });
  const journal = await createJournalEntry(client, context, { companyId: payment.company_id, branchId: payment.branch_id, ledgerId: payment.ledger_id, journalId: bank.journal_id, entryDate: payment.payment_date, accountingDate: payment.accounting_date, entryType: "subledger", reference: payment.external_reference || payment.payment_number, description: `Vendor payment ${payment.payment_number}`, currencyCode: payment.currency_code, exchangeRate: payment.exchange_rate, lines: [
    { accountId: payable.account_id, partyId: payment.party_id, description: `Supplier payment ${payment.payment_number}`, debit: payment.amount, credit: 0, referenceType: "vendor_payment", referenceId: payment.id },
    { accountId: bank.gl_account_id, description: `Bank payment ${payment.payment_number}`, debit: 0, credit: payment.amount, referenceType: "vendor_payment", referenceId: payment.id },
  ] }, { internal: true, sourceModule: "accounting", sourceType: "vendor_payment", sourceId: payment.id, sourceNumber: payment.payment_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  const updated = await client.query(`UPDATE tenant.accounting_vendor_payments SET status='posted',journal_entry_id=$3,posted_at=now(),posted_by=$4,updated_by=$4 WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, id, journal.entry.id, context.userId]);
  await event(client, context, "vendor_payment", id, "accounting.vendor_payment.posted", payment.status, "posted", { journalEntryId: journal.entry.id });
  return updated.rows[0];
}

export async function allocateVendorPayment(client, context, paymentIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const paymentId = uuid(paymentIdValue, "Vendor payment");
  const paymentResult = await client.query(
    `SELECT * FROM tenant.accounting_vendor_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, paymentId],
  );
  const payment = paymentResult.rows[0];
  if (!payment || !["posted", "partially_applied"].includes(payment.status)) {
    throw new AccountingError(409, "Payment must be posted before allocation.");
  }
  if (!Array.isArray(input.allocations) || !input.allocations.length) {
    throw new AccountingError(400, "At least one bill allocation is required.");
  }
  let totalPaymentAmount = 0n;
  let totalBillSettlement = 0n;
  for (const allocation of input.allocations) {
    const billId = uuid(allocation.billId, "Vendor bill");
    const billResult = await client.query(
      `SELECT * FROM tenant.accounting_vendor_bills
        WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND ledger_id=$4 AND party_id=$5 FOR UPDATE`,
      [context.organizationId, billId, payment.company_id, payment.ledger_id, payment.party_id],
    );
    const bill = billResult.rows[0];
    if (!bill || !["posted", "partially_paid", "overdue", "disputed"].includes(bill.status)) {
      throw new AccountingError(409, "An allocation bill is unavailable or not open in the payment company ledger.");
    }
    const paymentAmount = positiveAmount(allocation.paymentAmount ?? allocation.amount, "Payment allocation amount");
    const billAmount = positiveAmount(allocation.billAmount ?? allocation.amount, "Bill allocation amount");
    const precision = await getCurrencyPrecision(client, context, bill.currency_code);
    const discountTaken = roundMoney(decimal(allocation.discountTaken || 0), precision);
    const writeoffAmount = roundMoney(decimal(allocation.writeoffAmount || 0), precision);
    if (discountTaken < 0n || writeoffAmount < 0n) throw new AccountingError(400, "Discount and write-off amounts cannot be negative.");
    const billSettlement = billAmount + discountTaken + writeoffAmount;
    if (billSettlement > decimal(bill.outstanding_amount)) {
      throw new AccountingError(409, `Allocation exceeds ${bill.bill_number} outstanding amount.`);
    }
    totalPaymentAmount += paymentAmount;
    totalBillSettlement += billSettlement;
    if (totalPaymentAmount > decimal(payment.unapplied_amount)) {
      throw new AccountingError(409, "Allocations exceed the unapplied payment amount.");
    }
    const scheduleId = optionalUuid(allocation.scheduleId, "Payment schedule");
    if (scheduleId) {
      const schedule = await client.query(
        `SELECT id,outstanding_amount FROM tenant.accounting_vendor_bill_schedules
          WHERE organization_id=$1 AND id=$2 AND vendor_bill_id=$3 AND outstanding_amount>0 FOR UPDATE`,
        [context.organizationId, scheduleId, bill.id],
      );
      if (!schedule.rows[0] || billSettlement > decimal(schedule.rows[0].outstanding_amount)) {
        throw new AccountingError(409, "The selected bill installment is unavailable or smaller than the settlement.");
      }
    }
    const duplicate = await client.query(
      `SELECT id FROM tenant.accounting_vendor_payment_allocations
        WHERE organization_id=$1 AND payment_id=$2 AND vendor_bill_id=$3
          AND COALESCE(schedule_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`,
      [context.organizationId, payment.id, bill.id, scheduleId],
    );
    if (duplicate.rows[0]) throw new AccountingError(409, "This payment has already been allocated to the selected bill installment.");
    const allocationId = randomUUID();
    const adjustment = await createVendorSettlementAdjustment(client, context, {
      allocationId,
      companyId: payment.company_id,
      branchId: payment.branch_id,
      ledgerId: payment.ledger_id,
      partyId: payment.party_id,
      accountingDate: payment.accounting_date,
      reference: `${payment.payment_number}/${bill.bill_number}`,
      sourceAmount: paymentAmount,
      sourceExchangeRate: payment.exchange_rate,
      documentAmount: billAmount,
      documentExchangeRate: bill.exchange_rate,
      adjustmentAmount: discountTaken + writeoffAmount,
    });
    await client.query(
      `INSERT INTO tenant.accounting_vendor_payment_allocations (
        id,organization_id,payment_id,vendor_bill_id,schedule_id,allocated_amount,
        payment_amount,bill_amount,base_payment_amount,base_bill_amount,
        realized_gain_loss,discount_taken,writeoff_amount,adjustment_journal_entry_id,created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [allocationId, context.organizationId, payment.id, bill.id, scheduleId,
        asDatabaseDecimal(billSettlement), asDatabaseDecimal(paymentAmount), asDatabaseDecimal(billAmount),
        asDatabaseDecimal(adjustment.baseSourceAmount), asDatabaseDecimal(adjustment.baseDocumentAmount),
        adjustment.realizedGainLoss, asDatabaseDecimal(discountTaken), asDatabaseDecimal(writeoffAmount),
        adjustment.journalEntryId, context.userId],
    );
    await reduceBillSchedules(client, context, bill.id, billSettlement, scheduleId);
    const remaining = decimal(bill.outstanding_amount) - billSettlement;
    const status = remaining === 0n ? "paid" : "partially_paid";
    await client.query(
      `UPDATE tenant.accounting_vendor_bills SET outstanding_amount=$3,status=$4,updated_by=$5
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, bill.id, asDatabaseDecimal(remaining), status, context.userId],
    );
    await event(client, context, "vendor_bill", bill.id, "accounting.vendor_bill.settled", bill.status, status, {
      paymentId: payment.id,
      paymentAmount: asDatabaseDecimal(paymentAmount),
      billAmount: asDatabaseDecimal(billAmount),
      discountTaken: asDatabaseDecimal(discountTaken),
      writeoffAmount: asDatabaseDecimal(writeoffAmount),
      realizedGainLoss: adjustment.realizedGainLoss,
      adjustmentJournalEntryId: adjustment.journalEntryId,
    });
  }
  const paymentRemaining = decimal(payment.unapplied_amount) - totalPaymentAmount;
  const paymentStatus = paymentRemaining === 0n ? "applied" : "partially_applied";
  const updated = await client.query(
    `UPDATE tenant.accounting_vendor_payments SET unapplied_amount=$3,status=$4,updated_by=$5
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, payment.id, asDatabaseDecimal(paymentRemaining), paymentStatus, context.userId],
  );
  await event(client, context, "vendor_payment", payment.id, "accounting.vendor_payment.allocated", payment.status, paymentStatus, {
    paymentAmount: asDatabaseDecimal(totalPaymentAmount),
    billSettlementAmount: asDatabaseDecimal(totalBillSettlement),
  });
  return updated.rows[0];
}

export async function applyVendorCreditNote(client, context, creditNoteIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const creditNoteId = uuid(creditNoteIdValue, "Vendor credit note");
  const creditResult = await client.query(
    `SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, creditNoteId],
  );
  const credit = creditResult.rows[0];
  if (!credit || credit.bill_type !== "credit_note") throw new AccountingError(404, "Vendor credit note not found.");
  if (!["posted", "partially_paid"].includes(credit.status) || decimal(credit.outstanding_amount) <= 0n) {
    throw new AccountingError(409, "Credit note must be posted and have an unapplied balance.");
  }
  if (!Array.isArray(input.allocations) || input.allocations.length < 1) {
    throw new AccountingError(400, "At least one bill allocation is required.");
  }
  let totalAllocated = 0n;
  for (const allocation of input.allocations) {
    const billId = uuid(allocation.billId, "Vendor bill");
    const targetResult = await client.query(
      `SELECT * FROM tenant.accounting_vendor_bills
        WHERE organization_id=$1 AND id=$2 AND company_id=$3 AND ledger_id=$4 AND party_id=$5 FOR UPDATE`,
      [context.organizationId, billId, credit.company_id, credit.ledger_id, credit.party_id],
    );
    const target = targetResult.rows[0];
    if (!target || !["bill", "debit_note", "opening"].includes(target.bill_type)
      || !["posted", "partially_paid", "overdue", "disputed"].includes(target.status)) {
      throw new AccountingError(409, "A target bill is unavailable or not open.");
    }
    if (target.currency_code !== credit.currency_code) throw new AccountingError(409, "Credit and bill currencies must match.");
    const amount = positiveAmount(allocation.amount, "Credit allocation amount");
    if (amount > decimal(target.outstanding_amount)) throw new AccountingError(409, `Allocation exceeds ${target.bill_number} outstanding amount.`);
    totalAllocated += amount;
    if (totalAllocated > decimal(credit.outstanding_amount)) throw new AccountingError(409, "Allocations exceed the unapplied credit-note amount.");
    await client.query(
      `INSERT INTO tenant.accounting_vendor_credit_allocations
        (organization_id,credit_note_id,vendor_bill_id,allocated_amount,created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id,credit_note_id,vendor_bill_id)
       DO UPDATE SET allocated_amount=tenant.accounting_vendor_credit_allocations.allocated_amount+EXCLUDED.allocated_amount,
         allocated_at=now(),created_by=EXCLUDED.created_by`,
      [context.organizationId, credit.id, target.id, asDatabaseDecimal(amount), context.userId],
    );
    await reduceBillSchedules(client, context, target.id, amount);
    const targetRemaining = decimal(target.outstanding_amount) - amount;
    await client.query(
      `UPDATE tenant.accounting_vendor_bills SET outstanding_amount=$3,status=$4,updated_by=$5,updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, target.id, asDatabaseDecimal(targetRemaining), targetRemaining === 0n ? "paid" : "partially_paid", context.userId],
    );
    await event(client, context, "vendor_bill", target.id, "accounting.vendor_credit.applied", target.status,
      targetRemaining === 0n ? "paid" : "partially_paid", { creditNoteId: credit.id, amount: asDatabaseDecimal(amount) });
  }
  await reduceBillSchedules(client, context, credit.id, totalAllocated);
  const creditRemaining = decimal(credit.outstanding_amount) - totalAllocated;
  const creditStatus = creditRemaining === 0n ? "paid" : "partially_paid";
  await client.query(
    `UPDATE tenant.accounting_vendor_bills SET outstanding_amount=$3,status=$4,updated_by=$5,updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, credit.id, asDatabaseDecimal(creditRemaining), creditStatus, context.userId],
  );
  await event(client, context, "vendor_bill", credit.id, "accounting.vendor_credit.allocated", credit.status,
    creditStatus, { allocatedAmount: asDatabaseDecimal(totalAllocated) });
  return getVendorBill(client, context, credit.id);
}
