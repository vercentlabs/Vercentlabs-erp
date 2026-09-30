"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { StatusBadge } from "@vercentlabs/design-system";

import { act, type Row } from "@/features/hr/shared/client";
import {
  amount,
  calendarDate,
  dateTime,
  label,
  quantity,
  tone,
} from "@/features/hr/shared/format";
import type { RegisterConfig } from "@/features/hr/shared/Register";

type Col = ColumnDef<Row, unknown>;
// `cell` is only set when given: an explicit undefined would replace the grid's default renderer with nothing.
export const col = (
  id: string,
  header: string,
  accessorFn: (row: Row) => string,
  cell?: Col["cell"],
): Col =>
  (cell ? { id, header, accessorFn, cell } : { id, header, accessorFn }) as Col;
export const badge = (
  id: string,
  header: string,
  value: (row: Row) => unknown,
): Col =>
  ({
    id,
    header,
    accessorFn: (row) => label(value(row)),
    cell: ({ row }) => (
      <StatusBadge tone={tone(value(row.original))}>
        {label(value(row.original))}
      </StatusBadge>
    ),
  }) as Col;
export const strong = (
  id: string,
  header: string,
  value: (row: Row) => string,
): Col =>
  col(id, header, value, ({ row }) => (
    <span className="font-medium text-text">{value(row.original)}</span>
  ));
export const link = (
  id: string,
  header: string,
  value: (row: Row) => string,
  href: (row: Row) => string,
): Col =>
  col(id, header, value, ({ row }) => (
    <Link
      className="font-medium text-brand hover:underline"
      href={href(row.original)}
    >
      {value(row.original)}
    </Link>
  ));
export const text = (row: Row, keys: string[]) =>
  keys.map((key) => String(row[key] ?? "")).join(" ");
export const opts = (...values: string[]) =>
  values.map((value) => ({ value, label: label(value) }));
export { amount, calendarDate, dateTime, label, quantity };

const EMPLOYMENT_TYPES = opts(
  "permanent",
  "contract",
  "intern",
  "consultant",
  "part_time",
  "temporary",
);
const EMPLOYEE_STATUSES = opts(
  "draft",
  "active",
  "on_leave",
  "suspended",
  "on_notice",
  "separated",
);
const nameOf = (r: Row) =>
  String(r.full_name ?? `${r.first_name ?? ""} ${r.last_name ?? ""}`);

const employees: RegisterConfig = {
  key: "employees",
  title: "Employees",
  description:
    "Everyone on the payroll of the active company. A new employee is created before joining; completing joining activates the record and starts probation and onboarding.",
  searchLabel: "Search employees",
  emptyTitle: "No employees yet",
  emptyDescription: "Add the first employee to start building the workforce.",
  source: { kind: "view", view: "employees" },
  filters: [
    { name: "status", label: "Status", options: EMPLOYEE_STATUSES },
    {
      name: "employmentType",
      label: "Employment type",
      options: EMPLOYMENT_TYPES,
    },
  ],
  createLabel: "New employee",
  createPermission: "hr_payroll.employee.manage",
  save: {
    action: "employee-save",
    success: "Employee created. Complete joining on their first day.",
    transform: (v) => ({
      pan: v.pan || undefined,
      bankDetails: v.accountNumber
        ? {
            accountHolder: v.accountHolder,
            accountNumber: v.accountNumber,
            ifsc: v.ifsc,
            bankName: v.bankName,
          }
        : undefined,
    }),
  },
  edit: {
    action: "employee-update",
    permission: "hr_payroll.employee.manage",
    show: (r) => r.status !== "separated",
  },
  fields: [
    {
      name: "firstName",
      label: "First name",
      kind: "text",
      required: true,
      rowKey: "first_name",
    },
    {
      name: "lastName",
      label: "Last name",
      kind: "text",
      required: true,
      rowKey: "last_name",
    },
    {
      name: "workEmail",
      label: "Work email",
      kind: "text",
      rowKey: "work_email",
    },
    {
      name: "personalPhone",
      label: "Mobile",
      kind: "text",
      rowKey: "personal_phone",
    },
    {
      name: "employmentType",
      rowKey: "employment_type",
      label: "Employment type",
      kind: "select",
      defaultValue: "permanent",
      options: EMPLOYMENT_TYPES,
      required: true,
    },
    {
      name: "joiningDate",
      createOnly: true,
      label: "Joining date",
      kind: "date",
      required: true,
    },
    {
      name: "dateOfBirth",
      label: "Date of birth",
      kind: "date",
      rowKey: "date_of_birth",
    },
    {
      name: "departmentId",
      rowKey: "department_id",
      label: "Department",
      kind: "select",
      options: "departments",
    },
    {
      name: "designationId",
      rowKey: "designation_id",
      label: "Designation",
      kind: "select",
      options: "designations",
    },
    {
      name: "managerEmployeeId",
      rowKey: "manager_employee_id",
      label: "Reports to",
      kind: "select",
      options: "employees",
    },
    {
      name: "branchId",
      label: "Branch",
      kind: "select",
      options: "branches",
      rowKey: "branch_id",
    },
    {
      name: "workLocation",
      label: "Work location",
      kind: "text",
      rowKey: "work_location",
    },
    { name: "grade", label: "Grade", kind: "text", rowKey: "grade" },
    {
      name: "pan",
      label: "PAN",
      kind: "text",
      placeholder: "ABCDE1234F",
      createOnly: true,
    },
    {
      name: "accountHolder",
      label: "Bank account holder",
      kind: "text",
      createOnly: true,
    },
    {
      name: "accountNumber",
      label: "Bank account number",
      kind: "text",
      createOnly: true,
    },
    {
      name: "ifsc",
      label: "IFSC",
      kind: "text",
      placeholder: "HDFC0001234",
      createOnly: true,
    },
    { name: "bankName", label: "Bank name", kind: "text", createOnly: true },
  ],
  columns: () => [
    link(
      "number",
      "Employee",
      (r) => String(r.employee_number),
      (r) => `/hr/employee/${r.id}`,
    ),
    col("name", "Name", nameOf),
    badge("status", "Status", (r) => r.status),
    col("type", "Type", (r) => label(r.employment_type)),
    col("dept", "Department", (r) => String(r.department_name ?? "—")),
    col("desig", "Designation", (r) => String(r.designation_name ?? "—")),
    col("mgr", "Reports to", (r) => String(r.manager_name ?? "—")),
    col("joined", "Joined", (r) => calendarDate(r.joining_date)),
  ],
  searchText: (r) =>
    text(r, [
      "employee_number",
      "full_name",
      "work_email",
      "department_name",
      "designation_name",
      "status",
    ]),
  summary: (rows) => [
    { label: "Shown", value: String(rows.length) },
    {
      label: "Active",
      value: String(rows.filter((r) => r.status === "active").length),
    },
    {
      label: "Not yet joined",
      value: String(rows.filter((r) => r.status === "draft").length),
    },
    {
      label: "Serving notice",
      value: String(rows.filter((r) => r.status === "on_notice").length),
    },
  ],
  rowActions: [
    {
      label: "Complete joining",
      permission: "hr_payroll.employee.manage",
      show: (r) => r.status === "draft",
      run: (r) => act("employee-join", { id: r.id }),
      success: "Joined. The onboarding checklist has been raised.",
    },
  ],
};

const departments: RegisterConfig = {
  key: "departments",
  title: "Departments",
  description:
    "The organisation structure. A department can sit under another; one with current employees cannot be deactivated.",
  searchLabel: "Search departments",
  emptyTitle: "No departments yet",
  emptyDescription: "Add departments to organise employees.",
  source: { kind: "view", view: "departments" },
  createLabel: "New department",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "department-save", success: "Department saved." },
  edit: { action: "department-save" },
  fields: [
    {
      name: "code",
      label: "Code",
      kind: "text",
      required: true,
      createOnly: true,
    },
    { name: "name", label: "Name", kind: "text", required: true },
    {
      name: "parentDepartmentId",
      label: "Parent department",
      kind: "select",
      options: "departments",
      rowKey: "parent_department_id",
    },
    {
      name: "managerEmployeeId",
      label: "Department head",
      kind: "select",
      options: "employees",
      rowKey: "manager_employee_id",
    },
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
  description:
    "Job titles and grades. Promotions move an employee between designations.",
  searchLabel: "Search designations",
  emptyTitle: "No designations yet",
  emptyDescription: "Add designations to describe roles.",
  source: { kind: "view", view: "designations" },
  createLabel: "New designation",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "designation-save", success: "Designation saved." },
  edit: { action: "designation-save" },
  fields: [
    {
      name: "code",
      label: "Code",
      kind: "text",
      required: true,
      createOnly: true,
    },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "grade", label: "Grade", kind: "text" },
    { name: "description", label: "Description", kind: "textarea" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("grade", "Grade", (r) => String(r.grade ?? "—")),
    col("count", "Headcount", (r) => String(r.headcount)),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name", "grade"]),
};

function taskRegister(): RegisterConfig {
  const kind = "onboarding";
  const title = "Onboarding";
  return {
    key: `tasks-${kind}`,
    title,
    description:
      "The joining checklist raised for each new employee. Complete or waive (with a reason) each task.",
    searchLabel: `Search ${title.toLowerCase()} tasks`,
    emptyTitle: `No ${title.toLowerCase()} tasks`,
    emptyDescription: "Tasks appear when an employee joins.",
    source: { kind: "view", view: "tasks", params: { kind } },
    filters: [
      {
        name: "status",
        label: "Status",
        options: opts("open", "done", "waived"),
      },
    ],
    createLabel: "Add task",
    createPermission: "hr_payroll.employee.manage",
    save: { action: "task-add", fixed: { kind }, success: "Task added." },
    fields: [
      {
        name: "employeeId",
        label: "Employee",
        kind: "select",
        options: "employees",
        required: true,
      },
      {
        name: "title",
        label: "Task",
        kind: "text",
        required: true,
        wide: true,
      },
      { name: "ownerLabel", label: "Owner (team)", kind: "text" },
      { name: "dueDate", label: "Due", kind: "date" },
      {
        name: "mandatory",
        label: "Mandatory",
        kind: "bool",
        defaultValue: "true",
      },
    ],
    columns: () => [
      col(
        "employee",
        "Employee",
        (r) => `${r.employee_name} (${r.employee_number})`,
      ),
      col("task", "Task", (r) => String(r.title)),
      col("owner", "Owner", (r) => String(r.owner_label ?? "—")),
      col("due", "Due", (r) => calendarDate(r.due_date)),
      badge("status", "Status", (r) => (r.overdue ? "overdue" : r.status)),
      col("mand", "Mandatory", (r) => (r.mandatory ? "Yes" : "No")),
    ],
    searchText: (r) =>
      text(r, [
        "employee_name",
        "employee_number",
        "title",
        "owner_label",
        "status",
      ]),
    rowActions: [
      {
        label: "Done",
        permission: "hr_payroll.employee.manage",
        show: (r) => r.status === "open",
        run: (r, note) => act("task-complete", { id: r.id, note }),
        note: { label: "Note (optional)" },
        success: "Task completed.",
      },
      {
        label: "Waive",
        permission: "hr_payroll.employee.manage",
        show: (r) => r.status === "open",
        run: (r, note) => act("task-complete", { id: r.id, waive: true, note }),
        note: { label: "Reason", required: true },
        success: "Task waived.",
      },
    ],
  };
}

export const REGISTERS: Record<string, RegisterConfig> = {
  employees,
  departments,
  designations,
  onboarding: taskRegister(),
};
