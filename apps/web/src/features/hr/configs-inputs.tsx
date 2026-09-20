"use client";

import { act, type Row } from "@/features/hr/shared/client";
import type { RegisterConfig, RowAction } from "@/features/hr/shared/Register";
import { amount, badge, calendarDate, col, label, opts, quantity, strong, text } from "@/features/hr/configs";

const ADJUST_TYPES = opts("bonus", "incentive", "allowance", "deduction", "recovery");

const inputs: RegisterConfig = {
  key: "payroll-inputs",
  title: "Payroll adjustments",
  description: "One-off pay for a month: bonus, incentive, an extra allowance, or a deduction/recovery. Entered by one person, approved by another, and picked up by payroll for that month exactly once.",
  searchLabel: "Search adjustments",
  emptyTitle: "No adjustments yet",
  emptyDescription: "Add a bonus, incentive or deduction for a month.",
  source: { kind: "view", view: "payroll-inputs" },
  filters: [{ name: "type", label: "Type", options: ADJUST_TYPES }, { name: "status", label: "Status", options: opts("pending_approval", "approved", "rejected", "cancelled", "paid") }],
  createLabel: "New adjustment",
  createPermission: "hr_payroll.payroll.prepare",
  save: { action: "input-create", success: "Submitted. A second person must approve it." },
  fields: [
    { name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true },
    { name: "inputType", label: "Type", kind: "select", defaultValue: "bonus", options: ADJUST_TYPES, required: true },
    { name: "amount", label: "Amount", kind: "number", step: 100, min: 1, required: true },
    { name: "payMonth", label: "Pay month", kind: "date", required: true },
    { name: "description", label: "Description", kind: "text", required: true, wide: true },
  ],
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("type", "Type", (r) => label(r.input_type)),
    col("amount", "Amount", (r) => amount(r.amount)),
    col("month", "Pay month", (r) => calendarDate(r.pay_month)),
    badge("status", "Status", (r) => r.status),
    col("desc", "Description", (r) => String(r.description ?? "")),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number", "input_type", "status", "description"]),
  rowActions: [
    { label: "Approve", permission: "hr_payroll.payroll.approve", show: (r) => r.status === "pending_approval", run: (r, note) => act("input-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Approved." },
    { label: "Reject", permission: "hr_payroll.payroll.approve", show: (r) => r.status === "pending_approval", run: (r, note) => act("input-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Rejected." },
    { label: "Cancel", permission: "hr_payroll.payroll.prepare", show: (r) => ["pending_approval", "approved"].includes(String(r.status)), run: (r, note) => act("input-cancel", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Cancelled." },
  ],
};

const expenseCategories: RegisterConfig = {
  key: "expense-categories",
  title: "Expense categories",
  description: "What employees can claim, with an optional monthly limit and a receipt threshold.",
  searchLabel: "Search categories",
  emptyTitle: "No expense categories yet",
  emptyDescription: "Add categories such as Travel or Meals.",
  source: { kind: "view", view: "expense-categories" },
  createLabel: "New category",
  createPermission: "hr_payroll.settings.manage",
  save: { action: "expense-category-save", success: "Category saved." },
  edit: { action: "expense-category-save", permission: "hr_payroll.settings.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "monthlyLimit", label: "Monthly limit", kind: "number", step: 500, rowKey: "monthly_limit" },
    { name: "receiptRequiredAbove", label: "Receipt required above", kind: "number", step: 500, rowKey: "receipt_required_above" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("limit", "Monthly limit", (r) => (r.monthly_limit === null ? "—" : amount(r.monthly_limit))), col("receipt", "Receipt above", (r) => (r.receipt_required_above === null ? "—" : amount(r.receipt_required_above))), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name"]),
};

function expenseRegister(scope: "all" | "mine" | "team"): RegisterConfig {
  const title = scope === "mine" ? "My expenses" : scope === "team" ? "Team expenses" : "Expenses";
  const decide: RowAction[] = scope === "mine" ? [] : [
    { label: "Approve", show: (r) => r.status === "submitted", run: (r, note) => act("expense-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Approved. It will be reimbursed with the next payroll." },
    { label: "Reject", show: (r) => r.status === "submitted", run: (r, note) => act("expense-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Rejected." },
  ];
  return {
    key: `expenses-${scope}`,
    title,
    description: scope === "mine" ? "Your claims. An approved claim is reimbursed with the next payroll it falls in." : scope === "team" ? "Claims from your reports. You decide them; you cannot decide your own." : "Every expense claim.",
    searchLabel: `Search ${title.toLowerCase()}`,
    emptyTitle: "No expenses",
    emptyDescription: scope === "mine" ? "Claim an expense to see it here." : "Claims appear here as employees submit them.",
    source: { kind: "view", view: scope === "mine" ? "my-expenses" : scope === "team" ? "team-expenses" : "expenses" },
    filters: [{ name: "status", label: "Status", options: opts("submitted", "approved", "rejected", "reimbursed") }],
    ...(scope !== "team" ? {
      createLabel: "Claim expense",
      save: { action: "expense-save", success: "Claim submitted." },
      fields: [
        ...(scope === "all" ? [{ name: "employeeId", label: "Employee", kind: "select" as const, options: "employees" as const, required: true }] : []),
        { name: "categoryId", label: "Category", kind: "select" as const, options: "expenseCategories" as const, required: true },
        { name: "amount", label: "Amount", kind: "number" as const, step: 50, min: 1, required: true },
        { name: "expenseDate", label: "Expense date", kind: "date" as const, required: true },
        { name: "description", label: "Description", kind: "text" as const, wide: true },
        { name: "receiptReference", label: "Receipt (file reference)", kind: "text" as const, wide: true },
      ],
    } : {}),
    columns: () => [
      ...(scope === "mine" ? [] : [col("employee", "Employee", (r: Row) => `${r.employee_name} (${r.employee_number})`)]),
      col("cat", "Category", (r) => String(r.category_name ?? r.category)),
      col("amount", "Amount", (r) => amount(r.amount)),
      col("date", "Date", (r) => calendarDate(r.expense_date)),
      badge("status", "Status", (r) => r.status),
      col("desc", "Description", (r) => String(r.description ?? "")),
    ],
    searchText: (r) => text(r, ["employee_name", "employee_number", "category", "status", "description"]),
    rowActions: decide,
  };
}

function loanRegister(scope: "all" | "mine"): RegisterConfig {
  return {
    key: `loans-${scope}`,
    title: scope === "mine" ? "My loans" : "Loans and advances",
    description: "A loan or advance is scheduled into EMIs, capped against monthly gross, and approved by someone other than the borrower. Deductions are picked up by payroll automatically.",
    searchLabel: "Search loans",
    emptyTitle: "No loans yet",
    emptyDescription: scope === "mine" ? "Request a loan or advance." : "A loan appears here once requested.",
    source: { kind: "view", view: scope === "mine" ? "my-loans" : "loans" },
    filters: [{ name: "status", label: "Status", options: opts("pending_approval", "active", "closed", "rejected", "cancelled") }],
    createLabel: "Request loan / advance",
    save: { action: "loan-request", success: "Requested. A second person must approve it." },
    fields: [
      ...(scope === "all" ? [{ name: "employeeId", label: "Employee", kind: "select" as const, options: "employees" as const, required: true }] : []),
      { name: "loanType", label: "Type", kind: "select", defaultValue: "loan", options: opts("loan", "advance"), required: true },
      { name: "principal", label: "Amount", kind: "number", step: 1000, min: 1, required: true },
      { name: "interestRate", label: "Interest rate % a year", kind: "number", step: 0.5 },
      { name: "installments", label: "Installments", kind: "number", step: 1, min: 1, defaultValue: 1, required: true },
      { name: "firstDeductionMonth", label: "First deduction month", kind: "date", required: true },
      { name: "purpose", label: "Purpose", kind: "text", wide: true },
    ],
    columns: () => [
      strong("number", "Loan", (r) => String(r.loan_number)),
      ...(scope === "all" ? [col("employee", "Employee", (r: Row) => `${r.employee_name} (${r.employee_number})`)] : []),
      col("type", "Type", (r) => label(r.loan_type)),
      col("principal", "Principal", (r) => amount(r.principal)),
      col("emi", "EMI", (r) => amount(r.emi)),
      col("paid", "Paid", (r) => `${String(r.paid_installments)} of ${String(r.installments)}`),
      col("out", "Outstanding", (r) => amount(r.outstanding_principal)),
      badge("status", "Status", (r) => r.status),
    ],
    searchText: (r) => text(r, ["loan_number", "employee_name", "employee_number", "loan_type", "status"]),
    rowActions: scope === "all" ? [
      { label: "Approve", permission: "hr_payroll.payroll.approve", show: (r) => r.status === "pending_approval", run: (r, note) => act("loan-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Approved." },
      { label: "Reject", permission: "hr_payroll.payroll.approve", show: (r) => r.status === "pending_approval", run: (r, note) => act("loan-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Rejected." },
      { label: "Prepay in full", permission: "hr_payroll.payroll.prepare", show: (r) => r.status === "active", run: (r) => act("loan-prepay", { id: r.id, amount: Number(r.outstanding_principal) }), success: "Prepaid and closed." },
    ] : [],
  };
}

export const INPUT_REGISTERS: Record<string, RegisterConfig> = {
  "payroll-inputs": inputs,
  "expense-categories": expenseCategories,
  expenses: expenseRegister("all"),
  "my-expenses": expenseRegister("mine"),
  "team-expenses": expenseRegister("team"),
  loans: loanRegister("all"),
  "my-loans": loanRegister("mine"),
};
void quantity;
