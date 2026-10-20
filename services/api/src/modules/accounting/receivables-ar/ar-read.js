// Receivables reads (Finance MVP F4): the invoices customers owe on, the receipts and what each settled, and the receipt form's choices.
import { ACCOUNTING_PERMISSIONS, AccountingError, isoDate, requirePermission, text, uuid } from "../core.js";
import { localToday } from "../journals.js";
import { openInvoicesFor } from "./ar-commands.js";

const OPEN = ["posted", "partially_paid", "overdue", "disputed"];
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const day = (value) => (value ? isoDate(value) : null);

// Invoices and credit notes as Finance sees them: what is still owed, how late, and the Sales document behind each.
export async function listReceivableInvoices(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const where = [];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.view === "open") where.push(`invoice.status = ANY(${bind(OPEN)}::text[]) AND invoice.outstanding_amount > 0`);
  else if (filters.view === "overdue")
    where.push(`invoice.status = ANY(${bind(OPEN)}::text[]) AND invoice.outstanding_amount > 0 AND invoice.due_date < ${bind(localToday())}::date AND invoice.invoice_type <> 'credit_note'`);
  else if (filters.view === "paid") where.push("invoice.status = 'paid'");
  else if (filters.view === "credit_notes") where.push("invoice.invoice_type = 'credit_note' AND invoice.status NOT IN ('draft', 'cancelled')");
  else where.push("invoice.status NOT IN ('draft', 'cancelled', 'pending_approval', 'approved')");
  if (filters.partyId) where.push(`invoice.party_id = ${bind(uuid(filters.partyId, "Customer"))}`);
  if (filters.search) { const term = bind(`%${text(filters.search, 100)}%`); where.push(`(invoice.invoice_number ILIKE ${term} OR party.display_name ILIKE ${term})`); }
  const rows = (await client.query(
    `SELECT invoice.id, invoice.invoice_number, invoice.invoice_type, invoice.invoice_date, invoice.due_date, invoice.currency_code, invoice.grand_total, invoice.outstanding_amount,
            invoice.exchange_rate, invoice.status, invoice.party_id, party.display_name AS party_name,
            (SELECT sales.customer_invoice_id FROM tenant.sales_invoices sales WHERE sales.organization_id = invoice.organization_id AND sales.customer_invoice_id = invoice.id LIMIT 1) AS sales_invoice_id,
            (SELECT note.customer_invoice_id FROM tenant.sales_credit_notes note WHERE note.organization_id = invoice.organization_id AND note.customer_invoice_id = invoice.id LIMIT 1) AS sales_credit_note_id
       FROM tenant.accounting_customer_invoices invoice
       JOIN tenant.business_parties party ON party.id = invoice.party_id
      WHERE invoice.organization_id = $1 AND ${where.join(" AND ")}
      ORDER BY invoice.due_date NULLS LAST, invoice.invoice_date DESC LIMIT 500`, values)).rows;
  const today = localToday();
  return rows.map((row) => {
    const due = day(row.due_date);
    const open = OPEN.includes(row.status) && Number(row.outstanding_amount) > 0;
    const daysOverdue = open && due && due < today && row.invoice_type !== "credit_note" ? Math.round((Date.parse(today) - Date.parse(due)) / 86400000) : 0;
    return {
      id: row.id, number: row.invoice_number, type: row.invoice_type, date: day(row.invoice_date), dueDate: due, currency: String(row.currency_code).trim(),
      total: money(row.grand_total), outstanding: money(row.outstanding_amount), baseOutstanding: money(Number(row.outstanding_amount) * Number(row.exchange_rate ?? 1)),
      status: row.status === "posted" && daysOverdue > 0 ? "overdue" : row.status, daysOverdue, partyId: row.party_id, party: row.party_name,
      href: row.sales_credit_note_id ? `/sales/credit-notes/${row.sales_credit_note_id}` : row.sales_invoice_id ? `/sales/invoices/${row.sales_invoice_id}` : null,
    };
  });
}

function receiptView(row) {
  return {
    id: row.id, number: row.receipt_number, date: day(row.receipt_date), partyId: row.party_id, party: row.party_name, currency: String(row.currency_code).trim(),
    amount: money(row.amount), unapplied: money(row.unapplied_amount),
    applied: row.status === "reversed" ? 0 : money(Number(row.amount) - Number(row.unapplied_amount)),
    method: row.payment_method, reference: row.external_reference, status: row.status, account: row.account_label ?? null, notes: row.notes ?? null,
    journalEntryId: row.journal_entry_id, reversedAt: row.reversed_at, reversalReason: row.reversal_reason, reversalJournalEntryId: row.reversal_journal_entry_id,
    createdBy: row.created_by_name ?? null, createdAt: row.created_at,
  };
}

const RECEIPT_SELECT = `SELECT receipt.*, party.display_name AS party_name, creator.full_name AS created_by_name,
         COALESCE(bank.account_name || ' · ' || bank.bank_name, mapped.code || ' · ' || mapped.name) AS account_label
    FROM tenant.accounting_customer_receipts receipt
    JOIN tenant.business_parties party ON party.id = receipt.party_id
    LEFT JOIN public.users creator ON creator.id = receipt.created_by
    LEFT JOIN tenant.accounting_bank_accounts bank ON bank.id = receipt.bank_account_id
    LEFT JOIN LATERAL (SELECT account.code, account.name FROM tenant.accounting_journal_lines line JOIN tenant.accounting_accounts account ON account.id = line.account_id
                        WHERE line.journal_entry_id = receipt.journal_entry_id AND line.base_debit_amount > 0 LIMIT 1) mapped ON receipt.bank_account_id IS NULL`;

export async function listCustomerReceipts(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const where = ["receipt.status <> 'draft'"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.view === "unapplied") where.push("receipt.status IN ('posted', 'partially_applied') AND receipt.unapplied_amount > 0");
  if (filters.view === "applied") where.push("receipt.status = 'applied'");
  if (filters.view === "reversed") where.push("receipt.status = 'reversed'");
  if (filters.partyId) where.push(`receipt.party_id = ${bind(uuid(filters.partyId, "Customer"))}`);
  if (filters.from) where.push(`receipt.receipt_date >= ${bind(isoDate(filters.from, "From"))}::date`);
  if (filters.to) where.push(`receipt.receipt_date <= ${bind(isoDate(filters.to, "To"))}::date`);
  if (filters.search) { const term = bind(`%${text(filters.search, 100)}%`); where.push(`(receipt.receipt_number ILIKE ${term} OR party.display_name ILIKE ${term} OR receipt.external_reference ILIKE ${term})`); }
  return (await client.query(`${RECEIPT_SELECT} WHERE receipt.organization_id = $1 AND ${where.join(" AND ")} ORDER BY receipt.receipt_date DESC, receipt.created_at DESC LIMIT 500`, values))
    .rows.map(receiptView);
}

const HISTORY = {
  "accounting.customer_receipt.created": "Recorded", "accounting.customer_receipt.posted": "Posted to the accounts", "accounting.customer_receipt.allocated": "Applied to invoices",
  "accounting.customer_receipt.application_undone": "Application undone", "accounting.customer_receipt.reversed": "Reversed",
};

// One receipt: what it settled (and any application undone), the customer's other open invoices it could still settle, and its trail.
export async function getCustomerReceiptRecord(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const row = (await client.query(`${RECEIPT_SELECT} WHERE receipt.organization_id = $1 AND receipt.id = $2`, [context.organizationId, uuid(idValue, "Receipt")])).rows[0];
  if (!row) throw new AccountingError(404, "Receipt not found.", "ACCOUNTING_RECEIPT_NOT_FOUND");
  const allocations = (await client.query(
    `SELECT allocation.id, allocation.receipt_amount, allocation.allocated_amount, allocation.discount_taken, allocation.writeoff_amount, allocation.allocated_at,
            invoice.id AS invoice_id, invoice.invoice_number, invoice.invoice_date, invoice.due_date, creator.full_name AS created_by_name,
            undone.reversed_at AS undone_at, undone.reason AS undone_reason, undoer.full_name AS undone_by,
            (SELECT sales.customer_invoice_id FROM tenant.sales_invoices sales WHERE sales.organization_id = invoice.organization_id AND sales.customer_invoice_id = invoice.id LIMIT 1) AS sales_invoice_id
       FROM tenant.accounting_customer_receipt_allocations allocation
       JOIN tenant.accounting_customer_invoices invoice ON invoice.id = allocation.customer_invoice_id
       LEFT JOIN public.users creator ON creator.id = allocation.created_by
       LEFT JOIN tenant.accounting_customer_receipt_allocation_reversals undone ON undone.organization_id = allocation.organization_id AND undone.allocation_id = allocation.id
       LEFT JOIN public.users undoer ON undoer.id = undone.reversed_by
      WHERE allocation.organization_id = $1 AND allocation.receipt_id = $2 ORDER BY allocation.allocated_at`, [context.organizationId, row.id])).rows;
  const open = ["posted", "partially_applied"].includes(row.status) && Number(row.unapplied_amount) > 0
    ? await openInvoicesFor(client, context, row.party_id, String(row.currency_code).trim()) : [];
  const history = (await client.query(
    `SELECT event.event_type, event.metadata, event.occurred_at, actor.full_name AS actor FROM tenant.accounting_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.entity_type = 'customer_receipt' AND event.entity_id = $2 ORDER BY event.occurred_at DESC`, [context.organizationId, row.id])).rows;
  const today = localToday();
  return {
    ...receiptView(row),
    allocations: allocations.map((entry) => ({
      id: entry.id, invoiceId: entry.invoice_id, invoice: entry.invoice_number, invoiceDate: day(entry.invoice_date), href: entry.sales_invoice_id ? `/sales/invoices/${entry.sales_invoice_id}` : null,
      amount: money(entry.receipt_amount), settled: money(entry.allocated_amount), discount: money(entry.discount_taken), writeoff: money(entry.writeoff_amount),
      at: entry.allocated_at, by: entry.created_by_name, undone: entry.undone_at ? { at: entry.undone_at, by: entry.undone_by, reason: entry.undone_reason } : null,
    })),
    openInvoices: open.map((invoice) => ({ id: invoice.id, number: invoice.invoice_number, date: day(invoice.invoice_date), dueDate: day(invoice.due_date),
      total: money(invoice.grand_total), outstanding: money(invoice.outstanding_amount), overdue: Boolean(invoice.due_date && day(invoice.due_date) < today) })),
    history: history.map((entry) => ({ label: HISTORY[entry.event_type] ?? entry.event_type, at: entry.occurred_at, actor: entry.actor, detail: entry.metadata?.reason ?? null })),
  };
}

// The receipt form: customers, the bank and cash accounts money can arrive in, currencies, and (for a chosen customer) its open invoices.
export async function getReceiptFormOptions(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const organization = (await client.query("SELECT base_currency FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0];
  const customers = (await client.query(
    `SELECT id, display_name, customer_number, currency_code FROM tenant.business_parties
      WHERE organization_id = $1 AND party_type IN ('customer', 'both') AND status = 'active' ORDER BY display_name LIMIT 3000`, [context.organizationId])).rows;
  const accounts = (await client.query(
    `SELECT bank.id, bank.account_name, bank.bank_name, bank.account_type, bank.currency_code, bank.masked_account_number FROM tenant.accounting_bank_accounts bank
      WHERE bank.organization_id = $1 AND bank.status = 'active' ORDER BY (bank.account_type = 'cash'), bank.account_name`, [context.organizationId])).rows;
  const currencies = (await client.query("SELECT code, name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY code", [context.organizationId])).rows;
  let openInvoices = [];
  let unapplied = 0;
  if (filters.partyId) {
    const partyId = uuid(filters.partyId, "Customer");
    const currency = text(filters.currencyCode, 3) || String(customers.find((entry) => entry.id === partyId)?.currency_code ?? organization.base_currency).trim();
    const today = localToday();
    openInvoices = (await openInvoicesFor(client, context, partyId, currency)).map((invoice) => ({ id: invoice.id, number: invoice.invoice_number, date: day(invoice.invoice_date),
      dueDate: day(invoice.due_date), total: money(invoice.grand_total), outstanding: money(invoice.outstanding_amount), overdue: Boolean(invoice.due_date && day(invoice.due_date) < today) }));
    unapplied = money((await client.query(
      "SELECT COALESCE(sum(unapplied_amount), 0) AS amount FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND party_id = $2 AND status IN ('posted', 'partially_applied')",
      [context.organizationId, partyId])).rows[0].amount);
  }
  return {
    baseCurrency: String(organization.base_currency).trim(), today: localToday(),
    customers: customers.map((entry) => ({ id: entry.id, name: entry.display_name, number: entry.customer_number, currency: entry.currency_code ? String(entry.currency_code).trim() : null })),
    accounts: accounts.map((entry) => ({ id: entry.id, label: `${entry.account_name}${entry.bank_name && entry.account_type !== "cash" ? ` · ${entry.bank_name}` : ""}${entry.masked_account_number ? ` ${entry.masked_account_number}` : ""}`,
      cash: entry.account_type === "cash", currency: String(entry.currency_code ?? "").trim() || null })),
    currencies: currencies.map((entry) => ({ code: String(entry.code).trim(), name: entry.name })),
    openInvoices, unapplied,
  };
}
