// A supplier bill's payment schedule — the due obligations its payment terms gave when it was posted — and what Finance's settlements left of
// each. One bill is one payable: instalments only say when each part is due. Payments, advances and vendor credits are allocated by
// Finance (the oldest due first, or the instalment chosen); what remains of each instalment is what those allocations leave, never typed in.
//
// Reschedules: an authorised commercial extension of one instalment — requested with a reason, approved by Finance (never by whoever
// asked). The original due date is kept beside the one in force, and the statutory deadline never moves with it.
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { companyToday, getSupplierDefaultPaymentTerm, purchaseTermSnapshot, readTermSnapshot } from "../../../core/payment-terms/index.js";
import { addDays } from "../../../core/payment-terms/terms.js";
import { PurchaseOrderError, dayOf, fail, isUuid, readDate, requireUuid, text } from "../purchase-orders/constants.js";
import { poCan } from "../purchase-orders/access.js";
import { complianceDeadlinesOf, requireComplianceView } from "./statutory.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const POSTED = ["posted", "partially_paid", "paid", "overdue", "disputed"];
const POSTED_SQL = "('posted', 'partially_paid', 'paid', 'overdue', 'disputed')";

export function requireScheduleView(context) {
  if (!["procurement.bills.view", "accounting.payables.manage", "accounting.payables.approve", "accounting.payments.manage", "accounting.view"].some((permission) => poCan(context, permission)))
    throw new PurchaseOrderError(403, "You do not have permission to view payment schedules.", "PERMISSION_DENIED");
}

async function loadBill(client, context, billId, { lock = false } = {}) {
  const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(billId, "Supplier bill")])).rows[0];
  if (!bill || bill.bill_type !== "bill") throw new PurchaseOrderError(404, "Supplier bill not found.", "SUPPLIER_BILL_NOT_FOUND");
  return bill;
}

const scheduleState = (row, posted, today) => {
  if (!posted) return "draft";
  const outstanding = decimal(row.outstanding_amount);
  if (outstanding <= 0n) return "paid";
  const due = dayOf(row.due_date);
  if (due < today) return "overdue";
  if (due === today) return "due_today";
  return outstanding < decimal(row.amount) ? "partially_paid" : "upcoming";
};

// getSupplierBillPaymentSchedule: each instalment (share, scheduled, settled, outstanding, original and current due dates, the date it
// counted from), the reschedules, the statutory deadlines and whether the schedule reconciles to Accounts Payable.
export async function getSupplierBillPaymentSchedule(client, context, billId) {
  requireScheduleView(context);
  const bill = await loadBill(client, context, billId);
  const today = await companyToday(client, context.organizationId);
  const posted = POSTED.includes(bill.status);
  const rows = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_schedules WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY sequence`,
    [context.organizationId, bill.id])).rows;
  const changes = (await client.query(
    `SELECT change.*, requester.full_name AS requested_by_name, decider.full_name AS decided_by_name FROM tenant.accounting_vendor_bill_schedule_changes change
       LEFT JOIN public.users requester ON requester.id = change.requested_by LEFT JOIN public.users decider ON decider.id = change.decided_by
      WHERE change.organization_id = $1 AND change.vendor_bill_id = $2 ORDER BY change.requested_at`, [context.organizationId, bill.id])).rows;
  const term = readTermSnapshot(bill.payment_term_snapshot);
  const scheduled = rows.reduce((total, row) => add(total, decimal(row.amount)), 0n);
  const outstanding = rows.reduce((total, row) => add(total, decimal(row.outstanding_amount)), 0n);
  const compliance = posted && (poCan(context, "procurement.compliance.view") || poCan(context, "accounting.payables.manage")) ? await complianceDeadlinesOf(client, context, bill.id, { today }) : [];
  const canRequest = posted && decimal(bill.outstanding_amount) > 0n && (poCan(context, "accounting.payables.manage") || poCan(context, "accounting.payables.approve"));
  return {
    billId: bill.id, billNumber: bill.bill_number, currencyCode: bill.currency_code.trim(), status: bill.status, today,
    paymentTerm: term ? { id: term.id, code: term.code, name: term.name, termType: term.termType, termTypeLabel: term.termTypeLabel, summary: term.summary, version: term.version,
      advancePercentage: term.advancePercentage } : null,
    invoiceDate: dayOf(bill.bill_date), invoiceReceivedDate: dayOf(bill.invoice_received_date), postingDate: dayOf(bill.accounting_date), summaryDueDate: dayOf(bill.due_date),
    supplierStatedTerms: bill.supplier_stated_terms, paymentTermChangeReason: bill.payment_term_change_reason,
    installments: rows.map((row) => ({
      id: row.id, installment: row.sequence, percentage: row.percentage === null ? null : String(Number(row.percentage)), basis: row.reference_basis, referenceDate: dayOf(row.reference_date),
      scheduled: dec(row.amount), settled: dec(sub(decimal(row.amount), decimal(row.outstanding_amount))), outstanding: dec(row.outstanding_amount),
      originalDueDate: dayOf(row.original_due_date ?? row.due_date), dueDate: dayOf(row.due_date), rescheduled: dayOf(row.original_due_date ?? row.due_date) !== dayOf(row.due_date),
      state: scheduleState(row, posted, today),
      pendingReschedule: changes.some((change) => change.schedule_id === row.id && change.status === "requested"),
    })),
    totals: { scheduled: dec(scheduled), settled: dec(sub(scheduled, outstanding)), outstanding: dec(outstanding), billOutstanding: dec(posted ? bill.outstanding_amount : bill.grand_total),
      reconciled: !posted || outstanding === decimal(bill.outstanding_amount) },
    reschedules: changes.map((change) => ({ id: change.id, scheduleId: change.schedule_id, previousDueDate: dayOf(change.previous_due_date), requestedDueDate: dayOf(change.requested_due_date),
      reason: change.reason, status: change.status, requestedBy: change.requested_by_name, requestedAt: change.requested_at, decidedBy: change.decided_by_name, decidedAt: change.decided_at,
      decisionNote: change.decision_note, canDecide: change.status === "requested" && poCan(context, "accounting.payables.reschedule") && change.requested_by !== context.userId })),
    compliance,
    actions: { requestReschedule: canRequest, recordPayment: posted && decimal(bill.outstanding_amount) > 0n && poCan(context, "accounting.payments.manage") },
  };
}

// requestPaymentReschedule: a revised due date for one open instalment of a posted bill. input: { scheduleId, newDueDate, reason }
export async function requestPaymentReschedule(client, context, billId, input = {}) {
  if (!poCan(context, "accounting.payables.manage") && !poCan(context, "accounting.payables.approve"))
    throw new PurchaseOrderError(403, "You do not have permission to request payment reschedules.", "PERMISSION_DENIED");
  const bill = await loadBill(client, context, billId, { lock: true });
  if (!POSTED.includes(bill.status)) throw new PurchaseOrderError(409, "Only a posted bill's schedule is rescheduled; a draft's terms are simply changed.", "PAYMENT_RESCHEDULE_NOT_POSTED");
  const schedule = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_schedules WHERE organization_id = $1 AND vendor_bill_id = $2 AND id = $3 FOR UPDATE`,
    [context.organizationId, bill.id, requireUuid(input.scheduleId, "Instalment")])).rows[0];
  if (!schedule) throw new PurchaseOrderError(404, "That instalment is not on this bill.", "PAYMENT_RESCHEDULE_INVALID");
  if (decimal(schedule.outstanding_amount) <= 0n) fail("That instalment is settled.", "scheduleId", "PAYMENT_RESCHEDULE_SETTLED", 409);
  const newDueDate = readDate(input.newDueDate, "New due date");
  if (!newDueDate) fail("Enter the new due date.", "newDueDate", "PAYMENT_RESCHEDULE_DATE_REQUIRED");
  if (newDueDate === dayOf(schedule.due_date)) fail("That is the due date already.", "newDueDate", "PAYMENT_RESCHEDULE_DATE_REQUIRED");
  if (newDueDate < dayOf(bill.bill_date)) fail("A due date cannot be before the invoice date.", "newDueDate", "PAYMENT_RESCHEDULE_DATE_INVALID");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 10) fail("Give the reason for the reschedule (at least 10 characters): the supplier's agreement, its reference.", "reason", "PAYMENT_RESCHEDULE_REASON_REQUIRED");
  const pending = (await client.query(`SELECT 1 FROM tenant.accounting_vendor_bill_schedule_changes WHERE organization_id = $1 AND schedule_id = $2 AND status = 'requested'`,
    [context.organizationId, schedule.id])).rows[0];
  if (pending) fail("A reschedule of this instalment is already awaiting approval.", "scheduleId", "PAYMENT_RESCHEDULE_PENDING", 409);
  const row = (await client.query(
    `INSERT INTO tenant.accounting_vendor_bill_schedule_changes (organization_id, vendor_bill_id, schedule_id, previous_due_date, requested_due_date, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [context.organizationId, bill.id, schedule.id, dayOf(schedule.due_date), newDueDate, reason, context.userId ?? null])).rows[0];
  await accountingEvent(client, context, bill.id, "accounting.vendor_bill.reschedule_requested", { scheduleId: schedule.id, from: dayOf(schedule.due_date), to: newDueDate, reason });
  // Whoever may approve reschedules decides it — never the one who asked; their request is approved by someone else.
  return { id: row.id, status: "requested" };
}

// approvePaymentReschedule / rejectPaymentReschedule: Finance decides a requested reschedule. input: { note? }
export async function approvePaymentReschedule(client, context, changeId, input = {}) {
  return decide(client, context, changeId, "approved", input);
}
export async function rejectPaymentReschedule(client, context, changeId, input = {}) {
  return decide(client, context, changeId, "rejected", input);
}
async function decide(client, context, changeId, decision, input) {
  if (!poCan(context, "accounting.payables.reschedule")) throw new PurchaseOrderError(403, "You do not have permission to approve payment reschedules.", "PERMISSION_DENIED");
  const change = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_schedule_changes WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, requireUuid(changeId, "Reschedule")])).rows[0];
  if (!change) throw new PurchaseOrderError(404, "Reschedule request not found.", "PAYMENT_RESCHEDULE_NOT_FOUND");
  if (change.status !== "requested") return { id: change.id, status: change.status, replayed: true };
  if (change.requested_by && change.requested_by === context.userId) throw new PurchaseOrderError(403, "A reschedule is approved by someone other than whoever requested it.", "PAYMENT_RESCHEDULE_SELF_APPROVAL");
  const note = text(input.note, 1000);
  if (decision === "rejected" && (!note || note.length < 3)) fail("Give the reason for rejecting it.", "note", "PAYMENT_RESCHEDULE_NOTE_REQUIRED");
  await loadBill(client, context, change.vendor_bill_id, { lock: true });
  if (decision === "approved") {
    const schedule = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_schedules WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, change.schedule_id])).rows[0];
    if (dayOf(schedule.due_date) !== dayOf(change.previous_due_date)) fail("The instalment's due date changed since the request; ask again.", "id", "PAYMENT_RESCHEDULE_STALE", 409);
    await client.query(`UPDATE tenant.accounting_vendor_bill_schedules SET original_due_date = COALESCE(original_due_date, due_date), due_date = $3, version = version + 1
       WHERE organization_id = $1 AND id = $2`, [context.organizationId, schedule.id, dayOf(change.requested_due_date)]);
    // The bill's summary due date is the last instalment's.
    await client.query(`UPDATE tenant.accounting_vendor_bills SET due_date = (SELECT max(due_date) FROM tenant.accounting_vendor_bill_schedules WHERE organization_id = $1 AND vendor_bill_id = $2),
       updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, change.vendor_bill_id, context.userId ?? null]);
  }
  await client.query(`UPDATE tenant.accounting_vendor_bill_schedule_changes SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, change.id, decision, context.userId ?? null, note]);
  await accountingEvent(client, context, change.vendor_bill_id, `accounting.vendor_bill.reschedule_${decision}`,
    { scheduleId: change.schedule_id, from: dayOf(change.previous_due_date), to: dayOf(change.requested_due_date), note });
  return { id: change.id, status: decision, replayed: false };
}

async function accountingEvent(client, context, billId, eventType, metadata) {
  await client.query(`INSERT INTO tenant.accounting_events (organization_id, entity_type, entity_id, event_type, metadata, actor_user_id) VALUES ($1, 'vendor_bill', $2, $3, $4::jsonb, $5)`,
    [context.organizationId, billId, eventType, JSON.stringify(metadata), context.userId ?? null]);
}

// The open instalments of posted bills, with their supplier — for the obligation reports and installment-level aging.
async function openInstalments(client, context, filters = {}) {
  const values = [context.organizationId];
  let where = "";
  if (isUuid(filters.supplierId)) { values.push(filters.supplierId); where += ` AND bill.supplier_id = $${values.length}`; }
  return (await client.query(
    `SELECT schedule.id, schedule.sequence, schedule.due_date, schedule.original_due_date, schedule.amount, schedule.outstanding_amount, bill.id AS bill_id, bill.bill_number,
            bill.supplier_invoice_reference, bill.supplier_id, btrim(bill.currency_code) AS currency_code, party.display_name AS supplier_name,
            (SELECT count(*) FROM tenant.accounting_vendor_bill_schedules other WHERE other.organization_id = schedule.organization_id AND other.vendor_bill_id = schedule.vendor_bill_id)::int AS instalments
       FROM tenant.accounting_vendor_bill_schedules schedule
       JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = schedule.organization_id AND bill.id = schedule.vendor_bill_id
       JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
      WHERE schedule.organization_id = $1 AND bill.bill_type = 'bill' AND bill.status IN ${POSTED_SQL} AND schedule.outstanding_amount > 0${where}
      ORDER BY schedule.due_date, bill.bill_number, schedule.sequence`, values)).rows;
}
const obligation = (row, today) => ({
  scheduleId: row.id, billId: row.bill_id, billNumber: row.bill_number, supplierInvoice: row.supplier_invoice_reference, supplierId: row.supplier_id, supplierName: row.supplier_name,
  installment: row.sequence, installments: row.instalments, currencyCode: row.currency_code, dueDate: dayOf(row.due_date), originalDueDate: dayOf(row.original_due_date ?? row.due_date),
  scheduled: dec(row.amount), outstanding: dec(row.outstanding_amount), daysOverdue: Math.max(0, Math.round((Date.parse(today) - Date.parse(dayOf(row.due_date))) / 86400000)),
  href: `/procurement/supplier-bills/${row.bill_id}`,
});

// getOverdueSupplierObligations: open instalments past their due date (the company's local date), and statutory deadlines breached.
// filters: { supplierId? }
export async function getOverdueSupplierObligations(client, context, filters = {}) {
  requireScheduleView(context);
  const today = await companyToday(client, context.organizationId);
  const rows = (await openInstalments(client, context, filters)).filter((row) => dayOf(row.due_date) < today);
  let statutory = [];
  if (poCan(context, "procurement.compliance.view") || poCan(context, "accounting.payables.manage")) {
    requireComplianceView(context);
    const bills = (await client.query(
      `SELECT DISTINCT deadline.vendor_bill_id FROM tenant.supplier_payment_compliance_deadlines deadline JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = deadline.organization_id
         AND bill.id = deadline.vendor_bill_id WHERE deadline.organization_id = $1 AND deadline.status = 'open' AND deadline.statutory_due_date < $2 AND bill.outstanding_amount > 0
         ${isUuid(filters.supplierId) ? "AND bill.supplier_id = $3" : ""}`, [context.organizationId, today, ...(isUuid(filters.supplierId) ? [filters.supplierId] : [])])).rows;
    for (const bill of bills) {
      const info = (await client.query(`SELECT bill.bill_number, bill.supplier_id, party.display_name FROM tenant.accounting_vendor_bills bill JOIN tenant.business_parties party
         ON party.organization_id = bill.organization_id AND party.id = bill.party_id WHERE bill.organization_id = $1 AND bill.id = $2`, [context.organizationId, bill.vendor_bill_id])).rows[0];
      for (const deadline of await complianceDeadlinesOf(client, context, bill.vendor_bill_id, { today }))
        if (deadline.compliance === "breached") statutory.push({ ...deadline, billId: bill.vendor_bill_id, billNumber: info.bill_number, supplierId: info.supplier_id, supplierName: info.display_name,
          href: `/procurement/supplier-bills/${bill.vendor_bill_id}` });
    }
  }
  return { today, obligations: rows.map((row) => obligation(row, today)), statutory };
}

// getUpcomingSupplierPayments: open instalments due from today to `days` ahead (default 30). filters: { supplierId?, days? }
export async function getUpcomingSupplierPayments(client, context, filters = {}) {
  requireScheduleView(context);
  const today = await companyToday(client, context.organizationId);
  const until = addDays(today, Math.min(Math.max(Number(filters.days) || 30, 1), 365));
  const rows = (await openInstalments(client, context, filters)).filter((row) => dayOf(row.due_date) >= today && dayOf(row.due_date) <= until);
  return { today, until, obligations: rows.map((row) => ({ ...obligation(row, today), dueToday: dayOf(row.due_date) === today })) };
}

// getSupplierInstallmentAging: AP aging by instalment due date (the company's local date): due today, not yet due, and overdue buckets.
export async function getSupplierInstallmentAging(client, context, filters = {}) {
  requireScheduleView(context);
  const today = await companyToday(client, context.organizationId);
  const groups = new Map();
  for (const row of await openInstalments(client, context, filters)) {
    const key = `${row.supplier_id}|${row.currency_code}`;
    const group = groups.get(key) ?? { supplierId: row.supplier_id, supplierName: row.supplier_name, currencyCode: row.currency_code, notDue: 0n, dueToday: 0n, days1to30: 0n, days31to60: 0n,
      days61to90: 0n, over90: 0n, total: 0n };
    const days = Math.round((Date.parse(today) - Date.parse(dayOf(row.due_date))) / 86400000);
    const amount = decimal(row.outstanding_amount);
    const bucket = days < 0 ? "notDue" : days === 0 ? "dueToday" : days <= 30 ? "days1to30" : days <= 60 ? "days31to60" : days <= 90 ? "days61to90" : "over90";
    group[bucket] = add(group[bucket], amount);
    group.total = add(group.total, amount);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (b.total > a.total ? 1 : -1)).map((group) => Object.fromEntries(Object.entries(group).map(([key, value]) => [key, typeof value === "bigint" ? dec(value) : value])));
}

// recalculatePaymentScheduleSettlement: checks that a posted bill's instalments still add up to what Accounts Payable says it owes; when
// they do not (a settlement recorded outside the schedule), the difference is spread oldest instalment first. Returns { reconciled, adjusted }.
export async function recalculatePaymentScheduleSettlement(client, context, billId) {
  if (!poCan(context, "accounting.payables.manage")) throw new PurchaseOrderError(403, "You do not have permission to reconcile payment schedules.", "PERMISSION_DENIED");
  const bill = await loadBill(client, context, billId, { lock: true });
  const rows = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_schedules WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY due_date, sequence FOR UPDATE`,
    [context.organizationId, bill.id])).rows;
  const target = POSTED.includes(bill.status) ? decimal(bill.outstanding_amount) : bill.status === "reversed" ? 0n : decimal(bill.grand_total);
  const current = rows.reduce((total, row) => add(total, decimal(row.outstanding_amount)), 0n);
  if (current === target) return { reconciled: true, adjusted: false };
  // Settled amounts are taken from the earliest instalments: what is still owed sits on the latest ones.
  let remaining = target;
  for (const row of [...rows].reverse()) {
    const amount = decimal(row.amount);
    const owed = remaining >= amount ? amount : remaining;
    remaining = sub(remaining, owed);
    await client.query(`UPDATE tenant.accounting_vendor_bill_schedules SET outstanding_amount = $3, status = $4 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, dec(owed), owed <= 0n ? "paid" : owed < amount ? "partially_paid" : "open"]);
  }
  await accountingEvent(client, context, bill.id, "accounting.vendor_bill.schedule_reconciled", { from: dec(current), to: dec(target) });
  return { reconciled: true, adjusted: true, from: dec(current), to: dec(target) };
}

// resolvePurchaseOrderPaymentTerm: the terms a new order with this supplier starts from — the supplier's own, else the company default.
export async function resolvePurchaseOrderPaymentTerm(client, context, { supplierId, buyingRegistrationId = null } = {}) {
  const resolved = await getSupplierDefaultPaymentTerm(client, context.organizationId, requireUuid(supplierId, "Supplier"));
  if (!resolved.paymentTermId) return { paymentTermId: null, source: null, snapshot: null };
  return { ...resolved, snapshot: await purchaseTermSnapshot(client, context.organizationId, resolved.paymentTermId, null, { buyingRegistrationId }) };
}

// resolveSupplierBillPaymentTerm: the agreed terms of a bill — the confirmed order's snapshot for an order bill, else the supplier's own,
// else the company default. Returns { paymentTermId, source, snapshot }.
export async function resolveSupplierBillPaymentTerm(client, context, { purchaseOrderId = null, supplierId = null } = {}) {
  if (purchaseOrderId) {
    const order = (await client.query(`SELECT payment_term_id, payment_term_snapshot FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, requireUuid(purchaseOrderId, "Purchase order")])).rows[0];
    if (order?.payment_term_id) return { paymentTermId: order.payment_term_id, source: "purchase_order", snapshot: order.payment_term_snapshot };
  }
  if (!supplierId) return { paymentTermId: null, source: null, snapshot: null };
  return resolvePurchaseOrderPaymentTerm(client, context, { supplierId });
}

// getSupplierPaymentTermHistory: a supplier's default-term changes, and the terms its orders and bills were agreed with.
export async function getSupplierPaymentTermHistory(client, context, supplierId) {
  requireScheduleView(context);
  const id = requireUuid(supplierId, "Supplier");
  const changes = (await client.query(
    `SELECT event.summary, event.changes AS details, event.occurred_at, actor.full_name AS actor FROM tenant.procurement_supplier_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.supplier_id = $2 AND event.event_type = 'supplier.payment_terms_changed' ORDER BY event.occurred_at DESC`, [context.organizationId, id]))
    .rows.map((row) => ({ summary: row.summary, details: row.details, at: row.occurred_at, actor: row.actor }));
  const orders = (await client.query(
    `SELECT id, purchase_order_number, status, order_date, payment_term_snapshot, advance_percentage FROM tenant.purchase_orders WHERE organization_id = $1 AND supplier_id = $2
      ORDER BY order_date DESC LIMIT 50`, [context.organizationId, id])).rows.map((row) => ({ id: row.id, number: row.purchase_order_number, status: row.status, date: dayOf(row.order_date),
    term: readTermSnapshot(row.payment_term_snapshot)?.name ?? null, summary: readTermSnapshot(row.payment_term_snapshot)?.summary ?? null,
    advancePercentage: row.advance_percentage === null ? null : String(Number(row.advance_percentage)), href: `/procurement/purchase-orders/${row.id}` }));
  const bills = (await client.query(
    `SELECT id, bill_number, status, bill_date, due_date, payment_term_snapshot, payment_term_change_reason FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND supplier_id = $2
       AND bill_type = 'bill' ORDER BY bill_date DESC LIMIT 50`, [context.organizationId, id])).rows.map((row) => ({ id: row.id, number: row.bill_number, status: row.status,
    date: dayOf(row.bill_date), dueDate: dayOf(row.due_date), term: readTermSnapshot(row.payment_term_snapshot)?.name ?? null, changeReason: row.payment_term_change_reason,
    href: `/procurement/supplier-bills/${row.id}` }));
  return { supplierId: id, changes, orders, bills };
}
