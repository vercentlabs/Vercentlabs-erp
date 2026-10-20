// Reading expenses: the lists (to approve, to pay, mine, drafts and sent back, posted, cancelled or reversed), one expense with its
// evidence, posting, payment and trail, and what the expense form offers.
import { ACCOUNTING_PERMISSIONS, AccountingError, getPrimaryLedger, hasPermission, loadOrganization, requirePermission, text, uuid } from "../core.js";
import { localToday } from "../journals.js";
import { listAccountingExpenseCategories } from "./categories.js";
import { evidenceFiles } from "./files.js";

const fail = (status, message, code) => { throw new AccountingError(status, message, code); };
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const day = (value) => {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return String(value).slice(0, 10);
};

const EXPENSE_SELECT = `SELECT expense.*, account.code AS expense_account_code, account.name AS expense_account_name, paid.code AS paid_from_code, paid.name AS paid_from_name,
       category.name AS category_name, category.code AS category_code, party.display_name AS party_name, claimant.full_name AS claimant_name,
       submitter.full_name AS submitted_by_name, approver.full_name AS approved_by_name, creator.full_name AS created_by_name, canceller.full_name AS cancelled_by_name,
       reverser.full_name AS reversed_by_name, department.name AS department_name, cost_center.name AS cost_center_name,
       entry.entry_number AS journal_number, payment.entry_number AS payment_journal_number, reversal.entry_number AS reversal_journal_number,
       (SELECT count(*) FROM public.attachments file WHERE file.organization_id = expense.organization_id AND file.entity_type = 'accounting.expense'
           AND file.entity_id = expense.id::text AND file.archived_at IS NULL)::int AS file_count
  FROM tenant.accounting_expenses expense
  JOIN tenant.accounting_accounts account ON account.id = expense.expense_account_id
  LEFT JOIN tenant.expense_categories category ON category.id = expense.category_id
  LEFT JOIN tenant.accounting_accounts paid ON paid.id = expense.paid_from_account_id
  LEFT JOIN tenant.business_parties party ON party.id = expense.party_id
  LEFT JOIN public.users claimant ON claimant.id = expense.claimant_user_id
  LEFT JOIN public.users submitter ON submitter.id = expense.submitted_by
  LEFT JOIN public.users approver ON approver.id = expense.approved_by
  LEFT JOIN public.users creator ON creator.id = expense.created_by
  LEFT JOIN public.users canceller ON canceller.id = expense.cancelled_by
  LEFT JOIN public.users reverser ON reverser.id = expense.reversed_by
  LEFT JOIN public.departments department ON department.id = expense.department_id
  LEFT JOIN public.cost_centers cost_center ON cost_center.id = expense.cost_center_id
  LEFT JOIN tenant.accounting_journal_entries entry ON entry.id = expense.journal_entry_id
  LEFT JOIN tenant.accounting_journal_entries payment ON payment.id = expense.payment_journal_entry_id
  LEFT JOIN tenant.accounting_journal_entries reversal ON reversal.id = expense.reversal_journal_entry_id`;

// What the expense is waiting for, in one word the lists and the record agree on.
export function expenseState(row) {
  if (row.status === "POSTED" && row.settlement === "PAYABLE" && !row.payment_journal_entry_id) return "TO_PAY";
  if (row.status === "POSTED") return "PAID";
  return row.status;
}

export function expenseView(row, context) {
  return {
    id: row.id, number: row.expense_number, date: day(row.expense_date), description: row.description, status: row.status, state: expenseState(row),
    category: row.category_id ? { id: row.category_id, name: row.category_name, code: row.category_code } : null,
    expenseAccount: { id: row.expense_account_id, label: `${row.expense_account_code} · ${row.expense_account_name}` },
    payee: row.party_name ?? row.payee_name ?? null, partyId: row.party_id, payeeName: row.payee_name, supplierGstin: row.supplier_gstin, supplierInvoiceReference: row.supplier_invoice_reference,
    claimant: row.claimant_user_id ? { id: row.claimant_user_id, name: row.claimant_name } : null,
    currency: String(row.currency_code).trim(), amount: money(row.amount), gstTreatment: row.gst_treatment, gstSupply: row.gst_supply, gstRate: Number(row.gst_rate),
    taxAmount: money(row.tax_amount), total: money(row.total_amount), settlement: row.settlement, paymentMethod: row.payment_method ?? null,
    paidFrom: row.paid_from_account_id ? { id: row.paid_from_account_id, label: `${row.paid_from_code} · ${row.paid_from_name}` } : null, paidAt: row.paid_at,
    department: row.department_id ? { id: row.department_id, name: row.department_name } : null, costCenter: row.cost_center_id ? { id: row.cost_center_id, name: row.cost_center_name } : null,
    notes: row.notes ?? null, noReceiptReason: row.no_receipt_reason ?? null, files: Number(row.file_count ?? 0),
    submittedBy: row.submitted_by_name, submittedById: row.submitted_by, submittedAt: row.submitted_at, approvedBy: row.approved_by_name, approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason, cancelledBy: row.cancelled_by_name, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason ?? null,
    journalEntryId: row.journal_entry_id, journalNumber: row.journal_number, paymentJournalEntryId: row.payment_journal_entry_id, paymentJournalNumber: row.payment_journal_number,
    reversalJournalEntryId: row.reversal_journal_entry_id, reversalJournalNumber: row.reversal_journal_number, reversedAt: row.reversed_at, reversedBy: row.reversed_by_name,
    reversalReason: row.reversal_reason, createdBy: row.created_by_name, createdById: row.created_by, createdAt: row.created_at, version: row.version,
    canApprove: row.status === "SUBMITTED" && hasPermission(context, ACCOUNTING_PERMISSIONS.payablesApprove) && row.submitted_by !== context.userId && row.claimant_user_id !== context.userId,
  };
}

const VIEWS = {
  to_approve: "expense.status = 'SUBMITTED'",
  to_pay: "expense.status = 'POSTED' AND expense.settlement = 'PAYABLE' AND expense.payment_journal_entry_id IS NULL",
  drafts: "expense.status IN ('DRAFT', 'REJECTED')",
  posted: "expense.status = 'POSTED'",
  closed: "expense.status IN ('CANCELLED', 'REVERSED')",
};

// filters: { view?, search?, categoryId?, from?, to? }
export async function listExpenses(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const where = ["expense.organization_id = $1"];
  if (VIEWS[filters.view]) where.push(VIEWS[filters.view]);
  if (filters.view === "mine") { values.push(context.userId ?? null); where.push(`(expense.created_by = $${values.length} OR expense.claimant_user_id = $${values.length})`); }
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 20).toUpperCase()); where.push(`expense.status = $${values.length}`); }
  if (filters.categoryId) { values.push(uuid(filters.categoryId, "Category")); where.push(`expense.category_id = $${values.length}`); }
  if (filters.from) { values.push(day(filters.from)); where.push(`expense.expense_date >= $${values.length}::date`); }
  if (filters.to) { values.push(day(filters.to)); where.push(`expense.expense_date <= $${values.length}::date`); }
  if (filters.search) {
    values.push(`%${text(filters.search, 100)}%`);
    const at = `$${values.length}`;
    where.push(`(expense.expense_number ILIKE ${at} OR expense.description ILIKE ${at} OR expense.payee_name ILIKE ${at} OR party.display_name ILIKE ${at}
      OR expense.supplier_invoice_reference ILIKE ${at} OR claimant.full_name ILIKE ${at})`);
  }
  const rows = (await client.query(`${EXPENSE_SELECT} WHERE ${where.join(" AND ")} ORDER BY expense.expense_date DESC, expense.created_at DESC LIMIT 500`, values)).rows;
  return rows.map((row) => expenseView(row, context));
}

// Counts for the list's views.
export async function getExpenseCounts(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const row = (await client.query(
    `SELECT count(*) FILTER (WHERE ${VIEWS.to_approve})::int AS to_approve, count(*) FILTER (WHERE ${VIEWS.to_pay})::int AS to_pay,
            COALESCE(sum(total_amount) FILTER (WHERE ${VIEWS.to_pay}), 0) AS owed, count(*) FILTER (WHERE ${VIEWS.drafts})::int AS drafts,
            COALESCE(sum(total_amount) FILTER (WHERE expense.status = 'POSTED' AND expense.expense_date >= date_trunc('month', current_date)), 0) AS this_month
       FROM tenant.accounting_expenses expense WHERE expense.organization_id = $1`, [context.organizationId])).rows[0];
  return { toApprove: row.to_approve, toPay: row.to_pay, owed: money(row.owed), drafts: row.drafts, thisMonth: money(row.this_month) };
}

const HISTORY = {
  "accounting.expense.created": "Recorded", "accounting.expense.updated": "Edited", "accounting.expense.submitted": "Submitted for approval",
  "accounting.expense.approved": "Approved and posted", "accounting.expense.posted": "Posted (no approval needed)", "accounting.expense.rejected": "Sent back",
  "accounting.expense.cancelled": "Cancelled", "accounting.expense.paid": "Paid", "accounting.expense.reversed": "Reversed",
  "accounting.expense.file_added": "File added", "accounting.expense.file_removed": "File removed",
};

export async function getExpenseRecord(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const row = (await client.query(`${EXPENSE_SELECT} WHERE expense.organization_id = $1 AND expense.id = $2`, [context.organizationId, uuid(idValue, "Expense")])).rows[0];
  if (!row) fail(404, "Expense not found.", "ACCOUNTING_EXPENSE_NOT_FOUND");
  const files = await evidenceFiles(client, context, row.id);
  const category = row.category_id ? (await client.query("SELECT receipt_required, receipt_threshold FROM tenant.expense_categories WHERE id = $1", [row.category_id])).rows[0] : null;
  const needed = category ? category.receipt_required && Number(row.total_amount) > Number(category.receipt_threshold) : true;
  const history = (await client.query(
    `SELECT event.event_type, event.metadata, event.occurred_at, actor.full_name AS actor FROM tenant.accounting_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.entity_type = 'expense' AND event.entity_id = $2 ORDER BY event.occurred_at DESC`, [context.organizationId, row.id])).rows;
  // Others like it: the same payee and amount within a week either side (a possible double entry, shown, not refused).
  const similar = (await client.query(
    `SELECT id, expense_number, expense_date, status FROM tenant.accounting_expenses
      WHERE organization_id = $1 AND id <> $2 AND total_amount = $3 AND status NOT IN ('CANCELLED', 'REVERSED')
        AND expense_date BETWEEN $4::date - 7 AND $4::date + 7
        AND ((party_id IS NOT NULL AND party_id = $5) OR (payee_name IS NOT NULL AND lower(payee_name) = lower($6)) OR (claimant_user_id IS NOT NULL AND claimant_user_id = $7))
      ORDER BY expense_date LIMIT 5`, [context.organizationId, row.id, row.total_amount, day(row.expense_date), row.party_id, row.payee_name ?? "", row.claimant_user_id])).rows;
  return {
    ...expenseView(row, context),
    fileList: files,
    evidence: { needed, threshold: category ? money(category.receipt_threshold) : 0, satisfied: !needed || files.length > 0 || Boolean(row.no_receipt_reason) },
    similar: similar.map((entry) => ({ id: entry.id, number: entry.expense_number, date: day(entry.expense_date), status: entry.status })),
    history: history.map((entry) => ({ label: HISTORY[entry.event_type] ?? entry.event_type, at: entry.occurred_at, actor: entry.actor,
      detail: entry.metadata?.reason ?? entry.metadata?.fileName ?? null })),
  };
}

// What the expense form offers.
export async function getExpenseFormOptions(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context);
  const q = async (sql, values) => (await client.query(sql, values)).rows;
  const accounts = await q(
    `SELECT account.id, account.code, account.name, account.account_type, bank.account_name AS register_name, bank.masked_account_number
       FROM tenant.accounting_accounts account
       LEFT JOIN tenant.accounting_bank_accounts bank ON bank.organization_id = account.organization_id AND bank.gl_account_id = account.id AND bank.status = 'active'
      WHERE account.organization_id = $1 AND account.ledger_id = $2 AND account.status = 'active' AND NOT account.is_group AND account.account_type IN ('cash', 'bank')
      ORDER BY (bank.id IS NULL), account.account_type, account.code`, [context.organizationId, ledger.id]);
  const settings = (await client.query("SELECT expense_approval_required FROM tenant.accounting_settings WHERE organization_id = $1", [context.organizationId])).rows[0];
  return {
    today: localToday(), baseCurrency: String(organization.base_currency).trim(), approvalRequired: settings?.expense_approval_required !== false,
    categories: await listAccountingExpenseCategories(client, context),
    accounts: accounts.map((row) => ({ id: row.id, cash: row.account_type === "cash",
      label: row.register_name ? `${row.register_name}${row.masked_account_number ? ` · ${row.masked_account_number}` : ""}` : `${row.code} · ${row.name}` })),
    suppliers: (await q(`SELECT id, display_name, gstin FROM tenant.business_parties WHERE organization_id = $1 AND status = 'active' AND party_type IN ('supplier', 'both')
        ORDER BY display_name LIMIT 1000`, [context.organizationId])).map((row) => ({ id: row.id, name: row.display_name, gstin: row.gstin ?? null })),
    people: (await q(`SELECT DISTINCT person.id, person.full_name FROM organization_memberships membership JOIN public.users person ON person.id = membership.user_id
        WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY person.full_name`, [context.organizationId])).map((row) => ({ id: row.id, name: row.full_name })),
    departments: (await q("SELECT id, name FROM public.departments WHERE organization_id = $1 AND status = 'active' ORDER BY name", [context.organizationId])),
    costCenters: (await q("SELECT id, name, department_id FROM public.cost_centers WHERE organization_id = $1 AND status = 'active' ORDER BY name", [context.organizationId]))
      .map((row) => ({ id: row.id, name: row.name, departmentId: row.department_id })),
  };
}
