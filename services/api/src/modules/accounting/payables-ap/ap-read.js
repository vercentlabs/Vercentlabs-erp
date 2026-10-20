// Payables reads (Finance MVP F5): the bills owed to suppliers, the payments (with their approval state) and what each settled, and the
// payment form's choices.
import { ACCOUNTING_PERMISSIONS, AccountingError, isoDate, requirePermission, text, uuid } from "../core.js";
import { localToday } from "../journals.js";
import { openBillsFor } from "./ap-commands.js";

const OPEN = ["posted", "partially_paid", "overdue", "disputed"];
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const day = (value) => (value ? isoDate(value) : null);

// Bills and supplier credits as Finance sees them: what is still owed, when it falls due, and the Procurement document behind each.
export async function listPayableBills(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const where = [];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const open = () => `bill.status = ANY(${bind(OPEN)}::text[]) AND bill.outstanding_amount > 0`;
  if (filters.view === "open") where.push(`${open()} AND bill.bill_type <> 'credit_note'`);
  else if (filters.view === "overdue") where.push(`${open()} AND bill.bill_type <> 'credit_note' AND bill.due_date < ${bind(localToday())}::date`);
  else if (filters.view === "due_soon") where.push(`${open()} AND bill.bill_type <> 'credit_note' AND bill.due_date BETWEEN ${bind(localToday())}::date AND $${values.length}::date + 7`);
  else if (filters.view === "credits") where.push(`bill.bill_type = 'credit_note' AND bill.status NOT IN ('draft', 'cancelled', 'pending_approval', 'approved')`);
  else if (filters.view === "paid") where.push("bill.status = 'paid'");
  else where.push("bill.status NOT IN ('draft', 'cancelled', 'pending_approval', 'approved')");
  if (filters.partyId) where.push(`bill.party_id = ${bind(uuid(filters.partyId, "Supplier"))}`);
  if (filters.search) { const term = bind(`%${text(filters.search, 100)}%`); where.push(`(bill.bill_number ILIKE ${term} OR bill.supplier_invoice_number ILIKE ${term} OR party.display_name ILIKE ${term})`); }
  const rows = (await client.query(
    `SELECT bill.id, bill.bill_number, bill.supplier_invoice_number, bill.bill_type, bill.bill_date, bill.due_date, bill.currency_code, bill.grand_total, bill.outstanding_amount,
            bill.exchange_rate, bill.status, bill.party_id, party.display_name AS party_name,
            (SELECT COALESCE(sum((planned ->> 'amount')::numeric), 0) FROM tenant.accounting_vendor_payments payment, jsonb_array_elements(payment.planned_allocations) planned
              WHERE payment.organization_id = bill.organization_id AND payment.status IN ('draft', 'pending_approval', 'approved') AND planned ->> 'billId' = bill.id::text) AS in_payment
       FROM tenant.accounting_vendor_bills bill
       JOIN tenant.business_parties party ON party.id = bill.party_id
      WHERE bill.organization_id = $1 AND ${where.join(" AND ")}
      ORDER BY bill.due_date NULLS LAST, bill.bill_date DESC LIMIT 500`, values)).rows;
  const today = localToday();
  return rows.map((row) => {
    const due = day(row.due_date);
    const isOpen = OPEN.includes(row.status) && Number(row.outstanding_amount) > 0;
    const credit = row.bill_type === "credit_note";
    const daysOverdue = isOpen && !credit && due && due < today ? Math.round((Date.parse(today) - Date.parse(due)) / 86400000) : 0;
    return {
      id: row.id, number: row.bill_number, supplierInvoice: row.supplier_invoice_number, type: row.bill_type, date: day(row.bill_date), dueDate: due, currency: String(row.currency_code).trim(),
      total: money(row.grand_total), outstanding: money(row.outstanding_amount), baseOutstanding: money(Number(row.outstanding_amount) * Number(row.exchange_rate ?? 1)),
      inPayment: money(row.in_payment), status: row.status === "posted" && daysOverdue > 0 ? "overdue" : row.status, daysOverdue, partyId: row.party_id, party: row.party_name,
      href: credit ? `/procurement/debit-notes-credits/vendor-credits/${row.id}` : `/procurement/supplier-bills/${row.id}`,
    };
  });
}

function paymentView(row) {
  return {
    id: row.id, number: row.payment_number, date: day(row.payment_date), partyId: row.party_id, party: row.party_name, currency: String(row.currency_code).trim(),
    amount: money(row.amount), unapplied: ["posted", "partially_applied"].includes(row.status) ? money(row.unapplied_amount) : 0,
    applied: ["posted", "partially_applied", "applied"].includes(row.status) ? money(Number(row.amount) - Number(row.unapplied_amount)) : 0,
    planned: (row.planned_allocations ?? []).reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0),
    method: row.payment_method, reference: row.external_reference, status: row.status, account: row.account_label ?? null, notes: row.notes ?? null,
    submittedById: row.submitted_by ?? null, submittedBy: row.submitted_by_name ?? null, approvedBy: row.approved_by_name ?? null, approvedAt: row.approved_at, contentHash: row.content_hash,
    journalEntryId: row.journal_entry_id, reversedAt: row.reversed_at, reversalReason: row.reversal_reason, reversalJournalEntryId: row.reversal_journal_entry_id,
    cancelReason: row.cancel_reason ?? null, createdBy: row.created_by_name ?? null, createdAt: row.created_at,
  };
}

const PAYMENT_SELECT = `SELECT payment.*, party.display_name AS party_name, creator.full_name AS created_by_name, submitter.full_name AS submitted_by_name, approver.full_name AS approved_by_name,
         COALESCE(bank.account_name || COALESCE(' · ' || NULLIF(bank.bank_name, ''), ''), 'Main bank (Posting accounts)') AS account_label
    FROM tenant.accounting_vendor_payments payment
    JOIN tenant.business_parties party ON party.id = payment.party_id
    LEFT JOIN public.users creator ON creator.id = payment.created_by
    LEFT JOIN public.users submitter ON submitter.id = payment.submitted_by
    LEFT JOIN public.users approver ON approver.id = payment.approved_by
    LEFT JOIN tenant.accounting_bank_accounts bank ON bank.id = payment.bank_account_id`;

export async function listVendorPayments(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const where = [];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.view === "approval") where.push("payment.status = 'pending_approval'");
  else if (filters.view === "to_post") where.push("payment.status IN ('approved', 'draft')");
  else if (filters.view === "unapplied") where.push("payment.status IN ('posted', 'partially_applied') AND payment.unapplied_amount > 0");
  else if (filters.view === "reversed") where.push("payment.status IN ('reversed', 'cancelled')");
  else where.push("payment.status <> 'cancelled'");
  if (filters.partyId) where.push(`payment.party_id = ${bind(uuid(filters.partyId, "Supplier"))}`);
  if (filters.from) where.push(`payment.payment_date >= ${bind(isoDate(filters.from, "From"))}::date`);
  if (filters.to) where.push(`payment.payment_date <= ${bind(isoDate(filters.to, "To"))}::date`);
  if (filters.search) { const term = bind(`%${text(filters.search, 100)}%`); where.push(`(payment.payment_number ILIKE ${term} OR party.display_name ILIKE ${term} OR payment.external_reference ILIKE ${term})`); }
  return (await client.query(`${PAYMENT_SELECT} WHERE payment.organization_id = $1 AND ${where.join(" AND ")} ORDER BY payment.payment_date DESC, payment.created_at DESC LIMIT 500`, values))
    .rows.map(paymentView);
}

const HISTORY = {
  "accounting.vendor_payment.created": "Prepared", "accounting.vendor_payment.submitted": "Sent for approval", "accounting.vendor_payment.auto_approved": "Approved (no approval needed)",
  "accounting.vendor_payment.approved": "Approved", "accounting.vendor_payment.rejected": "Sent back", "accounting.vendor_payment.posted": "Posted to the accounts",
  "accounting.vendor_payment.allocated": "Applied to bills", "accounting.vendor_payment.application_undone": "Application undone", "accounting.vendor_payment.plan_adjusted": "Applied with changes",
  "accounting.vendor_payment.reversed": "Reversed", "accounting.vendor_payment.discarded": "Discarded",
};

export async function getVendorPaymentRecord(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const row = (await client.query(`${PAYMENT_SELECT} WHERE payment.organization_id = $1 AND payment.id = $2`, [context.organizationId, uuid(idValue, "Payment")])).rows[0];
  if (!row) throw new AccountingError(404, "Payment not found.", "ACCOUNTING_PAYMENT_NOT_FOUND");
  const allocations = (await client.query(
    `SELECT allocation.id, allocation.payment_amount, allocation.allocated_amount, allocation.allocated_at, bill.id AS bill_id, bill.bill_number, bill.supplier_invoice_number,
            creator.full_name AS created_by_name, undone.reversed_at AS undone_at, undone.reason AS undone_reason, undoer.full_name AS undone_by
       FROM tenant.accounting_vendor_payment_allocations allocation
       JOIN tenant.accounting_vendor_bills bill ON bill.id = allocation.vendor_bill_id
       LEFT JOIN public.users creator ON creator.id = allocation.created_by
       LEFT JOIN tenant.accounting_vendor_payment_allocation_reversals undone ON undone.organization_id = allocation.organization_id AND undone.allocation_id = allocation.id
       LEFT JOIN public.users undoer ON undoer.id = undone.reversed_by
      WHERE allocation.organization_id = $1 AND allocation.payment_id = $2 ORDER BY allocation.allocated_at`, [context.organizationId, row.id])).rows;
  const planned = row.planned_allocations ?? [];
  const plannedBills = planned.length ? (await client.query(
    "SELECT id, bill_number, supplier_invoice_number, due_date, outstanding_amount FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = ANY($2::uuid[])",
    [context.organizationId, planned.map((entry) => entry.billId)])).rows : [];
  const today = localToday();
  const open = ["posted", "partially_applied"].includes(row.status) && Number(row.unapplied_amount) > 0 ? await openBillsFor(client, context, row.party_id, String(row.currency_code).trim()) : [];
  const history = (await client.query(
    `SELECT event.event_type, event.metadata, event.occurred_at, actor.full_name AS actor FROM tenant.accounting_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.entity_type = 'vendor_payment' AND event.entity_id = $2 ORDER BY event.occurred_at DESC`, [context.organizationId, row.id])).rows;
  return {
    ...paymentView(row),
    plannedAllocations: planned.map((entry) => {
      const bill = plannedBills.find((candidate) => candidate.id === entry.billId);
      return { billId: entry.billId, bill: bill?.bill_number ?? "—", supplierInvoice: bill?.supplier_invoice_number ?? null, dueDate: day(bill?.due_date), amount: money(entry.amount),
        stillOwed: money(bill?.outstanding_amount), href: `/procurement/supplier-bills/${entry.billId}` };
    }),
    allocations: allocations.map((entry) => ({
      id: entry.id, billId: entry.bill_id, bill: entry.bill_number, supplierInvoice: entry.supplier_invoice_number, href: `/procurement/supplier-bills/${entry.bill_id}`,
      amount: money(entry.payment_amount), settled: money(entry.allocated_amount), at: entry.allocated_at, by: entry.created_by_name,
      undone: entry.undone_at ? { at: entry.undone_at, by: entry.undone_by, reason: entry.undone_reason } : null,
    })),
    openBills: open.map((bill) => ({ id: bill.id, number: bill.bill_number, supplierInvoice: bill.supplier_invoice_number, date: day(bill.bill_date), dueDate: day(bill.due_date),
      total: money(bill.grand_total), outstanding: money(bill.outstanding_amount), overdue: Boolean(bill.due_date && day(bill.due_date) < today) })),
    history: history.map((entry) => ({ label: HISTORY[entry.event_type] ?? entry.event_type, at: entry.occurred_at, actor: entry.actor, detail: entry.metadata?.reason ?? null })),
  };
}

export async function getPaymentFormOptions(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const organization = (await client.query("SELECT base_currency FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0];
  const suppliers = (await client.query(
    `SELECT id, display_name, code, currency_code FROM tenant.business_parties
      WHERE organization_id = $1 AND party_type IN ('supplier', 'both') AND status = 'active' ORDER BY display_name LIMIT 3000`, [context.organizationId])).rows;
  const accounts = (await client.query(
    `SELECT bank.id, bank.account_name, bank.bank_name, bank.account_type, bank.currency_code, bank.masked_account_number FROM tenant.accounting_bank_accounts bank
      WHERE bank.organization_id = $1 AND bank.status = 'active' ORDER BY (bank.account_type = 'cash'), bank.account_name`, [context.organizationId])).rows;
  const policy = (await client.query("SELECT vendor_payment_approval_required AS required, vendor_payment_approval_threshold AS threshold FROM tenant.accounting_settings WHERE organization_id = $1",
    [context.organizationId])).rows[0];
  let openBills = [];
  let unapplied = 0;
  if (filters.partyId) {
    const partyId = uuid(filters.partyId, "Supplier");
    const currency = text(filters.currencyCode, 3) || String(suppliers.find((entry) => entry.id === partyId)?.currency_code ?? organization.base_currency).trim();
    const today = localToday();
    openBills = (await openBillsFor(client, context, partyId, currency)).map((bill) => ({ id: bill.id, number: bill.bill_number, supplierInvoice: bill.supplier_invoice_number, date: day(bill.bill_date),
      dueDate: day(bill.due_date), total: money(bill.grand_total), outstanding: money(bill.outstanding_amount), overdue: Boolean(bill.due_date && day(bill.due_date) < today) }));
    unapplied = money((await client.query(
      "SELECT COALESCE(sum(unapplied_amount), 0) AS amount FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND party_id = $2 AND status IN ('posted', 'partially_applied')",
      [context.organizationId, partyId])).rows[0].amount);
  }
  return {
    baseCurrency: String(organization.base_currency).trim(), today: localToday(),
    approval: { required: Boolean(policy?.required), threshold: money(policy?.threshold) },
    suppliers: suppliers.map((entry) => ({ id: entry.id, name: entry.display_name, number: entry.code, currency: entry.currency_code ? String(entry.currency_code).trim() : null })),
    accounts: accounts.map((entry) => ({ id: entry.id, label: `${entry.account_name}${entry.bank_name && entry.account_type !== "cash" ? ` · ${entry.bank_name}` : ""}${entry.masked_account_number ? ` ${entry.masked_account_number}` : ""}`,
      cash: entry.account_type === "cash", currency: String(entry.currency_code ?? "").trim() || null })),
    openBills, unapplied,
  };
}
