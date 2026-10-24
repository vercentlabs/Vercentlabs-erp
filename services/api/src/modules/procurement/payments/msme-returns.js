// MSME-1 and the year-end figures (report Phase 3). MSME-1 is the half-yearly return to the Registrar (April–September by 31 October,
// October–March by 30 April) of what is owed to micro and small suppliers past their legal deadline (MSMED Act s.15: the agreed days, 45
// at most, else 15, from acceptance) at the end of the half: the supplier, PAN, Udyam number, the amount and the date it fell due. At 31
// March, the same dues are disallowed under Income Tax s.43B(h) until paid, and the accounts disclose what is owed to them and the
// interest under s.16 (compound, monthly rests, three times the bank rate). Amounts are each bill's, as paid by the period end: payments and
// credits applied up to that day, settled against a bill's earliest deadlines first.
import { add, decimal, formatDecimal } from "../../../core/decimal.js";
import { poCan } from "../purchase-orders/access.js";
import { requireBillAccess } from "../supplier-bills/bills.js";
import { BILL_PERMISSIONS, SupplierBillError, dayOf, fail, readDate } from "../supplier-bills/constants.js";

const dec = (value) => formatDecimal(value, 2);
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const DEFAULT_BANK_RATE = "6.5";

function requireAccess(context) {
  requireBillAccess(context);
  if (!poCan(context, "procurement.compliance.view") && !poCan(context, "accounting.payables.manage") && !poCan(context, BILL_PERMISSIONS.view))
    throw new SupplierBillError(403, "You do not have permission to view supplier payment compliance.", "PERMISSION_DENIED");
}

// Every micro or small deadline due by `asOf`, with what its bill still owed that day. Returns [{ ...row, outstanding (bigint) }].
async function duesAt(client, organizationId, asOf, { dueBy = asOf } = {}) {
  const rows = (await client.query(
    `SELECT deadline.*, bill.bill_number, bill.grand_total, btrim(bill.currency_code) AS currency_code, bill.supplier_id, bill.accounting_date,
            COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS supplier_invoice, party.display_name AS supplier_name, party.pan,
            supplier.msme_registration_number,
            COALESCE((SELECT sum(allocation.allocated_amount) FROM tenant.accounting_vendor_payment_allocations allocation
                        JOIN tenant.accounting_vendor_payments payment ON payment.organization_id = allocation.organization_id AND payment.id = allocation.payment_id
                       WHERE allocation.organization_id = bill.organization_id AND allocation.vendor_bill_id = bill.id AND payment.payment_date <= $2), 0)
          - COALESCE((SELECT sum(reversal.amount) FROM tenant.accounting_vendor_payment_allocation_reversals reversal
                       WHERE reversal.organization_id = bill.organization_id AND reversal.vendor_bill_id = bill.id AND reversal.reversed_at::date <= $2), 0)
          + COALESCE((SELECT sum(credit.allocated_amount) FROM tenant.accounting_vendor_credit_allocations credit
                       WHERE credit.organization_id = bill.organization_id AND credit.vendor_bill_id = bill.id AND credit.allocated_at::date <= $2), 0) AS settled_by_then
       FROM tenant.supplier_payment_compliance_deadlines deadline
       JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = deadline.organization_id AND bill.id = deadline.vendor_bill_id
       JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
       LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = bill.organization_id AND supplier.id = bill.supplier_id
      WHERE deadline.organization_id = $1 AND deadline.status NOT IN ('void', 'superseded') AND deadline.acceptance_date <= $2
        AND bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed') AND bill.accounting_date <= $2
        AND deadline.classification_snapshot->>'classification' IN ('micro', 'small')
      ORDER BY bill.id, deadline.acceptance_date, deadline.created_at`, [organizationId, asOf])).rows;
  const left = new Map();
  const out = [];
  for (const row of rows) {
    if (!left.has(row.vendor_bill_id)) left.set(row.vendor_bill_id, decimal(row.settled_by_then));
    const amount = decimal(row.applicable_amount);
    const settled = left.get(row.vendor_bill_id);
    const used = settled >= amount ? amount : settled > 0n ? settled : 0n;
    left.set(row.vendor_bill_id, settled - used);
    const outstanding = amount - used;
    // Disputed and not yet resolved by then: not due.
    const disputed = row.disputed && (!row.dispute_resolved_on || dayOf(row.dispute_resolved_on) > asOf);
    if (outstanding > 0n && !disputed) out.push({ ...row, outstanding, due: dayOf(row.statutory_due_date), overdue: dayOf(row.statutory_due_date) < dueBy });
  }
  return out;
}

// half: "2026-H1" (April–September 2026) or "2026-H2" (October 2026–March 2027). Returns { period, asOf, rows, total, csv, fileName }.
export async function msme1Return(client, context, { half } = {}) {
  requireAccess(context);
  const match = /^(\d{4})-H([12])$/.exec(String(half ?? ""));
  if (!match) fail("Choose the half-year.", "half");
  const year = Number(match[1]);
  const first = match[2] === "1";
  const from = first ? `${year}-04-01` : `${year}-10-01`;
  const asOf = first ? `${year}-09-30` : `${year + 1}-03-31`;
  const dues = (await duesAt(client, context.organizationId, asOf)).filter((row) => row.overdue);
  const rows = dues.map((row) => ({
    supplierId: row.supplier_id, supplierName: row.supplier_name, pan: row.pan ?? null, udyam: row.msme_registration_number ?? row.classification_snapshot?.registrationNumber ?? null,
    classification: row.classification_snapshot?.classification ?? null, billId: row.vendor_bill_id, billNumber: row.bill_number, supplierInvoice: row.supplier_invoice,
    acceptanceDate: dayOf(row.acceptance_date), dueDate: row.due, daysOverdue: days(row.due, asOf), amount: dec(row.outstanding), currencyCode: row.currency_code,
  }));
  const total = dues.reduce((sum, row) => add(sum, row.outstanding), 0n);
  const quote = (value) => { const raw = value === null || value === undefined ? "" : String(value); return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw; };
  const dmy = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "");
  const csv = [["Name of the supplier", "PAN", "Udyam registration number", "Classification", "Bill", "Supplier invoice", "Date of acceptance", "Amount due", "Date from which the amount is due",
    "Days past due", "Reason for the delay"],
    ...rows.map((row) => [row.supplierName, row.pan ?? "", row.udyam ?? "", row.classification ?? "", row.billNumber, row.supplierInvoice ?? "", dmy(row.acceptanceDate), row.amount,
      dmy(row.dueDate), row.daysOverdue, ""])].map((line) => line.map(quote).join(",")).join("\n");
  return { period: { half, from, to: asOf }, asOf, rows, total: dec(total), csv: `${csv}\n`, fileName: `MSME-1_${half}.csv` };
}

// The year-end figures at 31 March of the financial year that starts in April `year`: what is owed to micro and small suppliers, the part
// past its deadline (disallowed under s.43B(h) until paid) and the s.16 interest on it (an estimate at three times `bankRate`, % a year).
export async function msmeYearEnd(client, context, { year, bankRate = DEFAULT_BANK_RATE } = {}) {
  requireAccess(context);
  const start = Number(year);
  if (!Number.isInteger(start) || start < 2000 || start > 2100) fail("Choose the financial year.", "year");
  const rate = Number(bankRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 50) fail("Enter the bank rate (% a year).", "bankRate");
  const asOf = readDate(`${start + 1}-03-31`, "Year end");
  const dues = await duesAt(client, context.organizationId, asOf);
  // s.16: compound interest with monthly rests at three times the bank rate, from the day after the due date.
  const monthly = (rate * 3) / 100 / 12;
  let owed = 0n;
  let pastDue = 0n;
  let interest = 0;
  const suppliers = new Map();
  for (const row of dues) {
    owed = add(owed, row.outstanding);
    const entry = suppliers.get(row.supplier_id) ?? { supplierId: row.supplier_id, supplierName: row.supplier_name, udyam: row.msme_registration_number ?? null, owed: 0n, pastDue: 0n, interest: 0 };
    entry.owed = add(entry.owed, row.outstanding);
    if (row.overdue) {
      pastDue = add(pastDue, row.outstanding);
      entry.pastDue = add(entry.pastDue, row.outstanding);
      const late = days(row.due, asOf);
      const amount = Number(formatDecimal(row.outstanding, 2));
      const accrued = amount * ((1 + monthly) ** (late / 30.4375) - 1);
      interest += accrued;
      entry.interest += accrued;
    }
    suppliers.set(row.supplier_id, entry);
  }
  const money = (value) => (Math.round(value * 100) / 100).toFixed(2);
  return {
    asOf, bankRate: String(rate), interestRate: String(rate * 3), owed: dec(owed), pastDue: dec(pastDue), interest: money(interest),
    suppliers: [...suppliers.values()].sort((a, b) => (b.pastDue > a.pastDue ? 1 : b.pastDue < a.pastDue ? -1 : 0))
      .map((entry) => ({ ...entry, owed: dec(entry.owed), pastDue: dec(entry.pastDue), interest: money(entry.interest) })),
  };
}
