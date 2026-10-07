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
import { sub } from "./money.js";
import { recordDocumentTaxLedger } from "./tax.js";
import { resolvePaymentSchedule, writeDocumentSchedule } from "./schedules.js";
import { createVendorSettlementAdjustment } from "./settlements.js";

async function purchaseJournal(client, context, ledgerId) {
  const result = await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND ledger_id=$2 AND journal_type='purchase' AND status='active' ORDER BY created_at LIMIT 1`, [context.organizationId, ledgerId]);
  if (!result.rows[0]) throw new AccountingError(409, "A Purchase accounting journal is not configured.");
  return result.rows[0].id;
}

async function paymentJournal(client, context, ledgerId, bankAccountId = null) {
  if (bankAccountId) {
    const result = await client.query(`SELECT bank.gl_account_id,journal.id AS journal_id FROM tenant.accounting_bank_accounts bank LEFT JOIN tenant.accounting_journals journal ON journal.organization_id=bank.organization_id AND journal.ledger_id=bank.ledger_id AND journal.journal_type='bank' AND journal.status='active' WHERE bank.organization_id=$1 AND bank.ledger_id=$2 AND bank.id=$3 AND bank.status='active' ORDER BY journal.created_at LIMIT 1`, [context.organizationId, ledgerId, uuid(bankAccountId, "Bank account")]);
    if (!result.rows[0]?.journal_id) throw new AccountingError(409, "The selected bank account has no active bank journal.");
    return result.rows[0];
  }
  const journal = await client.query(`SELECT id AS journal_id FROM tenant.accounting_journals WHERE organization_id=$1 AND ledger_id=$2 AND journal_type='bank' AND status='active' ORDER BY created_at LIMIT 1`, [context.organizationId, ledgerId]);
  const bank = await getAccountMapping(client, context, ledgerId, "bank", {});
  if (!journal.rows[0]) throw new AccountingError(409, "A bank journal is not configured.");
  return { journal_id: journal.rows[0].journal_id, gl_account_id: bank.account_id };
}

export async function reduceBillSchedules(client, context, billId, amountValue, scheduleId = null) {
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

// The amounts of each bill line, as the caller worked them out with the shared tax engine (price, discounts, tax components); Accounting checks
// they are consistent and that every line has its accounts. A line may carry a price variance (booked to its own account), reverse-charge tax
// (self-assessed, not owed to the supplier) and withholding (deducted from what the supplier is paid).
async function normalizeBillLines(client, context, organization, ledger, billDate, lines, billCurrency, exchangeRate) {
  if (!Array.isArray(lines) || !lines.length) throw new AccountingError(400, "At least one supplier bill line is required.");
  const precision = await getCurrencyPrecision(client, context, billCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, organization.base_currency);
  let subtotal = 0n; let discountTotal = 0n; let taxTotal = 0n; let withholdingTotal = 0n; let grandTotal = 0n; let reverseChargeTotal = 0n;
  const normalized = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const quantity = positiveAmount(line.quantity || 1, `Line ${index + 1} quantity`);
    const unitPrice = positiveAmount(line.unitPrice, `Line ${index + 1} unit price`);
    const gross = line.grossAmount !== undefined ? roundMoney(decimal(line.grossAmount), precision) : roundMoney(mul(quantity, unitPrice), precision);
    const discount = roundMoney(decimal(line.discountAmount || 0), precision);
    const tax = roundMoney(decimal(line.taxAmount || 0), precision);
    const withholding = roundMoney(decimal(line.withholdingAmount || 0), precision);
    const reverseChargeTax = roundMoney(decimal(line.reverseChargeTax || 0), precision);
    const variance = roundMoney(decimal(line.varianceAmount || 0), precision);
    if (discount < 0n || discount > gross || tax < 0n || withholding < 0n || reverseChargeTax < 0n) throw new AccountingError(400, `Line ${index + 1} amounts are invalid.`);
    const net = sub(gross, discount);
    if (line.netAmount !== undefined && roundMoney(decimal(line.netAmount), precision) !== net) throw new AccountingError(400, `Line ${index + 1}: the taxable value does not reconcile.`);
    const total = net + tax - withholding;
    if (total <= 0n) throw new AccountingError(400, `Line ${index + 1} total must be positive.`);
    const expense = line.accountId ? { account_id: uuid(line.accountId, "Expense account") } : await getAccountMapping(client, context, ledger.id, "expense", { itemId: line.itemId || null, date: billDate });
    const blocked = line.inputTaxEligibility === "blocked";
    // A blocked credit is part of the cost: the tax is booked to the line's own account, never to recoverable input tax.
    const taxAccount = tax > 0n ? (blocked ? { account_id: expense.account_id } : line.taxAccountId ? { account_id: uuid(line.taxAccountId, "Input tax account") } : await getAccountMapping(client, context, ledger.id, "input_tax", { date: billDate })) : null;
    const withholdingAccount = withholding > 0n ? (line.withholdingAccountId ? { account_id: uuid(line.withholdingAccountId, "Withholding account") } : await getAccountMapping(client, context, ledger.id, "withholding_tax", { date: billDate })) : null;
    const varianceAccountId = variance !== 0n ? uuid(line.varianceAccountId, `Line ${index + 1} price variance account`) : null;
    subtotal += gross; discountTotal += discount; taxTotal += tax; withholdingTotal += withholding; grandTotal += total; reverseChargeTotal += reverseChargeTax;
    normalized.push({
      sequence: index + 1, itemId: optionalUuid(line.itemId, "Item"), description: requiredText(line.description, `Line ${index + 1} description`, 1000), hsnSacCode: text(line.hsnSacCode, 30) || null,
      quantity, uomId: optionalUuid(line.uomId, "Unit of measure"), unitPrice, gross, discount, net, tax, withholding, total, expenseAccountId: expense.account_id,
      taxAccountId: taxAccount?.account_id || null, withholdingAccountId: withholdingAccount?.account_id || null, taxDetails: Array.isArray(line.taxDetails) ? line.taxDetails : [],
      departmentId: optionalUuid(line.departmentId, "Department"), costCenterId: optionalUuid(line.costCenterId, "Cost centre"),
      productType: text(line.productType, 30) || null, productSnapshot: line.productSnapshot ?? null, uomSnapshot: line.uomSnapshot ?? null, taxCategoryId: optionalUuid(line.taxCategoryId, "Tax category"),
      lineDiscountType: ["percent", "amount"].includes(line.lineDiscountType) ? line.lineDiscountType : null, lineDiscountValue: decimal(line.lineDiscountValue || 0),
      lineDiscountAmount: roundMoney(decimal(line.lineDiscountAmount ?? line.discountAmount ?? 0), precision), allocatedDocumentDiscount: roundMoney(decimal(line.allocatedDocumentDiscount || 0), precision),
      reverseCharge: Boolean(line.reverseCharge), reverseChargeTax, withholdingRate: decimal(line.withholdingRate || 0), varianceAccountId, variance,
      purchaseOrderLineId: optionalUuid(line.purchaseOrderLineId, "Purchase order line"), goodsReceiptLineId: optionalUuid(line.goodsReceiptLineId, "Goods receipt line"),
      orderedUnitPrice: line.orderedUnitPrice === undefined || line.orderedUnitPrice === null ? null : decimal(line.orderedUnitPrice),
      sourceBillLineId: optionalUuid(line.sourceBillLineId, "Source bill line"), adjustmentKind: ["quantity", "value"].includes(line.adjustmentKind) ? line.adjustmentKind : null,
      creditReason: text(line.creditReason, 60) || null, creditBasis: ["quantity", "amount"].includes(line.creditBasis) ? line.creditBasis : null,
      purchaseReturnLineId: optionalUuid(line.purchaseReturnLineId, "Purchase return line"),
      taxComponents: Array.isArray(line.taxComponents) ? line.taxComponents : [],
      inputTaxEligibility: blocked ? "blocked" : "eligible", expenseCategoryId: optionalUuid(line.expenseCategoryId, "Expense category"),
    });
  }
  return { lines: normalized, subtotal, discountTotal, taxTotal, withholdingTotal, grandTotal, reverseChargeTotal, baseTotal: toBaseAmount(grandTotal, exchangeRate, basePrecision), precision, basePrecision };
}

const d = (value) => (value === null || value === undefined ? null : asDatabaseDecimal(value));
async function writeBillLines(client, context, billId, lines) {
  for (const line of lines) {
    const row = (await client.query(
      `INSERT INTO tenant.accounting_vendor_bill_lines (organization_id,vendor_bill_id,sequence,item_id,description,hsn_sac_code,quantity,uom_id,unit_price,discount_amount,net_amount,tax_amount,
         withholding_amount,line_total,expense_account_id,tax_account_id,withholding_account_id,tax_details,department_id,cost_center_id,created_by,product_type,product_snapshot,uom_snapshot,
         tax_category_id,gross_amount,line_discount_type,line_discount_value,line_discount_amount,allocated_document_discount,reverse_charge,reverse_charge_tax,withholding_rate,
         variance_account_id,variance_amount,purchase_order_line_id,goods_receipt_line_id,ordered_unit_price,source_bill_line_id,adjustment_kind,input_tax_eligibility,expense_category_id,
         credit_reason,credit_basis,purchase_return_line_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45) RETURNING id`,
      [context.organizationId, billId, line.sequence, line.itemId, line.description, line.hsnSacCode, d(line.quantity), line.uomId, d(line.unitPrice), d(line.discount), d(line.net),
        d(line.tax), d(line.withholding), d(line.total), line.expenseAccountId, line.taxAccountId, line.withholdingAccountId, JSON.stringify(line.taxDetails), line.departmentId,
        line.costCenterId, context.userId, line.productType, line.productSnapshot ? JSON.stringify(line.productSnapshot) : null, line.uomSnapshot ? JSON.stringify(line.uomSnapshot) : null,
        line.taxCategoryId, d(line.gross), line.lineDiscountType, d(line.lineDiscountValue), d(line.lineDiscountAmount), d(line.allocatedDocumentDiscount), line.reverseCharge,
        d(line.reverseChargeTax), d(line.withholdingRate), line.varianceAccountId, d(line.variance), line.purchaseOrderLineId, line.goodsReceiptLineId, d(line.orderedUnitPrice),
        line.sourceBillLineId, line.adjustmentKind, line.inputTaxEligibility, line.expenseCategoryId, line.creditReason ?? null, line.creditBasis ?? null, line.purchaseReturnLineId ?? null])).rows[0];
    line.id = row.id;
    for (const component of line.taxComponents) {
      await client.query(
        `INSERT INTO tenant.supplier_bill_line_taxes (organization_id,vendor_bill_id,vendor_bill_line_id,tax_type,label,tax_rate,taxable_base,tax_amount,tax_classification) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [context.organizationId, billId, row.id, text(component.taxType, 30) || "other", text(component.label, 60) || "Tax", d(decimal(component.rate || 0)), d(decimal(component.taxableAmount || 0)),
          d(decimal(component.taxAmount || 0)), component.classification === "reverse_charge" ? "reverse_charge" : "input"]);
    }
  }
}

// The procurement fields a supplier bill carries beside Accounting's own (see migration 0049).
const HEADER_EXTRAS = [
  ["supplierInvoiceReference", "supplier_invoice_reference", (value) => text(value, 100) || null], ["supplierId", "supplier_id", (value) => optionalUuid(value, "Supplier")],
  ["sourceType", "source_type", (value) => (["purchase_order", "goods_receipt", "direct"].includes(value) ? value : null)],
  ["supplierTaxRegistrationId", "supplier_tax_registration_id", (value) => optionalUuid(value, "Supplier registration")],
  ["supplierTaxSnapshot", "supplier_tax_snapshot", (value) => (value ? JSON.stringify(value) : null), "::jsonb"],
  ["supplierAddressSnapshot", "supplier_address_snapshot", (value) => (value ? JSON.stringify(value) : null), "::jsonb"],
  ["buyingRegistrationId", "buying_registration_id", (value) => optionalUuid(value, "Company registration")],
  ["buyingRegistrationSnapshot", "buying_registration_snapshot", (value) => (value ? JSON.stringify(value) : null), "::jsonb"],
  ["placeOfSupply", "place_of_supply", (value) => text(value, 10) || null], ["supplyNature", "supply_nature", (value) => text(value, 30) || null],
  ["reverseCharge", "reverse_charge", (value) => Boolean(value)], ["priceMode", "price_mode", (value) => (value === "inclusive" ? "inclusive" : "exclusive")],
  ["documentDiscountType", "document_discount_type", (value) => (["percent", "amount"].includes(value) ? value : null)],
  ["documentDiscountValue", "document_discount_value", (value) => asDatabaseDecimal(decimal(value || 0))],
  ["supplierStatedTotal", "supplier_stated_total", (value) => (value === undefined || value === null || value === "" ? null : asDatabaseDecimal(decimal(value)))],
  ["paymentTermId", "payment_term_id", (value) => optionalUuid(value, "Payment term")], ["withholdingSectionId", "withholding_section_id", (value) => optionalUuid(value, "Withholding section")],
  ["duplicateOverrideReason", "duplicate_override_reason", (value) => text(value, 1000) || null], ["debitNoteReason", "debit_note_reason", (value) => text(value, 1000) || null],
  ["sourcePurchaseReturnId", "source_purchase_return_id", (value) => optionalUuid(value, "Purchase return")],
  ["computedDueDate", "computed_due_date", (value) => (value ? isoDate(value, "Due date") : null)],
  ["dueDateOverrideReason", "due_date_override_reason", (value) => text(value, 1000) || null],
  // A vendor credit (migration 0055): where it comes from, the supplier's credit note date, its tax treatment and the claim it resolves.
  ["creditOrigin", "credit_origin", (value) => (["supplier_credit_note", "accepted_claim", "other_authorized"].includes(value) ? value : null)],
  ["supplierCreditNoteDate", "supplier_credit_note_date", (value) => (value ? isoDate(value, "Supplier credit note date") : null)],
  ["taxTreatment", "tax_treatment", (value) => (["gst_adjusting", "financial_only"].includes(value) ? value : null)],
  ["debitClaimId", "debit_claim_id", (value) => optionalUuid(value, "Debit claim")],
  ["creditAuthorizationReason", "credit_authorization_reason", (value) => text(value, 1000) || null],
  ["creditAuthorizedBy", "credit_authorized_by", (value) => optionalUuid(value, "Authorised by")],
  // Payment terms (migration 0056): the invoice received date, the terms the supplier's invoice states, why the agreed terms changed, the acceptance date.
  ["invoiceReceivedDate", "invoice_received_date", (value) => (value ? isoDate(value, "Invoice received date") : null)],
  ["supplierStatedTerms", "supplier_stated_terms", (value) => text(value, 200) || null],
  ["supplierStatedTermId", "supplier_stated_term_id", (value) => optionalUuid(value, "Supplier stated terms")],
  ["paymentTermChangeReason", "payment_term_change_reason", (value) => text(value, 1000) || null],
  ["acceptanceDate", "acceptance_date", (value) => (value ? isoDate(value, "Acceptance date") : null)],
];
async function writeHeaderExtras(client, context, billId, input, totals) {
  const values = [context.organizationId, billId];
  const sets = [];
  for (const [key, column, read, cast = ""] of HEADER_EXTRAS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    values.push(read(input[key]));
    sets.push(`${column}=$${values.length}${cast}`);
  }
  if (totals) {
    values.push(asDatabaseDecimal(sub(totals.subtotal, totals.discountTotal)));
    sets.push(`taxable_total=$${values.length}`);
    values.push(asDatabaseDecimal(sub(totals.subtotal, totals.discountTotal) + totals.taxTotal));
    sets.push(`invoice_total=$${values.length}`);
    values.push(asDatabaseDecimal(totals.reverseChargeTotal));
    sets.push(`reverse_charge_tax_total=$${values.length}`);
  }
  if (input.duplicateOverrideReason) { values.push(context.userId || null); sets.push(`duplicate_override_by=$${values.length}`); }
  if (Object.prototype.hasOwnProperty.call(input, "dueDateOverrideReason")) { values.push(input.dueDateOverrideReason ? context.userId || null : null); sets.push(`due_date_override_by=$${values.length}`); }
  if (sets.length) await client.query(`UPDATE tenant.accounting_vendor_bills SET ${sets.join(",")} WHERE organization_id=$1 AND id=$2`, values);
}

// options.documentNumber: the number the calling module allocated in its own series (a vendor credit's VC-…); otherwise Finance numbers it.
export async function createVendorBill(client, context, input, options = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context, input.ledgerId);
  const supplier = await ensureParty(client, context, input.partyId, ["supplier", "both"]);
  const billDate = isoDate(input.billDate || new Date().toISOString().slice(0, 10), "Bill date");
  const accountingDate = isoDate(input.accountingDate || billDate, "Accounting date");
  const explicitDueDate = input.dueDate ? isoDate(input.dueDate, "Due date") : null;
  const billCurrency = currency(input.currencyCode || supplier.currency_code || organization.base_currency);
  const rate = await getExchangeRate(client, context, billCurrency, organization.base_currency, accountingDate, input.exchangeRate);
  const totals = await normalizeBillLines(client, context, organization, ledger, billDate, input.lines, billCurrency, rate);
  const chargeTotal = roundMoney(decimal(input.chargeTotal || 0), totals.precision);
  const roundingAdjustment = roundMoney(decimal(input.roundingAdjustment || 0), totals.precision);
  if (chargeTotal < 0n) throw new AccountingError(400, "Bill charges cannot be negative.");
  const grandTotal = totals.grandTotal + chargeTotal + roundingAdjustment;
  if (grandTotal <= 0n) throw new AccountingError(400, "Bill grand total must be positive.");
  const baseTotal = toBaseAmount(grandTotal, rate, totals.basePrecision);
  const paymentSchedule = await resolvePaymentSchedule(client, context, {
    documentDate: billDate, explicitDueDate, paymentTermId: input.paymentTermId,
    partyPaymentTermId: supplier.payment_term_id, snapshot: input.paymentTermSnapshot,
    total: grandTotal, precision: totals.precision, dates: { invoiceReceivedDate: input.invoiceReceivedDate ?? null, postingDate: accountingDate },
  });
  const dueDate = paymentSchedule.dueDate;
  const billType = ["bill", "credit_note", "debit_note", "opening"].includes(input.billType) ? input.billType : "bill";
  const sourceBillId = optionalUuid(input.sourceBillId, "Source bill");
  if (sourceBillId) {
    const source = await client.query(
      `SELECT id,bill_type,currency_code FROM tenant.accounting_vendor_bills
       WHERE organization_id=$1 AND id=$2 AND ledger_id=$3 AND party_id=$4`,
      [context.organizationId, sourceBillId, ledger.id, supplier.id],
    );
    if (!source.rows[0]) throw new AccountingError(409, "The source vendor document does not belong to this ledger and supplier.");
    if (source.rows[0].currency_code !== billCurrency) throw new AccountingError(409, "The source vendor document currency must match.");
    if (billType === "credit_note" && source.rows[0].bill_type === "credit_note") throw new AccountingError(409, "A vendor credit note cannot be credited again.");
  }
  const entityType = billType === "credit_note" ? "vendor_credit_note" : "vendor_bill";
  const billNumber = text(options.documentNumber, 60) || await allocateNumber(client, context.organizationId, entityType);
  // The supplier's invoice number is kept as supplied (supplier_invoice_reference); the duplicate key is set when the bill is posted.
  const result = await client.query(`INSERT INTO tenant.accounting_vendor_bills (organization_id,ledger_id,bill_number,supplier_invoice_number,bill_type,party_id,source_purchase_order_id,source_goods_receipt_id,source_bill_id,bill_date,accounting_date,due_date,currency_code,functional_currency_code,exchange_rate,supplier_snapshot,payment_term_snapshot,subtotal,discount_total,charge_total,tax_total,withholding_total,rounding_adjustment,grand_total,base_currency_total,outstanding_amount,matching_status,status,notes,created_by,updated_by,supplier_invoice_reference) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24,$23,$25,'draft',$26,$27,$27,$28) RETURNING *`, [context.organizationId, ledger.id, billNumber, billType, supplier.id, optionalUuid(input.sourcePurchaseOrderId, "Purchase order"), optionalUuid(input.sourceGoodsReceiptId, "Goods receipt"), sourceBillId, billDate, accountingDate, dueDate, billCurrency, organization.base_currency, asDatabaseDecimal(rate), JSON.stringify(input.supplierSnapshot || { id: supplier.id, code: supplier.code, displayName: supplier.display_name, legalName: supplier.legal_name, gstin: supplier.gstin, pan: supplier.pan }), JSON.stringify(paymentSchedule.snapshot), asDatabaseDecimal(totals.subtotal), asDatabaseDecimal(totals.discountTotal), asDatabaseDecimal(chargeTotal), asDatabaseDecimal(totals.taxTotal), asDatabaseDecimal(totals.withholdingTotal), asDatabaseDecimal(roundingAdjustment), asDatabaseDecimal(grandTotal), asDatabaseDecimal(baseTotal), input.matchingStatus && ["not_required","pending","matched","exception","overridden"].includes(input.matchingStatus) ? input.matchingStatus : "not_required", text(input.notes, 2000) || null, context.userId, text(input.supplierInvoiceReference ?? input.supplierInvoiceNumber, 100) || null]);
  const bill = result.rows[0];
  await writeBillLines(client, context, bill.id, totals.lines);
  await writeHeaderExtras(client, context, bill.id, input, totals);
  await writeDocumentSchedule(client, context, "accounting_vendor_bill_schedules", "vendor_bill_id", bill.id, paymentSchedule.installments);
  await event(client, context, "vendor_bill", bill.id, "accounting.vendor_bill.created", null, "draft", { billNumber });
  return getVendorBill(client, context, bill.id);
}

// updateDraftVendorBill: a draft's dates, terms, lines and totals, recalculated as on creation. Anything past draft changes only by its own command.
export async function updateDraftVendorBill(client, context, idValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const id = uuid(idValue, "Vendor bill");
  const current = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id])).rows[0];
  if (!current) throw new AccountingError(404, "Vendor bill not found.");
  if (current.status !== "draft") throw new AccountingError(409, "Only a draft supplier bill can be changed.", "SUPPLIER_BILL_LOCKED");
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context, current.ledger_id);
  const supplier = await ensureParty(client, context, current.party_id, ["supplier", "both"]);
  const billDate = isoDate(input.billDate || String(current.bill_date instanceof Date ? current.bill_date.toISOString() : current.bill_date).slice(0, 10), "Bill date");
  const accountingDate = isoDate(input.accountingDate || billDate, "Accounting date");
  const billCurrency = currency(input.currencyCode || current.currency_code);
  const rate = await getExchangeRate(client, context, billCurrency, organization.base_currency, accountingDate, input.exchangeRate);
  const totals = await normalizeBillLines(client, context, organization, ledger, billDate, input.lines, billCurrency, rate);
  const roundingAdjustment = roundMoney(decimal(input.roundingAdjustment || 0), totals.precision);
  const grandTotal = totals.grandTotal + roundingAdjustment;
  if (grandTotal <= 0n) throw new AccountingError(400, "Bill grand total must be positive.");
  const paymentSchedule = await resolvePaymentSchedule(client, context, {
    documentDate: billDate, explicitDueDate: input.dueDate ? isoDate(input.dueDate, "Due date") : null, paymentTermId: input.paymentTermId,
    partyPaymentTermId: supplier.payment_term_id, snapshot: input.paymentTermSnapshot, total: grandTotal, precision: totals.precision,
    dates: { invoiceReceivedDate: input.invoiceReceivedDate ?? null, postingDate: accountingDate },
  });
  await client.query(`DELETE FROM tenant.supplier_bill_line_taxes WHERE organization_id=$1 AND vendor_bill_id=$2`, [context.organizationId, id]);
  await client.query(`DELETE FROM tenant.accounting_vendor_bill_lines WHERE organization_id=$1 AND vendor_bill_id=$2`, [context.organizationId, id]);
  await client.query(`DELETE FROM tenant.accounting_vendor_bill_schedules WHERE organization_id=$1 AND vendor_bill_id=$2`, [context.organizationId, id]);
  await client.query(
    `UPDATE tenant.accounting_vendor_bills SET bill_date=$3,accounting_date=$4,due_date=$5,currency_code=$6,exchange_rate=$7,payment_term_snapshot=$8::jsonb,subtotal=$9,discount_total=$10,
            tax_total=$11,withholding_total=$12,rounding_adjustment=$13,grand_total=$14,base_currency_total=$15,outstanding_amount=$14,matching_status=$16,notes=$17,updated_by=$18,updated_at=now(),
            supplier_snapshot=COALESCE($19::jsonb,supplier_snapshot)
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, id, billDate, accountingDate, paymentSchedule.dueDate, billCurrency, asDatabaseDecimal(rate), JSON.stringify(paymentSchedule.snapshot),
      asDatabaseDecimal(totals.subtotal), asDatabaseDecimal(totals.discountTotal), asDatabaseDecimal(totals.taxTotal), asDatabaseDecimal(totals.withholdingTotal),
      asDatabaseDecimal(roundingAdjustment), asDatabaseDecimal(grandTotal), asDatabaseDecimal(toBaseAmount(grandTotal, rate, totals.basePrecision)),
      ["not_required", "pending", "matched", "exception", "overridden"].includes(input.matchingStatus) ? input.matchingStatus : current.matching_status, text(input.notes, 2000) || null,
      context.userId, input.supplierSnapshot ? JSON.stringify(input.supplierSnapshot) : null]);
  await writeBillLines(client, context, id, totals.lines);
  await writeHeaderExtras(client, context, id, input, totals);
  await writeDocumentSchedule(client, context, "accounting_vendor_bill_schedules", "vendor_bill_id", id, paymentSchedule.installments);
  await event(client, context, "vendor_bill", id, "accounting.vendor_bill.updated", "draft", "draft", {});
  return getVendorBill(client, context, id);
}

// cancelDraftVendorBill: a bill that will not be posted. It never had an accounting effect.
export async function cancelDraftVendorBill(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const id = uuid(idValue, "Vendor bill");
  const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id])).rows[0];
  if (!bill) throw new AccountingError(404, "Vendor bill not found.");
  if (bill.status === "cancelled") return getVendorBill(client, context, id);
  if (!["draft", "pending_approval", "approved"].includes(bill.status)) throw new AccountingError(409, "A posted bill is not cancelled; reverse it or correct it with a vendor credit.", "SUPPLIER_BILL_LOCKED");
  const reason = requiredText(input.reason, "Cancellation reason", 1000);
  await client.query(`UPDATE tenant.accounting_vendor_bills SET status='cancelled',outstanding_amount=0,cancelled_by=$3,cancelled_at=now(),cancel_reason=$4,updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, id, context.userId, reason]);
  await event(client, context, "vendor_bill", id, "accounting.vendor_bill.cancelled", bill.status, "cancelled", { reason });
  return getVendorBill(client, context, id);
}

// The duplicate key of a supplier invoice: its number without whitespace, case-folded, with the GSTIN that issued it and the financial year.
export function supplierInvoiceKey(reference, gstin, billDate, countryCode = "IN") {
  const number = String(reference ?? "").replace(/\s+/g, "").toUpperCase();
  if (!number) return null;
  const day = String(billDate instanceof Date ? billDate.toISOString() : billDate).slice(0, 10);
  const [year, month] = day.split("-").map(Number);
  const fiscal = countryCode === "IN" ? (month >= 4 ? `${year}-${String((year + 1) % 100).padStart(2, "0")}` : `${year - 1}-${String(year % 100).padStart(2, "0")}`) : String(year);
  return `${number}|${String(gstin ?? "").trim().toUpperCase() || "-"}|FY${fiscal}`;
}

export async function listVendorBills(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId]; let where = "";
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 30)); where += ` AND bill.status=$${values.length}`; }
  if (filters.partyId) { values.push(uuid(filters.partyId, "Supplier")); where += ` AND bill.party_id=$${values.length}`; }
  if (filters.search) { values.push(`%${text(filters.search, 100)}%`); where += ` AND (bill.bill_number ILIKE $${values.length} OR COALESCE(bill.supplier_invoice_reference,bill.supplier_invoice_number) ILIKE $${values.length} OR party.display_name ILIKE $${values.length})`; }
  const result = await client.query(`SELECT bill.id,bill.party_id,bill.bill_number,COALESCE(bill.supplier_invoice_reference,bill.supplier_invoice_number) AS supplier_invoice_number,bill.bill_type,bill.bill_date,bill.due_date,bill.currency_code,bill.grand_total,bill.outstanding_amount,bill.matching_status,bill.status,party.display_name AS supplier_name FROM tenant.accounting_vendor_bills bill JOIN tenant.business_parties party ON party.id=bill.party_id WHERE bill.organization_id=$1${where} ORDER BY bill.bill_date DESC,bill.created_at DESC LIMIT 300`, values);
  return result.rows;
}

export async function getVendorBill(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(idValue, "Vendor bill");
  const result = await client.query(`SELECT bill.*,COALESCE(bill.supplier_invoice_reference,bill.supplier_invoice_number) AS supplier_invoice_number,party.display_name AS supplier_name FROM tenant.accounting_vendor_bills bill JOIN tenant.business_parties party ON party.id=bill.party_id WHERE bill.organization_id=$1 AND bill.id=$2`, [context.organizationId, id]);
  const bill = result.rows[0];
  if (!bill) throw new AccountingError(404, "Vendor bill not found.");
  // Sequential, not Promise.all: a single pg client can only run one query at a time (concurrent
  // queries on the same connection are deprecated and will error in pg@9) -- mirrors the identical
  // fix already applied to getCustomerInvoice above.
  const lines = await client.query(`SELECT line.*,account.code AS expense_account_code,account.name AS expense_account_name FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_accounts account ON account.id=line.expense_account_id WHERE line.organization_id=$1 AND line.vendor_bill_id=$2 ORDER BY line.sequence`, [context.organizationId, id]);
  const schedules = await client.query(`SELECT * FROM tenant.accounting_vendor_bill_schedules WHERE organization_id=$1 AND vendor_bill_id=$2 ORDER BY sequence`, [context.organizationId, id]);
  const allocations = await client.query(`SELECT allocation.*,payment.payment_number,payment.payment_date,payment.payment_method,payment.external_reference,reversal.reversed_at FROM tenant.accounting_vendor_payment_allocations allocation JOIN tenant.accounting_vendor_payments payment ON payment.id=allocation.payment_id LEFT JOIN tenant.accounting_vendor_payment_allocation_reversals reversal ON reversal.organization_id=allocation.organization_id AND reversal.allocation_id=allocation.id WHERE allocation.organization_id=$1 AND allocation.vendor_bill_id=$2 ORDER BY allocation.allocated_at DESC`, [context.organizationId, id]);
  const creditAllocations = await client.query(`SELECT allocation.*,credit.bill_number AS credit_note_number,target.bill_number AS target_bill_number
      FROM tenant.accounting_vendor_credit_allocations allocation
      JOIN tenant.accounting_vendor_bills credit ON credit.id=allocation.credit_note_id
      JOIN tenant.accounting_vendor_bills target ON target.id=allocation.vendor_bill_id
      WHERE allocation.organization_id=$1 AND (allocation.credit_note_id=$2 OR allocation.vendor_bill_id=$2)
      ORDER BY allocation.allocated_at DESC`, [context.organizationId, id]);
  const creditCandidates = bill.bill_type === "credit_note"
    ? await client.query(`SELECT id,bill_number,bill_date,due_date,currency_code,outstanding_amount
          FROM tenant.accounting_vendor_bills
          WHERE organization_id=$1 AND ledger_id=$2 AND party_id=$3
            AND bill_type IN ('bill','debit_note','opening')
            AND status IN ('posted','partially_paid','overdue','disputed') AND outstanding_amount>0
          ORDER BY due_date,bill_date`, [context.organizationId, bill.ledger_id, bill.party_id])
    : { rows: [] };
  const events = await client.query(`SELECT * FROM tenant.accounting_events WHERE organization_id=$1 AND entity_type='vendor_bill' AND entity_id=$2 ORDER BY occurred_at DESC`, [context.organizationId, id]);
  return { bill, lines: lines.rows, schedules: schedules.rows, allocations: allocations.rows,
    creditAllocations: creditAllocations.rows, creditCandidates: creditCandidates.rows, events: events.rows };
}

// Reverse-charge tax is self-assessed by the buyer: input tax (recoverable) against a reverse-charge liability, in its own journal; never owed to the supplier.
async function postReverseCharge(client, context, bill, detail) {
  const lines = detail.lines.filter((line) => decimal(line.reverse_charge_tax) > 0n);
  if (!lines.length) return null;
  const input = await getAccountMapping(client, context, bill.ledger_id, "input_tax", { date: bill.accounting_date });
  let liability;
  try { liability = await getAccountMapping(client, context, bill.ledger_id, "reverse_charge_tax", { date: bill.accounting_date }); }
  catch { liability = await getAccountMapping(client, context, bill.ledger_id, "output_tax", { date: bill.accounting_date }); }
  const journalId = await purchaseJournal(client, context, bill.ledger_id);
  const journalLines = [];
  for (const line of lines) {
    journalLines.push({ accountId: input.account_id, partyId: bill.party_id, description: `Reverse-charge input tax ${line.description}`, debit: line.reverse_charge_tax, credit: 0,
      referenceType: "vendor_bill", referenceId: bill.id, taxBaseAmount: line.net_amount });
    journalLines.push({ accountId: liability.account_id, partyId: bill.party_id, description: `Reverse-charge tax payable ${line.description}`, debit: 0, credit: line.reverse_charge_tax,
      referenceType: "vendor_bill", referenceId: bill.id });
  }
  const journal = await createJournalEntry(client, context, { ledgerId: bill.ledger_id, journalId, entryDate: bill.bill_date, accountingDate: bill.accounting_date, documentDate: bill.bill_date,
    entryType: "subledger", reference: bill.supplier_invoice_reference || bill.bill_number, description: `Reverse charge on ${bill.bill_number}`, currencyCode: bill.currency_code,
    exchangeRate: bill.exchange_rate, lines: journalLines }, { internal: true, sourceModule: "accounting", sourceType: "vendor_bill_reverse_charge", sourceId: bill.id, sourceNumber: bill.bill_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  const taxed = (await client.query(`SELECT id FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2 AND tax_base_amount<>0 ORDER BY sequence`,
    [context.organizationId, journal.entry.id])).rows;
  const components = (await client.query(`SELECT * FROM tenant.supplier_bill_line_taxes WHERE organization_id=$1 AND vendor_bill_id=$2 AND tax_classification='reverse_charge'`,
    [context.organizationId, bill.id])).rows;
  for (const [index, line] of lines.entries()) {
    const parts = components.filter((component) => component.vendor_bill_line_id === line.id);
    for (const part of parts.length ? parts : [{ tax_type: "other", taxable_base: line.net_amount, tax_amount: line.reverse_charge_tax }]) {
      for (const direction of ["input", "output"]) {
        await client.query(
          `INSERT INTO tenant.accounting_tax_ledger (organization_id,journal_entry_id,journal_line_id,source_type,source_id,party_id,tax_registration,tax_type,direction,tax_period,
             taxable_amount,tax_amount,recoverable_amount,reverse_charge,place_of_supply,hsn_sac_code,status)
           VALUES ($1,$2,$3,'vendor_bill',$4,$5,$6,$7,$8,to_char($9::date,'YYYY-MM'),$10,$11,$12,true,$13,$14,'open') ON CONFLICT (organization_id,journal_line_id,tax_type,direction) DO NOTHING`,
          [context.organizationId, journal.entry.id, taxed[index].id, bill.id, bill.party_id, bill.supplier_tax_snapshot?.gstin || bill.supplier_snapshot?.gstin || null,
            ["cgst", "sgst", "igst", "cess"].includes(part.tax_type) ? part.tax_type : "other", direction, bill.accounting_date, part.taxable_base, part.tax_amount,
            direction === "input" ? part.tax_amount : 0, bill.place_of_supply || null, line.hsn_sac_code || null]);
      }
    }
  }
  return journal.entry.id;
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
  // One supplier invoice, one payable: the key is unique among bills that left draft, unless the duplicate was accepted with a reason.
  if (bill.bill_type === "bill" && bill.supplier_invoice_reference && !bill.duplicate_override_reason) {
    const organization = await loadOrganization(client, context);
    const key = supplierInvoiceKey(bill.supplier_invoice_reference, bill.supplier_tax_snapshot?.gstin ?? bill.supplier_snapshot?.gstin, bill.bill_date, String(organization.country_code ?? "IN").trim());
    try {
      await client.query("SAVEPOINT supplier_invoice_key");
      await client.query(`UPDATE tenant.accounting_vendor_bills SET supplier_invoice_key=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, key]);
      await client.query("RELEASE SAVEPOINT supplier_invoice_key");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT supplier_invoice_key");
      if (error.code !== "23505") throw error;
      const existing = (await client.query(`SELECT bill_number FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND party_id=$2 AND supplier_invoice_key=$3 AND id<>$4 AND status NOT IN ('draft','cancelled','reversed') LIMIT 1`,
        [context.organizationId, bill.party_id, key, id])).rows[0];
      throw new AccountingError(409, `Supplier invoice ${bill.supplier_invoice_reference} is already recorded${existing ? ` as ${existing.bill_number}` : ""}.`, "SUPPLIER_BILL_DUPLICATE_INVOICE");
    }
  }
  const detail = await getVendorBill(client, context, id);
  const payable = await getAccountMapping(client, context, bill.ledger_id, "payable", { partyId: bill.party_id, date: bill.accounting_date });
  const journalId = await purchaseJournal(client, context, bill.ledger_id);
  const isCreditNote = bill.bill_type === "credit_note";
  let lines = [];
  for (const line of detail.lines) {
    const variance = decimal(line.variance_amount || 0);
    const expensePart = decimal(line.net_amount) - variance;
    if (expensePart !== 0n) lines.push({ accountId: line.expense_account_id, partyId: bill.party_id, departmentId: line.department_id, costCenterId: line.cost_center_id, description: line.description,
      debit: expensePart > 0n ? asDatabaseDecimal(expensePart) : 0, credit: expensePart < 0n ? asDatabaseDecimal(-expensePart) : 0, referenceType: "vendor_bill", referenceId: bill.id });
    if (variance !== 0n && line.variance_account_id) lines.push({ accountId: line.variance_account_id, partyId: bill.party_id, description: `Price variance ${line.description}`,
      debit: variance > 0n ? asDatabaseDecimal(variance) : 0, credit: variance < 0n ? asDatabaseDecimal(-variance) : 0, referenceType: "vendor_bill", referenceId: bill.id });
    if (decimal(line.tax_amount) > 0n && line.tax_account_id) lines.push({ accountId: line.tax_account_id, partyId: bill.party_id, description: `Input tax ${line.description}`, debit: line.tax_amount, credit: 0, referenceType: "vendor_bill", referenceId: bill.id, taxBaseAmount: line.net_amount });
    if (decimal(line.withholding_amount) > 0n && line.withholding_account_id) lines.push({ accountId: line.withholding_account_id, partyId: bill.party_id, description: `Withholding ${line.description}`, debit: 0, credit: line.withholding_amount, referenceType: "vendor_bill", referenceId: bill.id });
  }
  if (decimal(bill.charge_total) > 0n) {
    const chargeAccount = await getAccountMapping(client, context, bill.ledger_id, "expense", { partyId: bill.party_id, date: bill.accounting_date });
    lines.push({ accountId: chargeAccount.account_id, partyId: bill.party_id, description: `Bill charges ${bill.bill_number}`, debit: bill.charge_total, credit: 0, referenceType: "vendor_bill", referenceId: bill.id });
  }
  if (decimal(bill.rounding_adjustment) !== 0n) {
    const rounding = await getAccountMapping(client, context, bill.ledger_id, "rounding", { date: bill.accounting_date });
    const amount = decimal(bill.rounding_adjustment);
    lines.push({ accountId: rounding.account_id, description: `Rounding ${bill.bill_number}`, debit: amount > 0n ? asDatabaseDecimal(amount) : 0, credit: amount < 0n ? asDatabaseDecimal(-amount) : 0, referenceType: "vendor_bill", referenceId: bill.id });
  }
  lines.push({ accountId: payable.account_id, partyId: bill.party_id, description: `Payable ${bill.bill_number}`, debit: 0, credit: bill.grand_total, dueDate: bill.due_date, referenceType: "vendor_bill", referenceId: bill.id });
  if (isCreditNote) lines = reversePostingLines(lines);
  const commercialTotal = lines.slice(0, -1).reduce((total, line) => total
    + (isCreditNote ? decimal(line.credit || 0) - decimal(line.debit || 0) : decimal(line.debit || 0) - decimal(line.credit || 0)), 0n);
  if (commercialTotal !== decimal(bill.grand_total)) {
    throw new AccountingError(409, "Vendor bill posting does not reconcile to the document grand total.");
  }
  const sourceType = isCreditNote ? "vendor_credit_note" : "vendor_bill";
  const journal = await createJournalEntry(client, context, { ledgerId: bill.ledger_id, journalId, entryDate: bill.bill_date, accountingDate: bill.accounting_date, documentDate: bill.bill_date, entryType: "subledger", reference: bill.supplier_invoice_reference || bill.bill_number, description: `Vendor bill ${bill.bill_number}`, currencyCode: bill.currency_code, exchangeRate: bill.exchange_rate, lines }, { internal: true, sourceModule: "accounting", sourceType, sourceId: bill.id, sourceNumber: bill.bill_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  // Reverse-charge tax has its own ledger rows (postReverseCharge); the tax the supplier charged is ordinary input tax.
  await recordDocumentTaxLedger(client, context, { ...bill, reverse_charge: false }, detail.lines, journal.entry.id, "input");
  await recordWithholdingLedger(client, context, bill, detail.lines, journal.entry.id);
  const reverseChargeJournalId = isCreditNote ? null : await postReverseCharge(client, context, bill, detail);
  await client.query(`UPDATE tenant.accounting_vendor_bills SET status='posted',journal_entry_id=$3,outstanding_amount=grand_total,posted_at=now(),posted_by=$4,updated_by=$4,reverse_charge_journal_entry_id=$5 WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, journal.entry.id, context.userId, reverseChargeJournalId]);
  await event(client, context, "vendor_bill", id, "accounting.vendor_bill.posted", bill.status, "posted", { journalEntryId: journal.entry.id, reverseChargeJournalId });
  return getVendorBill(client, context, id);
}

// TDS withheld on a bill, for the withholding ledger: one row per withholding journal line.
async function recordWithholdingLedger(client, context, bill, detailLines, journalEntryId) {
  const sources = detailLines.filter((line) => decimal(line.withholding_amount || 0) > 0n && line.withholding_account_id);
  if (!sources.length) return;
  const journalLines = (await client.query(
    `SELECT id FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2 AND description LIKE 'Withholding %' ORDER BY sequence`, [context.organizationId, journalEntryId])).rows;
  const sign = bill.bill_type === "credit_note" ? -1n : 1n;
  for (const [index, line] of sources.entries()) {
    if (!journalLines[index]) break;
    await client.query(
      `INSERT INTO tenant.accounting_tax_ledger (organization_id,journal_entry_id,journal_line_id,source_type,source_id,party_id,tax_registration,tax_type,direction,tax_period,
         taxable_amount,tax_amount,recoverable_amount,reverse_charge,place_of_supply,hsn_sac_code,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'tds','withholding',to_char($8::date,'YYYY-MM'),$9,$10,0,false,$11,$12,'open') ON CONFLICT (organization_id,journal_line_id,tax_type,direction) DO NOTHING`,
      [context.organizationId, journalEntryId, journalLines[index].id, bill.bill_type === "credit_note" ? "vendor_credit_note" : "vendor_bill", bill.id, bill.party_id,
        bill.supplier_snapshot?.pan || null, bill.accounting_date, asDatabaseDecimal(decimal(line.net_amount) * sign), asDatabaseDecimal(decimal(line.withholding_amount) * sign),
        bill.place_of_supply || null, line.hsn_sac_code || null]);
  }
}

// reverseVendorBill: undoes a posted bill nothing has settled — no payment, no credit applied, no credit note against it — by reversing its
// journals (and the reverse-charge journal) and its tax ledger rows. The bill is kept, marked reversed.
export async function reverseVendorBill(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesApprove);
  const id = uuid(idValue, "Vendor bill");
  const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id])).rows[0];
  if (!bill) throw new AccountingError(404, "Vendor bill not found.");
  if (bill.status === "reversed") return getVendorBill(client, context, id);
  if (!["posted", "overdue"].includes(bill.status) || decimal(bill.outstanding_amount) !== decimal(bill.grand_total))
    throw new AccountingError(409, "Only a posted bill with nothing paid or credited can be reversed. Reverse the payments or credits first, or record a vendor credit.", "SUPPLIER_BILL_IN_USE");
  const reason = requiredText(input.reason, "Reversal reason", 1000);
  const used = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.accounting_vendor_payment_allocations WHERE organization_id=$1 AND vendor_bill_id=$2)::int AS payments,
            (SELECT count(*) FROM tenant.accounting_vendor_credit_allocations WHERE organization_id=$1 AND (vendor_bill_id=$2 OR credit_note_id=$2))::int AS credits,
            (SELECT count(*) FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND source_bill_id=$2 AND status NOT IN ('cancelled','reversed'))::int AS notes`,
    [context.organizationId, id])).rows[0];
  if (used.payments || used.credits || used.notes) throw new AccountingError(409, "Payments or vendor credits refer to this bill. Correct them first.", "SUPPLIER_BILL_IN_USE");
  const reversing = { ...context, permissions: [...new Set([...(context.permissions || []), ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.view])] };
  const reversal = await reverseJournalEntry(client, reversing, bill.journal_entry_id, { reason: `${bill.bill_number}: ${reason}` });
  if (bill.reverse_charge_journal_entry_id) await reverseJournalEntry(client, reversing, bill.reverse_charge_journal_entry_id, { reason: `${bill.bill_number}: ${reason}` });
  await client.query(`UPDATE tenant.accounting_tax_ledger SET status='reversed' WHERE organization_id=$1 AND source_id=$2 AND status='open'`, [context.organizationId, id]);
  await client.query(`UPDATE tenant.accounting_vendor_bill_schedules SET outstanding_amount=0 WHERE organization_id=$1 AND vendor_bill_id=$2`, [context.organizationId, id]);
  await client.query(`UPDATE tenant.accounting_vendor_bills SET status='reversed',outstanding_amount=0,reversed_by=$3,reversed_at=now(),reversal_reason=$4,reversal_journal_entry_id=$5,updated_by=$3,updated_at=now()
                       WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, context.userId, reason, reversal.entry?.id ?? reversal.id ?? null]);
  await event(client, context, "vendor_bill", id, "accounting.vendor_bill.reversed", bill.status, "reversed", { reason });
  return getVendorBill(client, context, id);
}

export async function createVendorPayment(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context, input.ledgerId);
  const supplier = await ensureParty(client, context, input.partyId, ["supplier", "both"]);
  const paymentDate = isoDate(input.paymentDate || new Date().toISOString().slice(0, 10), "Payment date");
  const accountingDate = isoDate(input.accountingDate || paymentDate, "Accounting date");
  const paymentCurrency = currency(input.currencyCode || supplier.currency_code || organization.base_currency);
  const rate = await getExchangeRate(client, context, paymentCurrency, organization.base_currency, accountingDate, input.exchangeRate);
  const precision = await getCurrencyPrecision(client, context, paymentCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, organization.base_currency);
  const amount = roundMoney(positiveAmount(input.amount, "Payment amount"), precision);
  const baseAmount = toBaseAmount(amount, rate, basePrecision);
  const paymentNumber = await allocateNumber(client, context.organizationId, "vendor_payment");
  const result = await client.query(`INSERT INTO tenant.accounting_vendor_payments (organization_id,ledger_id,payment_number,party_id,bank_account_id,payment_date,accounting_date,currency_code,functional_currency_code,exchange_rate,amount,base_amount,unapplied_amount,payment_method,external_reference,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$13,$14,'draft',$15,$15) RETURNING *`, [context.organizationId, ledger.id, paymentNumber, supplier.id, optionalUuid(input.bankAccountId, "Bank account"), paymentDate, accountingDate, paymentCurrency, organization.base_currency, asDatabaseDecimal(rate), asDatabaseDecimal(amount), asDatabaseDecimal(baseAmount), ["cash","bank_transfer","card","upi","cheque","gateway","other"].includes(input.paymentMethod) ? input.paymentMethod : "bank_transfer", text(input.externalReference, 200) || null, context.userId]);
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
  const bank = await paymentJournal(client, context, payment.ledger_id, payment.bank_account_id);
  const payable = await getAccountMapping(client, context, payment.ledger_id, "payable", { partyId: payment.party_id, date: payment.accounting_date });
  const journal = await createJournalEntry(client, context, { ledgerId: payment.ledger_id, journalId: bank.journal_id, entryDate: payment.payment_date, accountingDate: payment.accounting_date, entryType: "subledger", reference: payment.external_reference || payment.payment_number, description: `Vendor payment ${payment.payment_number}`, currencyCode: payment.currency_code, exchangeRate: payment.exchange_rate, lines: [
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
        WHERE organization_id=$1 AND id=$2 AND ledger_id=$3 AND party_id=$4 FOR UPDATE`,
      [context.organizationId, billId, payment.ledger_id, payment.party_id],
    );
    const bill = billResult.rows[0];
    if (!bill || !["posted", "partially_paid", "overdue", "disputed"].includes(bill.status)) {
      throw new AccountingError(409, "An allocation bill is unavailable or not open in the payment ledger.");
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
          AND NOT EXISTS (SELECT 1 FROM tenant.accounting_vendor_payment_allocation_reversals reversal WHERE reversal.organization_id=$1 AND reversal.allocation_id=accounting_vendor_payment_allocations.id)
          AND COALESCE(schedule_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`,
      [context.organizationId, payment.id, bill.id, scheduleId],
    );
    if (duplicate.rows[0]) throw new AccountingError(409, "This payment has already been allocated to the selected bill installment.");
    const allocationId = randomUUID();
    const adjustment = await createVendorSettlementAdjustment(client, context, {
      allocationId,
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

// Puts back what reduced a bill's schedules (latest due first), when a payment that settled it is reversed.
export async function restoreBillSchedules(client, context, billId, amountValue) {
  let remaining = decimal(amountValue);
  const schedules = await client.query(
    `SELECT * FROM tenant.accounting_vendor_bill_schedules WHERE organization_id=$1 AND vendor_bill_id=$2 AND outstanding_amount<amount ORDER BY due_date DESC,sequence DESC FOR UPDATE`,
    [context.organizationId, billId]);
  for (const schedule of schedules.rows) {
    if (remaining <= 0n) break;
    const room = decimal(schedule.amount) - decimal(schedule.outstanding_amount);
    const back = remaining < room ? remaining : room;
    const outstanding = decimal(schedule.outstanding_amount) + back;
    await client.query(`UPDATE tenant.accounting_vendor_bill_schedules SET outstanding_amount=$3,status=$4 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, schedule.id, asDatabaseDecimal(outstanding), outstanding === decimal(schedule.amount) ? "open" : "partially_paid"]);
    remaining -= back;
  }
}

// reverseVendorPayment: a posted supplier payment that did not happen (bounced, entered in error). Its journal and settlement adjustments are
// reversed, every bill it settled is owed again, and its allocations are kept, marked reversed.
export async function reverseVendorPayment(client, context, paymentIdValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsApprove);
  const id = uuid(paymentIdValue, "Vendor payment");
  const payment = (await client.query(`SELECT * FROM tenant.accounting_vendor_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id])).rows[0];
  if (!payment) throw new AccountingError(404, "Vendor payment not found.");
  if (payment.status === "reversed") return payment;
  if (!["posted", "partially_applied", "applied"].includes(payment.status)) throw new AccountingError(409, "Only a posted payment can be reversed.");
  const reason = requiredText(input.reason, "Reversal reason", 1000);
  const reversing = { ...context, permissions: [...new Set([...(context.permissions || []), ACCOUNTING_PERMISSIONS.journalReverse, ACCOUNTING_PERMISSIONS.view])] };
  const allocations = (await client.query(`SELECT allocation.* FROM tenant.accounting_vendor_payment_allocations allocation WHERE allocation.organization_id=$1 AND allocation.payment_id=$2
      AND NOT EXISTS (SELECT 1 FROM tenant.accounting_vendor_payment_allocation_reversals reversal WHERE reversal.organization_id=$1 AND reversal.allocation_id=allocation.id)`,
    [context.organizationId, id])).rows;
  for (const allocation of allocations) {
    const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, allocation.vendor_bill_id])).rows[0];
    const outstanding = decimal(bill.outstanding_amount) + decimal(allocation.allocated_amount);
    await restoreBillSchedules(client, context, bill.id, allocation.allocated_amount);
    const status = outstanding >= decimal(bill.grand_total) ? "posted" : "partially_paid";
    await client.query(`UPDATE tenant.accounting_vendor_bills SET outstanding_amount=$3,status=$4,updated_by=$5,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, bill.id, asDatabaseDecimal(outstanding), status, context.userId]);
    if (allocation.adjustment_journal_entry_id) await reverseJournalEntry(client, reversing, allocation.adjustment_journal_entry_id, { reason: `${payment.payment_number} reversed: ${reason}` });
    await client.query(`INSERT INTO tenant.accounting_vendor_payment_allocation_reversals (organization_id,allocation_id,payment_id,vendor_bill_id,amount,reason,reversed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [context.organizationId, allocation.id, id, bill.id, allocation.allocated_amount, reason, context.userId]);
    await event(client, context, "vendor_bill", bill.id, "accounting.vendor_bill.payment_reversed", bill.status, status, { paymentId: id, amount: asDatabaseDecimal(decimal(allocation.allocated_amount)) });
  }
  const reversal = await reverseJournalEntry(client, reversing, payment.journal_entry_id, { reason: `${payment.payment_number}: ${reason}` });
  const updated = await client.query(
    `UPDATE tenant.accounting_vendor_payments SET status='reversed',unapplied_amount=0,reversed_at=now(),reversed_by=$3,reversal_reason=$4,reversal_journal_entry_id=$5,updated_by=$3
      WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, id, context.userId, reason, reversal.entry?.id ?? reversal.id ?? null]);
  await event(client, context, "vendor_payment", id, "accounting.vendor_payment.reversed", payment.status, "reversed", { reason });
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
        WHERE organization_id=$1 AND id=$2 AND ledger_id=$3 AND party_id=$4 FOR UPDATE`,
      [context.organizationId, billId, credit.ledger_id, credit.party_id],
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
