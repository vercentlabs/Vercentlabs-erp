"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { StatusBadge } from "@vercentlabs/design-system";

import { act, type Row } from "@/features/hr/shared/client";
import { amount, calendarDate, dateTime, label, quantity, tone } from "@/features/hr/shared/format";
import type { RegisterConfig } from "@/features/hr/shared/Register";

type Col = ColumnDef<Row, unknown>;
// `cell` is only set when given: an explicit undefined would replace the grid's default renderer with nothing.
export const col = (id: string, header: string, accessorFn: (row: Row) => string, cell?: Col["cell"]): Col => (cell ? { id, header, accessorFn, cell } : { id, header, accessorFn }) as Col;
export const badge = (id: string, header: string, value: (row: Row) => unknown): Col => ({ id, header, accessorFn: (row) => label(value(row)), cell: ({ row }) => <StatusBadge tone={tone(value(row.original))}>{label(value(row.original))}</StatusBadge> }) as Col;
export const strong = (id: string, header: string, value: (row: Row) => string): Col => col(id, header, value, ({ row }) => <span className="font-medium text-text">{value(row.original)}</span>);
export const link = (id: string, header: string, value: (row: Row) => string, href: (row: Row) => string): Col => col(id, header, value, ({ row }) => <Link className="font-medium text-brand hover:underline" href={href(row.original)}>{value(row.original)}</Link>);
export const text = (row: Row, keys: string[]) => keys.map((key) => String(row[key] ?? "")).join(" ");
export const opts = (...values: string[]) => values.map((value) => ({ value, label: label(value) }));
export { amount, calendarDate, dateTime, label, quantity };

const EMPLOYMENT_TYPES = opts("permanent", "contract", "intern", "consultant", "part_time", "temporary");
const EMPLOYEE_STATUSES = opts("draft", "active", "on_leave", "suspended", "on_notice", "separated");
const nameOf = (r: Row) => String(r.full_name ?? `${r.first_name ?? ""} ${r.last_name ?? ""}`);

const employees: RegisterConfig = {
  key: "employees",
  title: "Employees",
  description: "Everyone on the payroll of the active company. A new employee is created before joining; completing joining activates the record and starts probation and onboarding.",
  searchLabel: "Search employees",
  emptyTitle: "No employees yet",
  emptyDescription: "Add the first employee to start building the workforce.",
  source: { kind: "view", view: "employees" },
  filters: [{ name: "status", label: "Status", options: EMPLOYEE_STATUSES }, { name: "employmentType", label: "Employment type", options: EMPLOYMENT_TYPES }],
  createLabel: "New employee",
  createPermission: "hr_payroll.employee.manage",
  save: {
    action: "employee-save",
    success: "Employee created. Complete joining once the required documents are verified.",
    transform: (v) => ({
      pan: v.pan || undefined,
      bankDetails: v.accountNumber ? { accountHolder: v.accountHolder, accountNumber: v.accountNumber, ifsc: v.ifsc, bankName: v.bankName } : undefined,
    }),
  },
  fields: [
    { name: "firstName", label: "First name", kind: "text", required: true },
    { name: "lastName", label: "Last name", kind: "text", required: true },
    { name: "workEmail", label: "Work email", kind: "text" },
    { name: "personalPhone", label: "Mobile", kind: "text" },
    { name: "employmentType", label: "Employment type", kind: "select", defaultValue: "permanent", options: EMPLOYMENT_TYPES, required: true },
    { name: "joiningDate", label: "Joining date", kind: "date", required: true },
    { name: "dateOfBirth", label: "Date of birth", kind: "date" },
    { name: "departmentId", label: "Department", kind: "select", options: "departments" },
    { name: "designationId", label: "Designation", kind: "select", options: "designations" },
    { name: "managerEmployeeId", label: "Reports to", kind: "select", options: "employees" },
    { name: "branchId", label: "Branch", kind: "select", options: "branches" },
    { name: "workLocation", label: "Work location", kind: "text" },
    { name: "grade", label: "Grade", kind: "text" },
    { name: "pan", label: "PAN", kind: "text", placeholder: "ABCDE1234F" },
    { name: "accountHolder", label: "Bank account holder", kind: "text" },
    { name: "accountNumber", label: "Bank account number", kind: "text" },
    { name: "ifsc", label: "IFSC", kind: "text", placeholder: "HDFC0001234" },
    { name: "bankName", label: "Bank name", kind: "text" },
  ],
  columns: () => [
    link("number", "Employee", (r) => String(r.employee_number), (r) => `/hr/employee/${r.id}`),
    col("name", "Name", nameOf),
    badge("status", "Status", (r) => r.status),
    col("type", "Type", (r) => label(r.employment_type)),
    col("dept", "Department", (r) => String(r.department_name ?? "—")),
    col("desig", "Designation", (r) => String(r.designation_name ?? "—")),
    col("mgr", "Reports to", (r) => String(r.manager_name ?? "—")),
    col("joined", "Joined", (r) => calendarDate(r.joining_date)),
  ],
  searchText: (r) => text(r, ["employee_number", "full_name", "work_email", "department_name", "designation_name", "status"]),
  summary: (rows) => [
    { label: "Shown", value: String(rows.length) },
    { label: "Active", value: String(rows.filter((r) => r.status === "active").length) },
    { label: "Not yet joined", value: String(rows.filter((r) => r.status === "draft").length) },
    { label: "Serving notice", value: String(rows.filter((r) => r.status === "on_notice").length) },
  ],
  rowActions: [
    { label: "Complete joining", permission: "hr_payroll.employee.manage", show: (r) => r.status === "draft", run: (r) => act("employee-join", { id: r.id }), success: "Joined. The onboarding checklist has been raised." },
  ],
};

const departments: RegisterConfig = {
  key: "departments",
  title: "Departments",
  description: "The organisation structure. A department can sit under another; one with current employees cannot be deactivated.",
  searchLabel: "Search departments",
  emptyTitle: "No departments yet",
  emptyDescription: "Add departments to organise employees.",
  source: { kind: "view", view: "departments" },
  createLabel: "New department",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "department-save", success: "Department saved." },
  edit: { action: "department-save" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "parentDepartmentId", label: "Parent department", kind: "select", options: "departments", rowKey: "parent_department_id" },
    { name: "managerEmployeeId", label: "Department head", kind: "select", options: "employees", rowKey: "manager_employee_id" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("parent", "Parent", (r) => String(r.parent_name ?? "—")),
    col("head", "Head", (r) => String(r.manager_name ?? "—")),
    col("count", "Headcount", (r) => String(r.headcount)),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name", "parent_name", "manager_name"]),
};

const designations: RegisterConfig = {
  key: "designations",
  title: "Designations",
  description: "Job titles and grades. Promotions move an employee between designations.",
  searchLabel: "Search designations",
  emptyTitle: "No designations yet",
  emptyDescription: "Add designations to describe roles.",
  source: { kind: "view", view: "designations" },
  createLabel: "New designation",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "designation-save", success: "Designation saved." },
  edit: { action: "designation-save" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "grade", label: "Grade", kind: "text" },
    { name: "description", label: "Description", kind: "textarea" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("grade", "Grade", (r) => String(r.grade ?? "—")), col("count", "Headcount", (r) => String(r.headcount)), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name", "grade"]),
};

const documentTypes: RegisterConfig = {
  key: "document-types",
  title: "Document types",
  description: "What can be filed on an employee. A type can be required before joining and can track an expiry date.",
  searchLabel: "Search document types",
  emptyTitle: "No document types yet",
  emptyDescription: "Add types such as identity proof or a work permit.",
  source: { kind: "view", view: "document-types" },
  createLabel: "New document type",
  createPermission: "hr_payroll.settings.manage",
  save: { action: "document-type-save", success: "Document type saved." },
  edit: { action: "document-type-save" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "requiredForJoining", label: "Required for joining", kind: "bool", defaultValue: "false", rowKey: "required_for_joining" },
    { name: "expiryTracked", label: "Track expiry", kind: "bool", defaultValue: "false", rowKey: "expiry_tracked" },
    { name: "sensitive", label: "Sensitive", kind: "bool", defaultValue: "true" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("req", "Required for joining", (r) => (r.required_for_joining ? "Yes" : "No")), col("exp", "Tracks expiry", (r) => (r.expiry_tracked ? "Yes" : "No")), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name"]),
};

const documents: RegisterConfig = {
  key: "documents",
  title: "Employee documents",
  description: "Files held against employees. A document is verified by someone other than the employee whose file it is; expiring documents are flagged.",
  searchLabel: "Search documents",
  emptyTitle: "No documents filed",
  emptyDescription: "Add a document to an employee's file.",
  source: { kind: "view", view: "documents" },
  filters: [{ name: "status", label: "Status", options: opts("submitted", "verified", "rejected") }, { name: "expiringInDays", label: "Expiry", options: [{ value: "30", label: "Expiring in 30 days" }, { value: "90", label: "Expiring in 90 days" }] }],
  createLabel: "Add document",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "document-add", success: "Document added." },
  fields: [
    { name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true },
    { name: "documentTypeId", label: "Document type", kind: "select", options: "documentTypes", required: true },
    { name: "title", label: "Title", kind: "text" },
    { name: "fileReference", label: "File reference (storage key or URL)", kind: "text", required: true, wide: true },
    { name: "issuedOn", label: "Issued on", kind: "date" },
    { name: "expiresOn", label: "Expires on", kind: "date" },
  ],
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("type", "Type", (r) => String(r.type_name)),
    col("title", "Title", (r) => String(r.title)),
    badge("status", "Status", (r) => r.status),
    col("expires", "Expires", (r) => calendarDate(r.expires_on)),
    col("note", "Review note", (r) => String(r.review_note ?? "")),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number", "type_name", "title", "status"]),
  rowActions: [
    { label: "Verify", permission: "hr_payroll.employee.manage", show: (r) => r.status === "submitted", run: (r, note) => act("document-review", { id: r.id, verify: true, note }), note: { label: "Note (optional)" }, success: "Document verified." },
    { label: "Reject", permission: "hr_payroll.employee.manage", show: (r) => r.status === "submitted", run: (r, note) => act("document-review", { id: r.id, verify: false, note }), note: { label: "Reason", required: true }, success: "Document rejected." },
    { label: "Remove", permission: "hr_payroll.employee.manage", run: (r) => act("document-remove", { id: r.id }), success: "Document removed." },
  ],
};

// ------------------------------------------------ effective-dated changes (transfer / promotion / confirmation / probation)
function changeRegister(type: "transfer" | "promotion" | "confirmation" | "probation_extension", title: string, description: string, fields: RegisterConfig["fields"], noun: string): RegisterConfig {
  return {
    key: `changes-${type}`,
    title,
    description,
    searchLabel: `Search ${title.toLowerCase()}`,
    emptyTitle: `No ${title.toLowerCase()} yet`,
    emptyDescription: `Propose a ${noun} for a current employee. A second person approves it; it takes effect on its effective date.`,
    source: { kind: "view", view: "changes", params: { type } },
    filters: [{ name: "status", label: "Status", options: opts("pending_approval", "approved", "applied", "rejected", "cancelled") }],
    createLabel: `Propose ${noun}`,
    createPermission: "hr_payroll.employee.manage",
    save: { action: "change-propose", fixed: { changeType: type }, success: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} proposed. A second person must approve it.` },
    fields: [
      { name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true },
      { name: "effectiveDate", label: "Effective date", kind: "date", required: true },
      ...(fields ?? []),
      { name: "reason", label: "Reason", kind: "textarea" },
    ],
    columns: () => [
      col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
      badge("status", "Status", (r) => r.status),
      col("effective", "Effective", (r) => calendarDate(r.effective_date)),
      col("changes", "Change", (r) => Object.entries((r.changes ?? {}) as Record<string, unknown>).map(([k, v]) => `${label(k)}: ${String(v)}`).join("; ") || "—"),
      col("reason", "Reason", (r) => String(r.reason ?? "")),
      col("decision", "Decision note", (r) => String(r.decision_note ?? "")),
    ],
    searchText: (r) => text(r, ["employee_name", "employee_number", "status", "reason"]),
    rowActions: [
      { label: "Approve", permission: "hr_payroll.employee.manage", show: (r) => r.status === "pending_approval", run: (r, note) => act("change-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Approved." },
      { label: "Reject", permission: "hr_payroll.employee.manage", show: (r) => r.status === "pending_approval", run: (r, note) => act("change-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Rejected." },
      { label: "Cancel", permission: "hr_payroll.employee.manage", show: (r) => ["pending_approval", "approved"].includes(String(r.status)), run: (r, note) => act("change-cancel", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Cancelled." },
    ],
  };
}

const transfers = changeRegister("transfer", "Transfers", "Move an employee to another department, branch, manager or location from a date.", [
  { name: "departmentId", label: "New department", kind: "select", options: "departments" },
  { name: "branchId", label: "New branch", kind: "select", options: "branches" },
  { name: "managerEmployeeId", label: "New manager", kind: "select", options: "employees" },
  { name: "workLocation", label: "New work location", kind: "text" },
], "transfer");
const promotions = changeRegister("promotion", "Promotions", "Change designation or grade from a date. A proposed CTC is carried to the compensation assignment.", [
  { name: "designationId", label: "New designation", kind: "select", options: "designations" },
  { name: "grade", label: "New grade", kind: "text" },
  { name: "departmentId", label: "New department", kind: "select", options: "departments" },
  { name: "proposedAnnualCtc", label: "Proposed annual CTC", kind: "number", step: 1000 },
], "promotion");
const confirmations = changeRegister("confirmation", "Confirmations", "Confirm an employee at the end of probation.", [], "confirmation");
const probationExtensions = changeRegister("probation_extension", "Probation extensions", "Extend probation to a later date.", [{ name: "probationEndDate", label: "New probation end date", kind: "date", required: true }], "probation extension");

const probation: RegisterConfig = {
  key: "probation",
  title: "Probation",
  description: "Everyone on probation, soonest end first. Confirm from Confirmations, or extend from Probation extensions.",
  searchLabel: "Search probation",
  emptyTitle: "Nobody is on probation",
  emptyDescription: "Employees appear here from joining until they are confirmed.",
  source: { kind: "view", view: "probation" },
  columns: () => [
    link("number", "Employee", (r) => String(r.employee_number), (r) => `/hr/employee/${r.id}`),
    col("name", "Name", (r) => String(r.full_name)),
    col("dept", "Department", (r) => String(r.department_name ?? "—")),
    badge("status", "Status", (r) => r.probation_status),
    col("end", "Probation ends", (r) => calendarDate(r.probation_end_date)),
    col("left", "Days left", (r) => (r.days_left === null ? "—" : Number(r.days_left) < 0 ? `${Math.abs(Number(r.days_left))} overdue` : String(r.days_left))),
    col("pending", "Confirmation", (r) => (r.confirmation_pending ? "Pending" : "—")),
  ],
  searchText: (r) => text(r, ["employee_number", "full_name", "department_name"]),
};

function taskRegister(kind: "onboarding" | "offboarding"): RegisterConfig {
  const title = kind === "onboarding" ? "Onboarding" : "Offboarding";
  return {
    key: `tasks-${kind}`,
    title,
    description: kind === "onboarding" ? "The joining checklist raised for each new employee. Complete or waive (with a reason) each task." : "The exit checklist raised when a separation is accepted. Mandatory tasks must be done before the separation can be completed.",
    searchLabel: `Search ${title.toLowerCase()} tasks`,
    emptyTitle: `No ${title.toLowerCase()} tasks`,
    emptyDescription: kind === "onboarding" ? "Tasks appear when an employee joins." : "Tasks appear when a separation is accepted.",
    source: { kind: "view", view: "tasks", params: { kind } },
    filters: [{ name: "status", label: "Status", options: opts("open", "done", "waived") }],
    createLabel: "Add task",
    createPermission: "hr_payroll.employee.manage",
    save: { action: "task-add", fixed: { kind }, success: "Task added." },
    fields: [
      { name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true },
      { name: "title", label: "Task", kind: "text", required: true, wide: true },
      { name: "ownerLabel", label: "Owner (team)", kind: "text" },
      { name: "dueDate", label: "Due", kind: "date" },
      { name: "mandatory", label: "Mandatory", kind: "bool", defaultValue: "true" },
    ],
    columns: () => [
      col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
      col("task", "Task", (r) => String(r.title)),
      col("owner", "Owner", (r) => String(r.owner_label ?? "—")),
      col("due", "Due", (r) => calendarDate(r.due_date)),
      badge("status", "Status", (r) => (r.overdue ? "overdue" : r.status)),
      col("mand", "Mandatory", (r) => (r.mandatory ? "Yes" : "No")),
    ],
    searchText: (r) => text(r, ["employee_name", "employee_number", "title", "owner_label", "status"]),
    rowActions: [
      { label: "Done", permission: "hr_payroll.employee.manage", show: (r) => r.status === "open", run: (r, note) => act("task-complete", { id: r.id, note }), note: { label: "Note (optional)" }, success: "Task completed." },
      { label: "Waive", permission: "hr_payroll.employee.manage", show: (r) => r.status === "open", run: (r, note) => act("task-complete", { id: r.id, waive: true, note }), note: { label: "Reason", required: true }, success: "Task waived." },
    ],
  };
}

const separations: RegisterConfig = {
  key: "separations",
  title: "Separations",
  description: "Resignations and other exits. Accepting starts the notice period and the offboarding checklist; completing closes the employee's record after the last working day.",
  searchLabel: "Search separations",
  emptyTitle: "No separations",
  emptyDescription: "Record a resignation, termination, retirement or end of contract.",
  source: { kind: "view", view: "separations" },
  filters: [{ name: "status", label: "Status", options: opts("submitted", "accepted", "completed", "rejected", "withdrawn") }],
  createLabel: "Record separation",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "separation-initiate", success: "Separation recorded." },
  fields: [
    { name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true },
    { name: "separationType", label: "Type", kind: "select", defaultValue: "resignation", options: opts("resignation", "termination", "retirement", "end_of_contract", "absconding", "death"), required: true },
    { name: "noticeDate", label: "Notice date", kind: "date" },
    { name: "requestedLastDay", label: "Requested last working day", kind: "date" },
    { name: "reason", label: "Reason", kind: "textarea" },
  ],
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("type", "Type", (r) => label(r.separation_type)),
    badge("status", "Status", (r) => r.status),
    col("notice", "Notice", (r) => calendarDate(r.notice_date)),
    col("last", "Last working day", (r) => calendarDate(r.last_working_day ?? r.requested_last_day)),
    col("open", "Open tasks", (r) => String(r.open_tasks)),
    col("reason", "Reason", (r) => String(r.reason ?? "")),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number", "separation_type", "status", "reason"]),
  rowActions: [
    { label: "Accept", permission: "hr_payroll.employee.manage", show: (r) => r.status === "submitted", run: (r, note) => act("separation-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Accepted. Notice has started and the offboarding checklist is raised." },
    { label: "Reject", permission: "hr_payroll.employee.manage", show: (r) => r.status === "submitted", run: (r, note) => act("separation-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Rejected." },
    { label: "Withdraw", show: (r) => ["submitted", "accepted"].includes(String(r.status)), run: (r, note) => act("separation-withdraw", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Withdrawn." },
    { label: "Exit interview", permission: "hr_payroll.employee.manage", show: (r) => ["accepted", "completed"].includes(String(r.status)), run: (r, note) => act("separation-exit-interview", { id: r.id, feedback: note, wouldRejoin: false }), note: { label: "Feedback", required: true }, success: "Exit interview recorded." },
    { label: "Complete", permission: "hr_payroll.employee.manage", show: (r) => r.status === "accepted", run: (r) => act("separation-complete", { id: r.id }), success: "Separation completed." },
  ],
};

const profileRequests: RegisterConfig = {
  key: "profile-requests",
  title: "Profile change requests",
  description: "Bank, tax and statutory changes requested by employees. Pay depends on these, so a different person approves each one.",
  searchLabel: "Search requests",
  emptyTitle: "No change requests",
  emptyDescription: "Employees request bank or tax changes from My profile.",
  source: { kind: "view", view: "profile-requests" },
  filters: [{ name: "status", label: "Status", options: opts("pending", "approved", "rejected") }],
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("group", "Change", (r) => label(r.field_group)),
    col("detail", "New values", (r) => Object.entries((r.payload ?? {}) as Record<string, unknown>).map(([k, v]) => `${label(k)}: ${k.includes("number") ? `••••${String(v).slice(-4)}` : String(v)}`).join("; ")),
    badge("status", "Status", (r) => r.status),
    col("when", "Requested", (r) => dateTime(r.created_at)),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number", "field_group", "status"]),
  rowActions: [
    { label: "Approve", permission: "hr_payroll.sensitive.view", show: (r) => r.status === "pending", run: (r, note) => act("profile-change-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Change applied to the employee record." },
    { label: "Reject", permission: "hr_payroll.sensitive.view", show: (r) => r.status === "pending", run: (r, note) => act("profile-change-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Rejected." },
  ],
};

export const REGISTERS: Record<string, RegisterConfig> = {
  employees,
  departments,
  designations,
  "document-types": documentTypes,
  documents,
  transfers,
  promotions,
  confirmations,
  "probation-extensions": probationExtensions,
  probation,
  onboarding: taskRegister("onboarding"),
  offboarding: taskRegister("offboarding"),
  separations,
  "profile-requests": profileRequests,
};
