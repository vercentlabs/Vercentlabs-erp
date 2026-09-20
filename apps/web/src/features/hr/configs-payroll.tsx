"use client";

import { act } from "@/features/hr/shared/client";
import type { RegisterConfig } from "@/features/hr/shared/Register";
import { amount, badge, calendarDate, col, dateTime, label, link, opts, quantity, strong, text } from "@/features/hr/configs";

const COMPONENT_TYPES = [{ value: "earning", label: "Earning" }, { value: "deduction", label: "Deduction" }, { value: "employer_contribution", label: "Employer contribution" }];
const KINDS = opts("basic", "allowance", "bonus", "incentive", "reimbursement", "arrear", "overtime", "loan", "advance", "statutory", "other");

const components: RegisterConfig = {
  key: "salary-components",
  title: "Pay components",
  description: "The building blocks of pay: earnings, deductions and employer contributions. The code is used in structure formulas. A component a structure uses cannot change its nature or be deactivated.",
  searchLabel: "Search components",
  emptyTitle: "No pay components yet",
  emptyDescription: "Add Basic, HRA and the rest, then build a salary structure from them.",
  source: { kind: "view", view: "salary-components" },
  filters: [{ name: "type", label: "Type", options: COMPONENT_TYPES }],
  createLabel: "New component",
  createPermission: "hr_payroll.compensation.manage",
  save: { action: "component-save", success: "Component saved." },
  edit: { action: "component-save", permission: "hr_payroll.compensation.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true, placeholder: "BASIC" },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "componentType", label: "Type", kind: "select", defaultValue: "earning", options: COMPONENT_TYPES, rowKey: "component_type", required: true },
    { name: "componentKind", label: "Kind", kind: "select", defaultValue: "allowance", options: KINDS, rowKey: "component_kind" },
    { name: "taxable", label: "Taxable", kind: "bool", defaultValue: "true" },
    { name: "prorated", label: "Reduced by unpaid days", kind: "bool", defaultValue: "true" },
    { name: "pfWage", label: "Counts as provident-fund wages", kind: "bool", defaultValue: "false", rowKey: "pf_wage" },
    { name: "esicWage", label: "Counts as ESIC wages", kind: "bool", defaultValue: "true", rowKey: "esic_wage" },
    { name: "description", label: "Description", kind: "textarea" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("type", "Type", (r) => label(r.component_type)),
    col("kind", "Kind", (r) => label(r.component_kind)),
    col("tax", "Taxable", (r) => (r.taxable ? "Yes" : "No")),
    col("pro", "Prorated", (r) => (r.prorated ? "Yes" : "No")),
    col("used", "In structures", (r) => String(r.structures)),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name", "component_type", "component_kind"]),
};

const structures: RegisterConfig = {
  key: "salary-structures",
  title: "Salary structures",
  description: "How a CTC breaks up into pay components, with a formula or percentage for each line and a balancing allowance. A structure is versioned and approved by a second person before anyone can be paid on it.",
  searchLabel: "Search structures",
  emptyTitle: "No salary structures yet",
  emptyDescription: "Create a structure from your pay components.",
  source: { kind: "view", view: "salary-structures" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "pending_approval", "active", "inactive", "obsolete") }],
  createLabel: "New structure",
  createPermission: "hr_payroll.compensation.manage",
  newHref: "/hr/structure/new",
  columns: () => [
    link("code", "Structure", (r) => `${r.code} v${r.version}`, (r) => `/hr/structure/${r.id}`),
    col("name", "Name", (r) => String(r.name)),
    badge("status", "Status", (r) => r.status),
    col("lines", "Components", (r) => String(r.line_count)),
    col("emp", "Employees on it", (r) => String(r.employees)),
    col("freq", "Pay frequency", (r) => label(r.pay_frequency)),
  ],
  searchText: (r) => text(r, ["code", "name", "status"]),
};

const compensation: RegisterConfig = {
  key: "compensation",
  title: "Compensation",
  description: "Each employee's pay: a structure and an annual CTC from a date. A change is proposed by one person and approved by another; the monthly breakup is frozen when it is approved. Pay is visible only to those who manage compensation.",
  searchLabel: "Search compensation",
  emptyTitle: "No compensation set",
  emptyDescription: "Propose pay for an employee to make them payable.",
  source: { kind: "view", view: "compensation" },
  filters: [{ name: "status", label: "Status", options: opts("pending_approval", "active", "rejected") }],
  createLabel: "Propose pay",
  createPermission: "hr_payroll.compensation.manage",
  save: { action: "compensation-propose", success: "Proposed. A second person must approve it." },
  fields: [
    { name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true },
    { name: "structureId", label: "Salary structure", kind: "select", options: "salaryStructures", required: true },
    { name: "annualCtc", label: "Annual CTC", kind: "number", step: 10000, required: true, min: 1 },
    { name: "effectiveFrom", label: "Effective from", kind: "date", required: true },
    { name: "reason", label: "Reason", kind: "textarea" },
  ],
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("structure", "Structure", (r) => `${r.structure_code} v${r.structure_version}`),
    col("ctc", "Annual CTC", (r) => amount(r.annual_ctc)),
    col("gross", "Monthly gross", (r) => amount(r.monthly_gross)),
    col("from", "From", (r) => calendarDate(r.effective_from)),
    col("to", "To", (r) => (r.effective_to ? calendarDate(r.effective_to) : "Open")),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number", "structure_code", "status"]),
  rowActions: [
    { label: "Approve", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "pending_approval", run: (r, note) => act("compensation-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Approved. The breakup is frozen." },
    { label: "Reject", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "pending_approval", run: (r, note) => act("compensation-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Rejected." },
  ],
};

const periods: RegisterConfig = {
  key: "payroll-periods",
  title: "Payroll periods",
  description: "The pay calendar. Locking a period freezes attendance in it; approving its payroll locks it too. Locking with items still awaiting a decision needs a reason.",
  searchLabel: "Search periods",
  emptyTitle: "No payroll periods yet",
  emptyDescription: "Generate the periods for a year.",
  source: { kind: "view", view: "payroll-periods" },
  createLabel: "Generate periods",
  createPermission: "hr_payroll.payroll.prepare",
  save: { action: "periods-generate", success: "Periods generated." },
  fields: [
    { name: "year", label: "Year", kind: "number", step: 1, defaultValue: new Date().getFullYear(), min: 2000, required: true },
    { name: "paymentDay", label: "Pay day of the following month (blank for period end)", kind: "number", step: 1, min: 0 },
    { name: "startDate", label: "First period start (weekly and fortnightly only)", kind: "date" },
  ],
  columns: () => [
    strong("code", "Period", (r) => String(r.period_code)),
    col("from", "From", (r) => calendarDate(r.period_start)),
    col("to", "To", (r) => calendarDate(r.period_end)),
    col("pay", "Payment date", (r) => calendarDate(r.payment_date)),
    badge("status", "Period", (r) => r.status),
    col("run", "Payroll", (r) => (r.payroll_number ? `${r.payroll_number} · ${label(r.run_status)}` : "Not started")),
  ],
  searchText: (r) => text(r, ["period_code", "status", "payroll_number"]),
  rowActions: [
    { label: "Lock", permission: "hr_payroll.payroll.prepare", show: (r) => r.status === "open", run: (r, note) => act("period-lock", { id: r.id, force: Boolean(note), reason: note }), note: { label: "Reason to lock with items still pending (leave empty to lock only if nothing is pending)" }, success: "Period locked. Attendance in it is frozen." },
    { label: "Unlock", permission: "hr_payroll.payroll.approve", show: (r) => r.status === "locked", run: (r, note) => act("period-unlock", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Period unlocked." },
    { label: "Close", permission: "hr_payroll.payroll.post", show: (r) => r.status !== "closed" && ["posted", "paid"].includes(String(r.run_status)), run: (r) => act("period-close", { id: r.id }), success: "Period closed." },
  ],
};

const runs: RegisterConfig = {
  key: "payroll-runs",
  title: "Payroll runs",
  description: "One payroll per period: calculated from attendance, leave and pay; reviewed for exceptions; submitted; approved by someone who did not prepare it. Open a run to work it.",
  searchLabel: "Search payroll runs",
  emptyTitle: "No payroll runs yet",
  emptyDescription: "Start a run for a payroll period.",
  source: { kind: "view", view: "payroll-runs" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "calculated", "pending_approval", "approved", "posted", "paid", "cancelled") }],
  createLabel: "Start payroll",
  createPermission: "hr_payroll.payroll.prepare",
  save: { action: "payroll-start", success: "Payroll started. Open it and calculate." },
  fields: [
    { name: "periodId", label: "Payroll period", kind: "select", options: "payrollPeriods", required: true },
    { name: "departmentId", label: "Department (blank for everyone)", kind: "select", options: "departments" },
    { name: "notes", label: "Notes", kind: "text", wide: true },
  ],
  columns: () => [
    link("number", "Payroll", (r) => String(r.payroll_number), (r) => `/hr/payroll-run/${r.id}`),
    badge("status", "Status", (r) => r.status),
    col("period", "Period", (r) => `${calendarDate(r.period_start)} – ${calendarDate(r.period_end)}`),
    col("emp", "Employees", (r) => String(r.employee_count)),
    col("gross", "Gross", (r) => amount(r.gross_pay)),
    col("ded", "Deductions", (r) => amount(r.total_deductions)),
    col("net", "Net pay", (r) => amount(r.net_pay)),
    col("blocking", "Blocking", (r) => String(r.blocking)),
    col("warn", "Warnings", (r) => String(r.warnings)),
  ],
  searchText: (r) => text(r, ["payroll_number", "status"]),
  summary: (rows) => [{ label: "Runs", value: String(rows.length) }, { label: "Awaiting approval", value: String(rows.filter((r) => r.status === "pending_approval").length) }, { label: "Net pay (shown)", value: amount(rows.filter((r) => r.status !== "cancelled").reduce((n, r) => n + Number(r.net_pay), 0)) }],
};

const payslips: RegisterConfig = {
  key: "payslips",
  title: "Payslips",
  description: "Every payslip produced by a payroll run. An employee sees theirs only once the payroll has been approved (or paid, if your settings say so).",
  searchLabel: "Search payslips",
  emptyTitle: "No payslips yet",
  emptyDescription: "Payslips appear when a payroll is calculated.",
  source: { kind: "view", view: "payslips" },
  filters: [{ name: "status", label: "Status", options: opts("calculated", "approved", "posted", "paid", "held", "cancelled") }],
  columns: () => [
    link("number", "Payslip", (r) => String(r.payslip_number), (r) => `/hr/payslip/${r.id}`),
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("period", "Period", (r) => `${calendarDate(r.period_start)} – ${calendarDate(r.period_end)}`),
    badge("status", "Status", (r) => r.status),
    col("paid", "Paid days", (r) => quantity(r.paid_days)),
    col("gross", "Gross", (r) => amount(r.gross_pay)),
    col("ded", "Deductions", (r) => amount(r.total_deductions)),
    col("net", "Net pay", (r) => amount(r.net_pay)),
  ],
  searchText: (r) => text(r, ["payslip_number", "employee_name", "employee_number", "status"]),
  rowActions: [
    { label: "Hold payment", permission: "hr_payroll.payroll.prepare", show: (r) => ["calculated", "approved", "posted"].includes(String(r.status)), run: (r, note) => act("payslip-hold", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Payment held." },
    { label: "Release hold", permission: "hr_payroll.payroll.approve", show: (r) => r.status === "held", run: (r) => act("payslip-release-hold", { id: r.id }), success: "Hold released." },
  ],
};

const myPayslips: RegisterConfig = {
  key: "my-payslips",
  title: "My payslips",
  description: "Your released payslips, newest first.",
  searchLabel: "Search my payslips",
  emptyTitle: "No payslips yet",
  emptyDescription: "Your payslip appears here once payroll for the period has been approved.",
  source: { kind: "view", view: "my-payslips" },
  columns: () => [
    link("number", "Payslip", (r) => String(r.payslip_number), (r) => `/hr/payslip/${r.id}`),
    col("period", "Period", (r) => `${calendarDate(r.period_start)} – ${calendarDate(r.period_end)}`),
    col("pay", "Payment date", (r) => calendarDate(r.payment_date)),
    col("gross", "Gross", (r) => amount(r.gross_pay)),
    col("ded", "Deductions", (r) => amount(r.total_deductions)),
    col("net", "Net pay", (r) => amount(r.net_pay)),
    col("rel", "Released", (r) => dateTime(r.released_at)),
  ],
  searchText: (r) => text(r, ["payslip_number", "payroll_number"]),
};

const exceptions: RegisterConfig = {
  key: "payroll-exceptions",
  title: "Payroll exceptions",
  description: "Things to look at before a payroll is approved. An error blocks submission until it is fixed at the source and the payroll recalculated (or, for a negative net pay, the payment is held). A warning is acknowledged with a note.",
  searchLabel: "Search exceptions",
  emptyTitle: "No exceptions",
  emptyDescription: "Exceptions appear when a payroll is calculated.",
  source: { kind: "view", view: "payroll-exceptions" },
  columns: () => [
    col("run", "Payroll", (r) => String(r.payroll_number)),
    col("employee", "Employee", (r) => (r.employee_number ? `${r.employee_name} (${r.employee_number})` : "—")),
    col("code", "Exception", (r) => label(r.code)),
    badge("severity", "Severity", (r) => (r.resolved ? "resolved" : r.severity)),
    col("msg", "What", (r) => String(r.message)),
    col("note", "Resolution", (r) => String(r.resolution_note ?? "")),
  ],
  searchText: (r) => text(r, ["payroll_number", "employee_name", "employee_number", "code", "message"]),
  rowActions: [{ label: "Resolve", permission: "hr_payroll.payroll.prepare", show: (r) => !r.resolved, run: (r, note) => act("exception-resolve", { id: r.id, note }), note: { label: "How it was resolved", required: true }, success: "Exception resolved." }],
};

export const PAYROLL_REGISTERS: Record<string, RegisterConfig> = {
  "salary-components": components,
  "salary-structures": structures,
  compensation,
  "payroll-periods": periods,
  "payroll-runs": runs,
  payslips,
  "my-payslips": myPayslips,
  "payroll-exceptions": exceptions,
};
