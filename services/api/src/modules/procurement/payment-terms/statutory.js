// Statutory payment deadlines (MSMED Act, 2006, section 15): for a supplier classified as a micro or small enterprise, payment is due within
// the days of a written agreement — never more than 45 — counted from the day the goods or services were accepted (or deemed accepted);
// without a written agreement, within 15 days. The deadline is worked out separately from the commercial payment terms and kept per
// acceptance: a bill covering several receipts has a deadline for each. A commercial term or a reschedule never moves it.
//
//   applies           micro or small, classified from a date on or before the acceptance (medium enterprises and others: not applicable)
//   acceptance date   the goods receipt that accepted the goods (the day of delivery: deemed acceptance when no objection was raised);
//                     for a bill without receipts, the date recorded on the bill, else the invoice received date, else the invoice date;
//                     after a documented objection is resolved, the day it was resolved
// Statutory interest is not posted here: overdue obligations are identified for Finance and Compliance.
import { add, decimal, div, formatDecimal, mul, roundMoney } from "../../../core/decimal.js";
import { addDays, readTermSnapshot, generatePaymentSchedule, companyToday } from "../../../core/payment-terms/terms.js";
import { PurchaseOrderError, dayOf, fail, readDate, requireUuid, text } from "../purchase-orders/constants.js";
import { poCan } from "../purchase-orders/access.js";

export const STATUTORY_MAX_AGREED_DAYS = 45;
export const STATUTORY_DEFAULT_DAYS = 15;
const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));

export function requireComplianceView(context) {
  if (!poCan(context, "procurement.compliance.view") && !poCan(context, "accounting.payables.manage"))
    throw new PurchaseOrderError(403, "You do not have permission to view supplier payment compliance.", "PERMISSION_DENIED");
}

async function supplierClassification(client, organizationId, supplierId) {
  if (!supplierId) return null;
  return (await client.query(
    `SELECT supplier.id, supplier.supplier_number, party.display_name, supplier.msme_classification, supplier.msme_registration_number, supplier.msme_effective_from,
            supplier.msme_evidence_reference, supplier.written_payment_agreement, supplier.agreed_payment_days, supplier.payment_agreement_reference
       FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2`, [organizationId, supplierId])).rows[0] ?? null;
}

// The rule for a supplier on a given acceptance date: { applies, classification, agreementBasis, agreedDays, statutoryDays, reason, snapshot }.
export function statutoryRuleFor(supplier, acceptanceDate = null) {
  const classification = supplier?.msme_classification ?? null;
  const effective = supplier?.msme_effective_from ? dayOf(supplier.msme_effective_from) : null;
  const snapshot = supplier ? { supplierId: supplier.id, supplierNumber: supplier.supplier_number, supplierName: supplier.display_name, classification, registrationNumber: supplier.msme_registration_number,
    effectiveFrom: effective, evidence: supplier.msme_evidence_reference, writtenAgreement: Boolean(supplier.written_payment_agreement), agreedDays: supplier.agreed_payment_days,
    agreementReference: supplier.payment_agreement_reference } : null;
  if (!["micro", "small"].includes(classification))
    return { applies: false, classification, reason: classification === "medium" ? "Medium enterprises are outside the statutory payment deadline." : "The supplier is not classified as a micro or small enterprise.", snapshot };
  if (effective && acceptanceDate && effective > acceptanceDate)
    return { applies: false, classification, reason: `The ${classification} classification is effective from ${effective}, after the acceptance.`, snapshot };
  const written = Boolean(supplier.written_payment_agreement) && supplier.agreed_payment_days !== null && supplier.agreed_payment_days !== undefined;
  const agreedDays = written ? Number(supplier.agreed_payment_days) : null;
  const statutoryDays = written ? Math.min(agreedDays, STATUTORY_MAX_AGREED_DAYS) : STATUTORY_DEFAULT_DAYS;
  return { applies: true, classification, agreementBasis: written ? "written_agreement" : "no_agreement", agreedDays, statutoryDays, snapshot,
    reason: written ? `Written agreement of ${agreedDays} days${agreedDays > STATUTORY_MAX_AGREED_DAYS ? `, limited to ${STATUTORY_MAX_AGREED_DAYS}` : ""}` : `No written agreement: ${STATUTORY_DEFAULT_DAYS} days` };
}

// validateStatutoryPaymentDeadline: whether a commercial term (as the snapshot a document would keep) gives due dates beyond the statutory
// deadline for this supplier, counted from `referenceDate` (an order date, an invoice date). input: { supplierId, termSnapshot, referenceDate? }.
// Returns { applies, statutoryDays, exceeds, message, rule }.
export async function validateStatutoryPaymentDeadline(client, context, input = {}) {
  const supplier = await supplierClassification(client, context.organizationId, input.supplierId ? requireUuid(input.supplierId, "Supplier") : null);
  const reference = dayOf(input.referenceDate ?? await companyToday(client, context.organizationId));
  const rule = statutoryRuleFor(supplier, reference);
  if (!rule.applies) return { applies: false, exceeds: false, message: null, rule };
  const term = readTermSnapshot(input.termSnapshot);
  const schedule = term ? generatePaymentSchedule(term, { total: "100", dates: { invoiceDate: reference, invoiceReceivedDate: reference, postingDate: reference } }) : null;
  const latest = schedule?.map((line) => line.dueDate).filter(Boolean).sort().at(-1) ?? null;
  const limit = addDays(reference, rule.statutoryDays);
  const exceeds = Boolean(latest && latest > limit) || (rule.agreedDays !== null && rule.agreedDays > STATUTORY_MAX_AGREED_DAYS);
  const message = exceeds
    ? `Payment term exceeds statutory limit: ${supplier.display_name} is a ${rule.classification} enterprise — payment is due within ${rule.statutoryDays} days of acceptance (${rule.reason.toLowerCase()}), whatever the commercial terms say.`
    : null;
  return { applies: true, statutoryDays: rule.statutoryDays, exceeds, message, rule, commercialLatestDueDate: latest, statutoryLimitDate: limit };
}

// The acceptances a posted bill covers: per goods receipt (acceptance on its receipt date) with the share of the bill's payable for the goods
// it accepted; a bill without receipts is one acceptance.
async function acceptancesOf(client, organizationId, bill) {
  const rows = (await client.query(
    `SELECT receipt.id AS receipt_id, receipt.receipt_number, receipt.receipt_date, line.id AS bill_line_id, line.quantity AS line_quantity, line.line_total, sum(allocation.quantity) AS quantity
       FROM tenant.supplier_bill_receipt_allocations allocation
       JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = allocation.organization_id AND receipt_line.id = allocation.goods_receipt_line_id
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
       JOIN tenant.accounting_vendor_bill_lines line ON line.organization_id = allocation.organization_id AND line.id = allocation.vendor_bill_line_id
      WHERE allocation.organization_id = $1 AND allocation.vendor_bill_id = $2
      GROUP BY receipt.id, receipt.receipt_number, receipt.receipt_date, line.id, line.quantity, line.line_total`, [organizationId, bill.id])).rows;
  const grand = decimal(bill.grand_total);
  const fallbackDate = dayOf(bill.acceptance_date ?? bill.invoice_received_date ?? bill.bill_date);
  if (!rows.length) return [{ receiptId: null, reference: `${bill.bill_number} (invoice)`, acceptanceDate: fallbackDate, basis: bill.acceptance_date ? "accepted" : "deemed", amount: grand }];
  const linesTotal = (await client.query(`SELECT COALESCE(sum(line_total), 0) AS total FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2`, [organizationId, bill.id])).rows[0].total;
  const byReceipt = new Map();
  let covered = 0n;
  for (const row of rows) {
    const share = decimal(row.line_quantity) > 0n ? div(mul(decimal(row.line_total), decimal(row.quantity)), decimal(row.line_quantity)) : 0n;
    const entry = byReceipt.get(row.receipt_id) ?? { receiptId: row.receipt_id, reference: row.receipt_number, acceptanceDate: dayOf(row.receipt_date), basis: "accepted", lineValue: 0n };
    entry.lineValue = add(entry.lineValue, share);
    byReceipt.set(row.receipt_id, entry);
  }
  const entries = [...byReceipt.values()].sort((a, b) => a.acceptanceDate.localeCompare(b.acceptanceDate));
  // The payable (after tax, withholding and rounding) shared in proportion to each receipt's goods; what no receipt covers (charges) goes with the bill.
  const total = decimal(linesTotal);
  const out = entries.map((entry) => {
    const amount = total > 0n ? roundMoney(div(mul(grand, entry.lineValue), total), 2) : 0n;
    covered = add(covered, amount);
    return { ...entry, amount };
  });
  const rest = grand - covered;
  if (rest > 0n && out.length) out[out.length - 1].amount = add(out[out.length - 1].amount, rest);
  return out;
}

// generateComplianceDeadlines: on posting a bill to a qualifying supplier, the statutory deadline of each acceptance it covers.
export async function generateComplianceDeadlines(client, context, billId) {
  const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`, [context.organizationId, billId])).rows[0];
  if (!bill || bill.bill_type !== "bill") return [];
  const existing = (await client.query(`SELECT count(*)::int AS count FROM tenant.supplier_payment_compliance_deadlines WHERE organization_id = $1 AND vendor_bill_id = $2`,
    [context.organizationId, bill.id])).rows[0].count;
  if (existing) return [];
  const supplier = await supplierClassification(client, context.organizationId, bill.supplier_id);
  const created = [];
  for (const acceptance of await acceptancesOf(client, context.organizationId, bill)) {
    const rule = statutoryRuleFor(supplier, acceptance.acceptanceDate);
    if (!rule.applies) continue;
    const due = addDays(acceptance.acceptanceDate, rule.statutoryDays);
    const row = (await client.query(
      `INSERT INTO tenant.supplier_payment_compliance_deadlines (organization_id, vendor_bill_id, goods_receipt_id, source_reference, classification_snapshot, acceptance_date, acceptance_basis,
         agreement_basis, agreed_days, statutory_days, statutory_due_date, applicable_amount, calculation_evidence, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14) RETURNING id`,
      [context.organizationId, bill.id, acceptance.receiptId, acceptance.reference, JSON.stringify(rule.snapshot), acceptance.acceptanceDate, acceptance.basis, rule.agreementBasis,
        rule.agreedDays, rule.statutoryDays, due, dec(acceptance.amount),
        JSON.stringify({ rule: rule.reason, acceptance: acceptance.receiptId ? `Goods receipt ${acceptance.reference} dated ${acceptance.acceptanceDate}` : `Bill ${acceptance.basis === "accepted" ? "acceptance" : "deemed acceptance"} ${acceptance.acceptanceDate}`,
          commercialTerms: bill.payment_term_snapshot?.name ?? null, billDueDate: dayOf(bill.due_date) }), context.userId ?? null])).rows[0];
    created.push(row.id);
  }
  return created;
}

// A reversed bill owes nothing: its deadlines are void (kept for the record).
export async function voidComplianceDeadlines(client, context, billId) {
  await client.query(`UPDATE tenant.supplier_payment_compliance_deadlines SET status = 'void' WHERE organization_id = $1 AND vendor_bill_id = $2 AND status = 'open'`, [context.organizationId, billId]);
}

// recordAcceptanceDispute: a documented objection to the goods or services. While open, the deadline is marked disputed; once resolved, the
// deadline counts again from the day the objection was resolved (the earlier one is kept, superseded). input: { reference, raisedOn?, resolvedOn? }
export async function recordAcceptanceDispute(client, context, deadlineId, input = {}) {
  if (!poCan(context, "accounting.payables.manage") && !poCan(context, "procurement.po.manage"))
    throw new PurchaseOrderError(403, "You do not have permission to record acceptance disputes.", "PERMISSION_DENIED");
  const row = (await client.query(`SELECT * FROM tenant.supplier_payment_compliance_deadlines WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, requireUuid(deadlineId, "Deadline")])).rows[0];
  if (!row || row.status !== "open") throw new PurchaseOrderError(404, "The statutory deadline was not found (or is no longer open).", "COMPLIANCE_DEADLINE_NOT_FOUND");
  const reference = text(input.reference, 300);
  if (!reference || reference.length < 3) fail("Enter the objection's reference (the documented objection).", "reference", "COMPLIANCE_DISPUTE_REFERENCE_REQUIRED");
  const raisedOn = readDate(input.raisedOn, "Objection raised on") ?? dayOf(row.dispute_raised_on) ?? await companyToday(client, context.organizationId);
  const resolvedOn = readDate(input.resolvedOn, "Objection resolved on");
  if (resolvedOn && resolvedOn < raisedOn) fail("The objection cannot be resolved before it was raised.", "resolvedOn");
  if (!resolvedOn) {
    await client.query(`UPDATE tenant.supplier_payment_compliance_deadlines SET disputed = true, dispute_reference = $3, dispute_raised_on = $4 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, reference, raisedOn]);
    return { id: row.id, disputed: true };
  }
  await client.query(`UPDATE tenant.supplier_payment_compliance_deadlines SET status = 'superseded', disputed = true, dispute_reference = $3, dispute_raised_on = $4, dispute_resolved_on = $5
     WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, reference, raisedOn, resolvedOn]);
  const next = (await client.query(
    `INSERT INTO tenant.supplier_payment_compliance_deadlines (organization_id, vendor_bill_id, goods_receipt_id, source_reference, classification_snapshot, acceptance_date, acceptance_basis,
       agreement_basis, agreed_days, statutory_days, statutory_due_date, applicable_amount, disputed, dispute_reference, dispute_raised_on, dispute_resolved_on, calculation_evidence, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'objection_resolved', $7, $8, $9, $10, $11, true, $12, $13, $6, $14::jsonb, $15) RETURNING id`,
    [context.organizationId, row.vendor_bill_id, row.goods_receipt_id, row.source_reference, JSON.stringify(row.classification_snapshot), resolvedOn, row.agreement_basis, row.agreed_days,
      row.statutory_days, addDays(resolvedOn, row.statutory_days), row.applicable_amount, reference, raisedOn,
      JSON.stringify({ ...row.calculation_evidence, acceptance: `Objection ${reference} raised ${raisedOn}, resolved ${resolvedOn}`, supersedes: row.id }), context.userId ?? null])).rows[0];
  return { id: next.id, supersedes: row.id, statutoryDueDate: addDays(resolvedOn, row.statutory_days) };
}

// The deadlines of a bill, as the schedule and reports show them: with what the bill still owes and whether the deadline is breached.
export async function complianceDeadlinesOf(client, context, billId, { today = null } = {}) {
  const day = today ?? await companyToday(client, context.organizationId);
  const bill = (await client.query(`SELECT outstanding_amount, grand_total, status FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`, [context.organizationId, billId])).rows[0];
  const rows = (await client.query(`SELECT * FROM tenant.supplier_payment_compliance_deadlines WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY acceptance_date, created_at`,
    [context.organizationId, billId])).rows;
  // What is still owed is taken against the earliest deadlines first (a payment settles the oldest obligation).
  let paid = bill ? decimal(bill.grand_total) - decimal(bill.outstanding_amount) : 0n;
  return rows.map((row) => {
    let outstanding = 0n;
    if (row.status === "open") {
      const amount = decimal(row.applicable_amount);
      const settled = paid >= amount ? amount : paid;
      paid -= settled;
      outstanding = amount - settled;
    }
    const due = dayOf(row.statutory_due_date);
    return {
      id: row.id, sourceReference: row.source_reference, goodsReceiptId: row.goods_receipt_id, acceptanceDate: dayOf(row.acceptance_date), acceptanceBasis: row.acceptance_basis,
      agreementBasis: row.agreement_basis, agreedDays: row.agreed_days, statutoryDays: row.statutory_days, statutoryDueDate: due, amount: dec(row.applicable_amount), outstanding: dec(outstanding),
      status: row.status, disputed: row.disputed, disputeReference: row.dispute_reference, disputeRaisedOn: dayOf(row.dispute_raised_on), disputeResolvedOn: dayOf(row.dispute_resolved_on),
      classification: row.classification_snapshot?.classification ?? null, evidence: row.calculation_evidence,
      compliance: row.status !== "open" ? row.status : outstanding <= 0n ? "settled" : row.disputed && !row.dispute_resolved_on ? "disputed" : due < day ? "breached" : due === day ? "due_today" : "within_deadline",
    };
  });
}
