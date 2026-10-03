"use client";

import { act } from "@/features/accounting/shared/client";
import type {
  RegisterConfig,
  RowAction,
} from "@/features/accounting/shared/Register";
import {
  badge,
  calendarDate,
  col,
  money,
  opts,
  strong,
  text,
} from "@/features/accounting/shared/helpers";

const CLASSES = opts(
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
  "memorandum",
);
const TYPES = opts(
  "bank",
  "cash",
  "receivable",
  "payable",
  "inventory",
  "fixed_asset",
  "accumulated_depreciation",
  "tax_input",
  "tax_output",
  "revenue",
  "other_income",
  "cogs",
  "expense",
  "other_expense",
  "equity",
  "retained_earnings",
  "current_asset",
  "non_current_asset",
  "current_liability",
  "non_current_liability",
  "suspense",
  "rounding",
  "fx_gain",
  "fx_loss",
  "statistical",
  "group",
);

// The approve/reject/submit/post row actions are the same shape for every maker-checker document; the
// domain enforces the state machine and that a submitter cannot approve their own document.
function documentActions(
  prefix: string,
  permissions: { manage: string; approve: string },
  opts2: { reverse?: boolean } = {},
): RowAction[] {
  const actions: RowAction[] = [
    {
      label: "Submit",
      permission: permissions.manage,
      show: (r) => r.status === "draft",
      run: (r) => act(`${prefix}-submit`, { id: r.id }),
      success:
        "Submitted. If approval is required it now waits for a second person.",
    },
    {
      label: "Approve",
      permission: permissions.approve,
      show: (r) => r.status === "pending_approval",
      run: (r) => act(`${prefix}-approve`, { id: r.id }),
      success: "Approved.",
    },
    {
      label: "Send back",
      permission: permissions.approve,
      show: (r) => r.status === "pending_approval",
      run: (r) => act(`${prefix}-reject`, { id: r.id }),
      success: "Returned to draft.",
    },
    {
      label: "Post",
      permission: permissions.manage,
      show: (r) => r.status === "approved",
      run: (r) => act(`${prefix}-post`, { id: r.id }),
      success: "Posted to the ledger.",
    },
  ];
  if (opts2.reverse)
    actions.push({
      label: "Reverse",
      permission: "accounting.journal.reverse",
      show: (r) => r.status === "posted",
      note: { label: "Reason", required: true },
      run: (r, note) => act("journal-reverse", { id: r.id, reason: note }),
      success: "Reversed with a mirror entry.",
    });
  return actions;
}

const accounts: RegisterConfig = {
  key: "chart-of-accounts",
  title: "Chart of accounts",
  description:
    "The ledger's accounts. Group accounts organise the tree; only posting accounts take journal lines.",
  searchLabel: "Search accounts",
  emptyTitle: "No accounts",
  emptyDescription: "The default chart is created with the organization.",
  source: { kind: "view", view: "accounts" },
  createLabel: "New account",
  createPermission: "accounting.settings.manage",
  save: { action: "account-create", success: "Account created." },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true },
    { name: "name", label: "Name", kind: "text", required: true },
    {
      name: "accountClass",
      label: "Class",
      kind: "select",
      required: true,
      options: CLASSES,
    },
    {
      name: "accountType",
      label: "Type",
      kind: "select",
      required: true,
      options: TYPES,
    },
    {
      name: "parentId",
      label: "Parent account",
      kind: "select",
      options: "accounts",
    },
    {
      name: "normalBalance",
      label: "Normal balance",
      kind: "select",
      defaultValue: "debit",
      options: opts("debit", "credit"),
    },
    {
      name: "isGroup",
      label: "Group account",
      kind: "bool",
      defaultValue: "false",
    },
    {
      name: "allowManualPosting",
      label: "Allow manual posting",
      kind: "bool",
      defaultValue: "true",
    },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    badge("class", "Class", (r) => r.account_class),
    col("type", "Type", (r) => String(r.account_type ?? "")),
    col("group", "Group", (r) => (r.is_group ? "Yes" : "No")),
  ],
  searchText: (r) => text(r, ["code", "name", "account_class", "account_type"]),
};

const journals: RegisterConfig = {
  key: "journals",
  title: "Journal entries",
  description:
    "Every entry balances (debits equal credits) and posts only into an open fiscal period. Entries above the approval threshold need a second person; you cannot approve your own.",
  searchLabel: "Search journals",
  emptyTitle: "No journal entries",
  emptyDescription: "Create an entry, or post an invoice, bill or payment.",
  source: { kind: "view", view: "journals" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "draft",
        "pending_approval",
        "approved",
        "posted",
        "reversed",
        "rejected",
      ),
    },
  ],
  createLabel: "New journal entry",
  newHref: "/accounting/journal-new",
  createPermission: "accounting.journal.create",
  columns: () => [
    strong("number", "Entry", (r) => String(r.entry_number)),
    col("date", "Date", (r) => calendarDate(r.accounting_date)),
    col("journal", "Journal", (r) => String(r.journal_code ?? "")),
    col("description", "Description", (r) => String(r.description ?? "")),
    col("debit", "Amount", (r) => money(r.total_debit)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, [
      "entry_number",
      "description",
      "reference",
      "status",
      "journal_code",
    ]),
  rowActions: documentActions(
    "journal",
    {
      manage: "accounting.journal.submit",
      approve: "accounting.journal.approve",
    },
    { reverse: true },
  ).map((a) =>
    a.label === "Post" ? { ...a, permission: "accounting.journal.post" } : a,
  ),
};

const invoices: RegisterConfig = {
  key: "customer-invoices",
  title: "Customer invoices",
  description:
    "Sales invoices and credit notes. Posting books receivable against revenue and tax, and records the tax ledger.",
  searchLabel: "Search invoices",
  emptyTitle: "No invoices",
  emptyDescription: "Create an invoice to bill a customer.",
  source: { kind: "view", view: "customer-invoices" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "draft",
        "pending_approval",
        "approved",
        "posted",
        "partially_paid",
        "paid",
        "overdue",
      ),
    },
  ],
  createLabel: "New invoice",
  newHref: "/accounting/invoice-new",
  createPermission: "accounting.receivables.manage",
  summary: (rows) => [
    {
      label: "Outstanding",
      value: money(
        rows
          .filter((r) =>
            ["posted", "partially_paid", "overdue"].includes(String(r.status)),
          )
          .reduce((s, r) => s + Number(r.outstanding_amount || 0), 0),
      ),
    },
  ],
  columns: () => [
    strong("number", "Invoice", (r) => String(r.invoice_number)),
    badge("type", "Type", (r) => r.invoice_type),
    col("customer", "Customer", (r) => String(r.customer_name ?? "")),
    col("due", "Due", (r) => calendarDate(r.due_date)),
    col("total", "Total", (r) => money(r.grand_total)),
    col("outstanding", "Outstanding", (r) => money(r.outstanding_amount)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["invoice_number", "customer_name", "status"]),
  rowActions: documentActions("invoice", {
    manage: "accounting.receivables.manage",
    approve: "accounting.receivables.approve",
  }),
};

const bills: RegisterConfig = {
  key: "supplier-invoices",
  title: "Supplier bills",
  description:
    "Bills from suppliers. A bill with an unresolved matching exception cannot be posted; bills default to requiring a second approver.",
  searchLabel: "Search bills",
  emptyTitle: "No bills",
  emptyDescription:
    "Record a supplier bill, or import one from a matched purchase.",
  source: { kind: "view", view: "vendor-bills" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "draft",
        "pending_approval",
        "approved",
        "posted",
        "partially_paid",
        "paid",
        "overdue",
      ),
    },
  ],
  createLabel: "New bill",
  newHref: "/accounting/bill-new",
  createPermission: "accounting.payables.manage",
  summary: (rows) => [
    {
      label: "Outstanding",
      value: money(
        rows
          .filter((r) =>
            ["posted", "partially_paid", "overdue"].includes(String(r.status)),
          )
          .reduce((s, r) => s + Number(r.outstanding_amount || 0), 0),
      ),
    },
  ],
  columns: () => [
    strong("number", "Bill", (r) => String(r.bill_number)),
    badge("type", "Type", (r) => r.bill_type),
    col("supplier", "Supplier", (r) => String(r.supplier_name ?? "")),
    col("due", "Due", (r) => calendarDate(r.due_date)),
    col("total", "Total", (r) => money(r.grand_total)),
    col("outstanding", "Outstanding", (r) => money(r.outstanding_amount)),
    badge("match", "Matching", (r) => r.matching_status),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, [
      "bill_number",
      "supplier_name",
      "status",
      "supplier_invoice_number",
    ]),
  rowActions: documentActions("bill", {
    manage: "accounting.payables.manage",
    approve: "accounting.payables.approve",
  }),
};

const bankAccounts: RegisterConfig = {
  key: "bank-accounts",
  title: "Bank accounts",
  description:
    "Bank and cash accounts, each backed by a bank or cash account in the chart.",
  searchLabel: "Search bank accounts",
  emptyTitle: "No bank accounts",
  emptyDescription: "Add a bank account to import statements and reconcile.",
  source: { kind: "view", view: "bank-accounts" },
  createLabel: "New bank account",
  createPermission: "accounting.bank.manage",
  save: { action: "bank-account-create", success: "Bank account created." },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true },
    { name: "bankName", label: "Bank", kind: "text", required: true },
    {
      name: "accountName",
      label: "Account name",
      kind: "text",
      required: true,
    },
    {
      name: "glAccountId",
      label: "Ledger account (bank or cash)",
      kind: "select",
      required: true,
      options: "postingAccounts",
    },
    {
      name: "maskedAccountNumber",
      label: "Account number (masked)",
      kind: "text",
    },
    { name: "ifscSwift", label: "IFSC / SWIFT", kind: "text" },
    {
      name: "accountType",
      label: "Type",
      kind: "select",
      defaultValue: "current",
      options: opts(
        "current",
        "savings",
        "cash",
        "credit_card",
        "loan",
        "virtual",
        "other",
      ),
    },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("bank", "Bank", (r) => String(r.bank_name)),
    col("name", "Account", (r) => String(r.account_name)),
    col(
      "gl",
      "Ledger account",
      (r) => `${r.gl_account_code ?? ""} ${r.gl_account_name ?? ""}`,
    ),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["code", "bank_name", "account_name"]),
};

const statements: RegisterConfig = {
  key: "bank-transactions",
  title: "Bank statements",
  description:
    "Imported statements. Paste CSV (date, description, debit, credit); re-importing the same content is ignored. Start a reconciliation to match each line to the ledger; it completes only when every line is matched and the balances agree.",
  searchLabel: "Search statements",
  emptyTitle: "No statements",
  emptyDescription: "Import a statement to begin reconciling.",
  source: { kind: "view", view: "bank-statements" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts("imported", "reconciling", "reconciled"),
    },
  ],
  createLabel: "Import statement",
  createPermission: "accounting.bank.manage",
  save: { action: "statement-import", success: "Statement imported." },
  fields: [
    {
      name: "bankAccountId",
      label: "Bank account",
      kind: "select",
      required: true,
      options: "bankAccounts",
    },
    {
      name: "periodStart",
      label: "Period start",
      kind: "date",
      required: true,
    },
    { name: "periodEnd", label: "Period end", kind: "date", required: true },
    {
      name: "openingBalance",
      label: "Opening balance",
      kind: "number",
      step: 0.01,
      min: -1e12,
    },
    {
      name: "closingBalance",
      label: "Closing balance",
      kind: "number",
      step: 0.01,
      min: -1e12,
    },
    {
      name: "csvText",
      label: "CSV (header: Date, Description, Debit, Credit)",
      kind: "textarea",
      required: true,
      wide: true,
    },
  ],
  columns: () => [
    strong("number", "Statement", (r) => String(r.statement_number)),
    col("bank", "Bank", (r) => `${r.bank_name ?? ""} ${r.account_name ?? ""}`),
    col(
      "period",
      "Period",
      (r) => `${calendarDate(r.period_start)} – ${calendarDate(r.period_end)}`,
    ),
    col("closing", "Closing balance", (r) => money(r.closing_balance)),
    col(
      "matched",
      "Matched",
      (r) => `${r.matched_lines ?? 0} / ${r.total_lines ?? 0}`,
    ),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, ["statement_number", "bank_name", "account_name", "status"]),
  rowActions: [
    {
      label: "Start reconciliation",
      permission: "accounting.bank.reconcile",
      show: (r) => r.status === "imported",
      run: (r) => act("reconciliation-start", { bankStatementId: r.id }),
      success: "Reconciliation started.",
    },
  ],
};

const periods: RegisterConfig = {
  key: "fiscal-periods",
  title: "Fiscal periods",
  description:
    "Postings are refused outside an open period. A period can be soft-closed and reopened here; a hard close happens only through a completed close run.",
  searchLabel: "Search periods",
  emptyTitle: "No fiscal periods",
  emptyDescription: "Periods are created with the fiscal year.",
  source: { kind: "view", view: "fiscal-periods" },
  columns: () => [
    strong("name", "Period", (r) => String(r.name)),
    col("start", "From", (r) => calendarDate(r.start_date)),
    col("end", "To", (r) => calendarDate(r.end_date)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["name", "status", "fiscal_year"]),
  rowActions: [
    {
      label: "Soft close",
      permission: "accounting.period.manage",
      show: (r) => r.status === "open",
      note: { label: "Note" },
      run: (r, note) =>
        act("period-status", { id: r.id, status: "soft_closed", note }),
      success: "Soft-closed.",
    },
    {
      label: "Reopen",
      permission: "accounting.period.manage",
      show: (r) => r.status === "soft_closed",
      note: { label: "Note" },
      run: (r, note) =>
        act("period-status", { id: r.id, status: "open", note }),
      success: "Reopened.",
    },
  ],
};

const closeRuns: RegisterConfig = {
  key: "close-checklist",
  title: "Close runs",
  description:
    "A governed period close: a checklist of tasks that must be complete before the period hard-closes.",
  searchLabel: "Search close runs",
  emptyTitle: "No close runs",
  emptyDescription: "Start a close run for an open or soft-closed period.",
  source: { kind: "view", view: "close-runs" },
  createLabel: "Start close run",
  createPermission: "accounting.close.manage",
  save: { action: "close-run-create", success: "Close run started." },
  fields: [
    {
      name: "fiscalPeriodId",
      label: "Period",
      kind: "select",
      required: true,
      options: "periods",
    },
    {
      name: "closeType",
      label: "Close type",
      kind: "select",
      defaultValue: "month",
      options: opts("month", "quarter", "year", "soft", "hard"),
    },
  ],
  columns: () => [
    strong("number", "Run", (r) => String(r.run_number ?? "")),
    col("period", "Period", (r) => String(r.period_name ?? "")),
    badge("type", "Type", (r) => r.close_type),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["run_number", "period_name", "status"]),
  rowActions: [
    {
      label: "Complete",
      permission: "accounting.close.manage",
      show: (r) => ["planned", "in_progress"].includes(String(r.status)),
      note: { label: "Note" },
      run: (r, note) => act("close-run-complete", { id: r.id, note }),
      success: "Close run completed.",
    },
  ],
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  "chart-of-accounts": accounts,
  journals,
  "customer-invoices": invoices,
  "supplier-invoices": bills,
  "bank-accounts": bankAccounts,
  "bank-transactions": statements,
  reconciliation: {
    ...statements,
    key: "bank-reconciliation",
    title: "Bank reconciliation",
    description:
      "Statements waiting to be matched to the ledger. A reconciliation completes only when every line is matched and the balances agree. Import a statement under Bank statements to start one.",
    emptyTitle: "Nothing to reconcile",
    emptyDescription:
      "Import a statement under Bank statements, then choose Start reconciliation.",
    source: {
      kind: "view",
      view: "bank-statements",
      params: { status: "reconciling" },
    },
    createLabel: undefined,
    createPermission: undefined,
    save: undefined,
    fields: undefined,
  },
  "fiscal-periods": periods,
  "close-checklist": closeRuns,
};
