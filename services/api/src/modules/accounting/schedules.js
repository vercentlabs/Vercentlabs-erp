// A document's payment schedule: the shared payment-term engine applied to its total and dates. One document, one payable (or receivable);
// its instalments only say when each part of it is due. The schedule is fixed with the document; what remains of each instalment is
// what Finance's allocations leave.
import { generatePaymentSchedule, readTermSnapshot, snapshotOfTerm } from "../../core/payment-terms/terms.js";
import { AccountingError, asDatabaseDecimal, decimal, isoDate, roundMoney, uuid } from "./core.js";

const single = (dueDate, total, precision, extra = {}) => [{ sequence: 1, dueDate, percentage: asDatabaseDecimal(100), amount: roundMoney(decimal(total), precision), basis: "invoice_date",
  referenceDate: null, missing: false, rule: null, ...extra }];

// resolvePaymentSchedule. options: { documentDate, explicitDueDate?, paymentTermId?, partyPaymentTermId?, snapshot?, total, precision,
//   dates?: { invoiceReceivedDate?, postingDate? } }. Returns { dueDate (the last instalment's), paymentTermId, snapshot, installments, missingDates }.
// A rule counting from a date not recorded yet counts from the document date for now and is listed in missingDates: posting needs it.
export async function resolvePaymentSchedule(client, context, options) {
  const documentDate = isoDate(options.documentDate, "Document date");
  if (options.explicitDueDate) {
    const dueDate = isoDate(options.explicitDueDate, "Due date");
    return { dueDate, paymentTermId: null, snapshot: options.snapshot && typeof options.snapshot === "object" ? options.snapshot : {}, installments: single(dueDate, options.total, options.precision),
      missingDates: [] };
  }
  let snapshot = readTermSnapshot(options.snapshot) && (options.snapshot.rules || options.snapshot.lines || options.snapshot.calculationType) ? options.snapshot : null;
  let paymentTermId = options.paymentTermId || options.partyPaymentTermId || snapshot?.id || null;
  if (!snapshot && paymentTermId) {
    paymentTermId = uuid(paymentTermId, "Payment term");
    const term = (await client.query(
      `SELECT term.*, COALESCE(jsonb_agg(jsonb_build_object('sequence', line.sequence, 'percentage', line.percentage, 'basis', line.reference_basis, 'kind', line.rule_kind,
         'days', line.due_days, 'monthsOffset', line.months_offset, 'dayOfMonth', line.day_of_month) ORDER BY line.sequence) FILTER (WHERE line.id IS NOT NULL), '[]'::jsonb) AS rules
         FROM tenant.payment_terms term LEFT JOIN tenant.payment_term_lines line ON line.organization_id = term.organization_id AND line.payment_term_id = term.id
        WHERE term.organization_id = $1 AND term.id = $2 AND term.status = 'active' GROUP BY term.id`, [context.organizationId, paymentTermId])).rows[0];
    if (!term) throw new AccountingError(409, "The selected payment term is inactive or unavailable.");
    snapshot = snapshotOfTerm(term, term.term_type === "custom" ? [] : term.rules);
  }
  if (!snapshot) return { dueDate: documentDate, paymentTermId: null, snapshot: {}, installments: single(documentDate, options.total, options.precision), missingDates: [] };
  const term = readTermSnapshot(snapshot);
  // Terms described in words set no date: the document's due date is entered.
  if (!term.rules.length) throw new AccountingError(409, `Payment terms "${term.name}" do not set a due date. Enter the due date.`, "ACCOUNTING_DUE_DATE_REQUIRED");
  const dates = { invoiceDate: documentDate, invoiceReceivedDate: options.dates?.invoiceReceivedDate ?? null, postingDate: options.dates?.postingDate ?? documentDate };
  const schedule = generatePaymentSchedule(snapshot, { total: options.total, precision: options.precision, dates });
  if (decimal(options.total) <= 0n) throw new AccountingError(400, "Payment schedule total must be positive.");
  if (schedule.some((line) => line.amount <= 0n)) throw new AccountingError(409, "Each payment-term instalment must be greater than zero.");
  const missingDates = [...new Set(schedule.filter((line) => line.missing).map((line) => line.basis))];
  const installments = schedule.map((line) => {
    const provisional = line.missing ? generatePaymentSchedule({ ...snapshot, rules: [{ ...line.rule, basis: "invoice_date", percentage: "100" }] }, { total: "1", dates })[0] : null;
    return { sequence: line.sequence, percentage: asDatabaseDecimal(decimal(line.percentage)), amount: line.amount, dueDate: line.dueDate ?? provisional.dueDate,
      referenceDate: line.referenceDate ?? documentDate, basis: line.basis, missing: line.missing, rule: line.rule };
  });
  return {
    dueDate: installments.reduce((latest, line) => (line.dueDate > latest ? line.dueDate : latest), installments[0].dueDate),
    paymentTermId: term.id, missingDates,
    snapshot: { ...snapshot, lines: installments.map((line) => ({ sequence: line.sequence, dueDate: line.dueDate, percentage: line.percentage, amount: asDatabaseDecimal(line.amount),
      basis: line.basis, referenceDate: line.referenceDate, missing: line.missing })) },
    installments,
  };
}

// The schedule rows of a vendor bill or customer invoice: each instalment with its share, the date it counted from and its original due date.
export async function writeDocumentSchedule(client, context, table, column, documentId, installments) {
  for (const line of installments)
    await client.query(
      `INSERT INTO tenant.${table} (organization_id, ${column}, sequence, due_date, amount, outstanding_amount${table === "accounting_vendor_bill_schedules"
        ? ", percentage, reference_basis, reference_date, original_due_date, rule_snapshot" : ""}) VALUES ($1, $2, $3, $4, $5, $5${table === "accounting_vendor_bill_schedules" ? ", $6, $7, $8, $4, $9::jsonb" : ""})`,
      [context.organizationId, documentId, line.sequence, line.dueDate, asDatabaseDecimal(line.amount),
        ...(table === "accounting_vendor_bill_schedules" ? [line.percentage, line.basis ?? "invoice_date", line.referenceDate ?? null, line.rule ? JSON.stringify(line.rule) : null] : [])]);
}
