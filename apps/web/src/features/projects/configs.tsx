"use client";

import { act } from "@/features/projects/shared/client";
import type { FieldDef } from "@/features/projects/shared/FieldInput";
import type { RegisterConfig, RowAction } from "@/features/projects/shared/Register";
import { badge, calendarDate, col, dateTime, money, opts, quantity, strong, text } from "@/features/projects/shared/helpers";

// Project finance authority (services/api projects canSeeFinance): only these see or set the budget and revenue.
const PROJECT_FINANCE_PERMISSIONS = ["projects.budget.manage", "projects.billing.manage", "projects.profitability.view", "projects.approve", "projects.reports.view"];

const BILLING = opts("fixed_price", "time_and_material", "milestone", "non_billable");
const PRIORITY = opts("low", "normal", "high", "urgent");
const SEVERITY = opts("low", "medium", "high", "critical");
const shown = (v: unknown) => (v === null || v === undefined ? "Restricted" : money(v));

// ------------------------------------------------------------------ F193-F196, F204: projects and templates
const projects: RegisterConfig = {
  key: "projects",
  title: "Projects",
  description: "Customer and internal projects. A project is planned, approved by someone other than its creator, then started; completing it checks that work, time, expenses and billing are settled.",
  searchLabel: "Search projects",
  emptyTitle: "No projects yet",
  emptyDescription: "Create a project, optionally from a template.",
  source: { kind: "view", view: "projects" },
  filters: [
    { name: "status", label: "Status", options: opts("draft", "planned", "active", "on_hold", "completed", "cancelled") },
    { name: "projectType", label: "Type", options: opts("customer", "internal") },
    { name: "health", label: "Health", options: opts("on_track", "at_risk", "off_track") },
  ],
  createLabel: "New project",
  createPermission: "projects.create",
  save: { action: "project-create", success: "Project created as a draft." },
  edit: { action: "project-update", permission: "projects.manage", show: (r) => !["completed", "cancelled"].includes(String(r.status)) },
  fields: [
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "projectType", label: "Type", kind: "select", options: opts("customer", "internal"), defaultValue: "customer", createOnly: true },
    { name: "templateId", label: "From template", kind: "select", options: "templates", createOnly: true },
    { name: "customerId", label: "Customer", kind: "select", options: "customers", rowKey: "customer_id" },
    { name: "billingMethod", label: "Billing method", kind: "select", options: BILLING, defaultValue: "non_billable", rowKey: "billing_method" },
    { name: "contractedRevenue", label: "Contracted revenue", kind: "number", step: 0.01, rowKey: "contracted_revenue", anyPermission: PROJECT_FINANCE_PERMISSIONS },
    { name: "plannedStartDate", label: "Planned start", kind: "date", rowKey: "planned_start_date" },
    { name: "plannedEndDate", label: "Planned end", kind: "date", rowKey: "planned_end_date" },
    { name: "projectManagerId", label: "Project manager", kind: "select", options: "users", rowKey: "project_manager_id" },
    { name: "priority", label: "Priority", kind: "select", options: PRIORITY, defaultValue: "normal" },
    { name: "category", label: "Category", kind: "text" },
    { name: "description", label: "Description", kind: "textarea", wide: true },
  ],
  summary: (rows) => [{ label: "Projects shown", value: String(rows.length) }, { label: "Open tasks", value: String(rows.reduce((s, r) => s + Number(r.open_tasks || 0), 0)) }],
  columns: () => [
    strong("number", "Project", (r) => String(r.project_number)),
    col("name", "Name", (r) => String(r.name)),
    badge("type", "Type", (r) => r.project_type),
    col("customer", "Customer", (r) => String(r.customer_name ?? "")),
    col("manager", "Manager", (r) => String(r.manager_name ?? "")),
    col("progress", "Progress", (r) => `${quantity(r.percent_complete)}%`),
    col("end", "Planned end", (r) => calendarDate(r.planned_end_date)),
    col("revenue", "Contract", (r) => shown(r.contracted_revenue)),
    badge("health", "Health", (r) => r.health),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["project_number", "name", "customer_name", "manager_name"]),
  rowActions: [
    { label: "Plan", permission: "projects.manage", show: (r) => r.status === "draft", run: (r) => act("project-status", { id: r.id, transition: "plan" }), success: "Planned." },
    { label: "Approve", permission: "projects.approve", show: (r) => r.status === "planned" && !r.approved_by, run: (r) => act("project-approve", { id: r.id }), success: "Approved." },
    { label: "Start", permission: "projects.manage", show: (r) => r.status === "planned" && Boolean(r.approved_by), run: (r) => act("project-status", { id: r.id, transition: "activate" }), success: "The project is active." },
    { label: "Hold", permission: "projects.manage", show: (r) => r.status === "active", note: { label: "Reason", required: true }, run: (r, note) => act("project-status", { id: r.id, transition: "hold", reason: note }), success: "On hold." },
    { label: "Resume", permission: "projects.manage", show: (r) => r.status === "on_hold", run: (r) => act("project-status", { id: r.id, transition: "resume" }), success: "Resumed." },
    { label: "Complete", permission: "projects.approve", show: (r) => r.status === "active", note: { label: "Closing note" }, run: (r, note) => act("project-status", { id: r.id, transition: "complete", reason: note }), success: "Completed." },
    { label: "Cancel", permission: "projects.approve", show: (r) => ["draft", "planned", "on_hold"].includes(String(r.status)), note: { label: "Reason", required: true }, run: (r, note) => act("project-status", { id: r.id, transition: "cancel", reason: note }), success: "Cancelled." },
    { label: "Reopen", permission: "projects.approve", show: (r) => ["completed", "cancelled"].includes(String(r.status)), note: { label: "Reason", required: true }, run: (r, note) => act("project-status", { id: r.id, transition: "reopen", reason: note }), success: "Reopened and active." },
  ],
};

const templates: RegisterConfig = {
  key: "templates",
  title: "Project templates",
  description: "A reusable structure. One item per line: 'Name; days; hours'. Start a line with '- ' for a sub-task of the line above, 'M: Name; offset days; billing %' for a milestone, and end with '> 1,2' to depend on lines 1 and 2. Loops are refused.",
  searchLabel: "Search templates",
  emptyTitle: "No templates",
  emptyDescription: "Create a template to start projects from it.",
  source: { kind: "view", view: "templates" },
  createLabel: "New template",
  createPermission: "projects.settings.manage",
  save: { action: "template-save", success: "Template saved." },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "projectType", label: "Type", kind: "select", options: opts("customer", "internal"), defaultValue: "customer" },
    { name: "billingMethod", label: "Billing method", kind: "select", options: BILLING, defaultValue: "non_billable" },
    { name: "itemsText", label: "Items (one per line)", kind: "textarea", required: true, wide: true, placeholder: "Design; 5; 40\n- Design review; 2; 8\nBuild; 10; 80 > 1\nM: Go live; 21; 50" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), badge("type", "Type", (r) => r.project_type), badge("billing", "Billing", (r) => r.billing_method), col("items", "Items", (r) => quantity(r.item_count)), badge("status", "Status", (r) => (r.active ? "active" : "cancelled"))],
  searchText: (r) => text(r, ["code", "name"]),
};

// ------------------------------------------------------------------ F199-F203: tasks and milestones
const taskActions: RowAction[] = [
  { label: "Start", permission: "projects.view", show: (r) => ["todo", "blocked"].includes(String(r.status)) && !r.child_count, run: (r) => act("task-status", { id: r.id, status: "in_progress" }), success: "In progress." },
  { label: "Block", permission: "projects.view", show: (r) => r.status === "in_progress" && !r.child_count, note: { label: "Why is it blocked?", required: true }, run: (r, note) => act("task-status", { id: r.id, status: "blocked", reason: note }), success: "Blocked." },
  { label: "Review", permission: "projects.view", show: (r) => r.status === "in_progress" && !r.child_count, run: (r) => act("task-status", { id: r.id, status: "review" }), success: "In review." },
  { label: "Done", permission: "projects.view", show: (r) => ["todo", "in_progress", "review"].includes(String(r.status)) && !r.child_count, run: (r) => act("task-status", { id: r.id, status: "done" }), success: "Done." },
  { label: "Reopen", permission: "projects.view", show: (r) => r.status === "done", run: (r) => act("task-status", { id: r.id, status: "in_progress" }), success: "Reopened." },
  { label: "Progress", permission: "projects.view", show: (r) => !["done", "cancelled"].includes(String(r.status)) && !r.child_count, fields: [{ name: "percent", label: "Percent complete", kind: "number", step: 5, min: 0, required: true }], run: (r, _n, v) => act("task-progress", { id: r.id, percent: v.percent }), success: "Progress recorded." },
  { label: "Add predecessor", permission: "projects.tasks.manage", show: (r) => r.status !== "cancelled", fields: [{ name: "predecessorTaskId", label: "Must finish first", kind: "select", options: "tasks", required: true }, { name: "lagDays", label: "Lag (days)", kind: "number", step: 1, min: -30 }], run: (r, _n, v) => act("dependency-add", { successorTaskId: r.id, ...v }), success: "Dependency added. A loop would have been refused." },
  { label: "Cancel", permission: "projects.tasks.manage", show: (r) => !["done", "cancelled"].includes(String(r.status)) && !r.child_count, run: (r) => act("task-status", { id: r.id, status: "cancelled" }), success: "Cancelled." },
];

const tasks: RegisterConfig = {
  key: "tasks",
  title: "Tasks",
  description: "Every task and sub-task with its WBS code. Assignees move their own tasks; a task cannot start before its predecessors finish or finish before its sub-tasks.",
  searchLabel: "Search tasks",
  emptyTitle: "No tasks",
  emptyDescription: "Add a task to a project.",
  source: { kind: "view", view: "tasks" },
  filters: [{ name: "status", label: "Status", options: opts("todo", "in_progress", "blocked", "review", "done", "cancelled") }],
  createLabel: "New task",
  createPermission: "projects.tasks.manage",
  save: { action: "task-create", success: "Task created." },
  edit: { action: "task-update", permission: "projects.tasks.manage" },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects", createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "parentTaskId", label: "Sub-task of", kind: "select", options: "tasks", rowKey: "parent_task_id" },
    { name: "assigneeUserId", label: "Assignee", kind: "select", options: "users", rowKey: "assignee_user_id" },
    { name: "priority", label: "Priority", kind: "select", options: PRIORITY, defaultValue: "normal" },
    { name: "plannedStartDate", label: "Start", kind: "date", rowKey: "planned_start_date" },
    { name: "durationDays", label: "Duration (working days)", kind: "number", step: 1, min: 0, rowKey: "duration_days" },
    { name: "plannedEndDate", label: "End", kind: "date", rowKey: "planned_end_date" },
    { name: "estimatedHours", label: "Estimated hours", kind: "number", step: 0.5, rowKey: "estimated_hours" },
    { name: "billable", label: "Billable", kind: "bool", defaultValue: "false" },
    { name: "description", label: "Description", kind: "textarea", wide: true },
  ],
  columns: () => [
    strong("number", "Task", (r) => `${r.wbs_code ?? ""} ${r.task_number}`.trim()),
    col("name", "Name", (r) => String(r.name)),
    col("project", "Project", (r) => String(r.project_number ?? "")),
    col("assignee", "Assignee", (r) => String(r.assignee_name ?? "")),
    col("end", "Due", (r) => calendarDate(r.planned_end_date)),
    col("progress", "Progress", (r) => `${quantity(r.percent_complete)}%`),
    col("hours", "Hours (actual / est.)", (r) => `${quantity(r.actual_hours)} / ${quantity(r.estimated_hours)}`),
    badge("priority", "Priority", (r) => r.priority),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["task_number", "wbs_code", "name", "project_number", "assignee_name"]),
  rowActions: taskActions,
};

const milestones: RegisterConfig = {
  key: "milestones",
  title: "Milestones",
  description: "Key dates. A milestone completes only when its tasks are finished; one that triggers billing carries an amount, capped by the contract.",
  searchLabel: "Search milestones",
  emptyTitle: "No milestones",
  emptyDescription: "Add a milestone to a project.",
  source: { kind: "view", view: "milestones" },
  createLabel: "New milestone",
  createPermission: "projects.milestones.manage",
  save: { action: "milestone-save", success: "Milestone saved." },
  edit: { action: "milestone-save", permission: "projects.milestones.manage", show: (r) => !["completed", "cancelled"].includes(String(r.status)) },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects", createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "plannedDate", label: "Planned date", kind: "date", rowKey: "planned_date" },
    { name: "billingTrigger", label: "Triggers billing", kind: "bool", defaultValue: "false", rowKey: "billing_trigger" },
    { name: "billingAmount", label: "Billing amount", kind: "number", step: 0.01, rowKey: "billing_amount" },
    { name: "description", label: "Description", kind: "textarea", wide: true },
  ],
  columns: () => [strong("seq", "Milestone", (r) => `${r.project_number} #${r.sequence}`), col("name", "Name", (r) => String(r.name)), col("date", "Planned", (r) => calendarDate(r.planned_date)), col("done", "Completed", (r) => calendarDate(r.completed_date)), col("open", "Open tasks", (r) => `${r.open_tasks} of ${r.task_count}`), col("bill", "Billing", (r) => (r.billing_trigger ? shown(r.billing_amount) : "—")), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["project_number", "name"]),
  rowActions: [
    { label: "Complete", permission: "projects.milestones.manage", show: (r) => ["planned", "in_progress"].includes(String(r.status)), run: (r) => act("milestone-status", { id: r.id, transition: "complete" }), success: "Completed." },
    { label: "Reopen", permission: "projects.milestones.manage", show: (r) => r.status === "completed", run: (r) => act("milestone-status", { id: r.id, transition: "reopen" }), success: "Reopened." },
    { label: "Cancel", permission: "projects.milestones.manage", show: (r) => ["planned", "in_progress"].includes(String(r.status)), note: { label: "Reason", required: true }, run: (r, note) => act("milestone-status", { id: r.id, transition: "cancel", reason: note }), success: "Cancelled. Its tasks are released." },
  ],
};

// ------------------------------------------------------------------ F208: allocation
const allocation: RegisterConfig = {
  key: "resource-allocation",
  title: "Resource allocation",
  description: "Who is on which project, at what share of their time. Allocating someone past 100% across projects in the same period is refused unless you confirm it.",
  searchLabel: "Search the team",
  emptyTitle: "No allocations",
  emptyDescription: "Add people to a project.",
  source: { kind: "view", view: "teams" },
  createLabel: "Allocate someone",
  createPermission: "projects.resources.manage",
  save: { action: "member-save", success: "Allocation saved." },
  edit: { action: "member-save", permission: "projects.resources.manage" },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects", createOnly: true, rowKey: "project_id" },
    { name: "userId", label: "Person", kind: "select", required: true, options: "users", createOnly: true, rowKey: "user_id" },
    { name: "roleName", label: "Role", kind: "text", defaultValue: "Team member", rowKey: "role_name" },
    { name: "allocationPercent", label: "Allocation %", kind: "number", step: 5, min: 1, defaultValue: 100, rowKey: "allocation_percent" },
    { name: "costRate", label: "Cost rate / hour", kind: "number", step: 0.01, rowKey: "cost_rate" },
    { name: "billRate", label: "Bill rate / hour", kind: "number", step: 0.01, rowKey: "bill_rate" },
    { name: "startDate", label: "From", kind: "date", rowKey: "start_date" },
    { name: "endDate", label: "To", kind: "date", rowKey: "end_date" },
    { name: "allowOverAllocation", label: "Confirm over-allocation", kind: "bool", defaultValue: "false" },
  ],
  columns: () => [strong("project", "Project", (r) => String(r.project_number)), col("person", "Person", (r) => String(r.full_name ?? "")), col("role", "Role", (r) => String(r.role_name)), col("alloc", "Allocation", (r) => `${quantity(r.allocation_percent)}%`), col("from", "From", (r) => calendarDate(r.start_date)), col("to", "To", (r) => calendarDate(r.end_date)), col("rate", "Bill rate", (r) => (r.bill_rate === null ? "Restricted" : money(r.bill_rate))), badge("status", "Status", (r) => (r.active ? "active" : "cancelled"))],
  searchText: (r) => text(r, ["project_number", "full_name", "role_name"]),
  rowActions: [{ label: "Remove", permission: "projects.resources.manage", show: (r) => Boolean(r.active), run: (r) => act("member-remove", { projectId: r.project_id, userId: r.user_id }), success: "Removed from the project." }],
};

// ------------------------------------------------------------------ F211: expenses
const expenses: RegisterConfig = {
  key: "expenses",
  title: "Expenses",
  description: "Project expenses. A foreign-currency expense needs its rate; someone other than the person who incurred it approves it; billable ones flow into time-and-material billing.",
  searchLabel: "Search expenses",
  emptyTitle: "No expenses",
  emptyDescription: "Raise an expense against an active project.",
  source: { kind: "view", view: "expenses" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "submitted", "approved", "rejected", "reimbursed") }],
  createLabel: "New expense",
  createPermission: "projects.expense.enter",
  save: { action: "expense-create", success: "Expense saved as a draft. Submit it for approval." },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects" },
    { name: "expenseDate", label: "Date", kind: "date", required: true },
    { name: "category", label: "Category", kind: "text", required: true },
    { name: "amount", label: "Amount", kind: "number", step: 0.01, required: true },
    { name: "currencyCode", label: "Currency (blank = project currency)", kind: "text" },
    { name: "exchangeRate", label: "Exchange rate (if another currency)", kind: "number", step: 0.0001 },
    { name: "receiptReference", label: "Receipt reference", kind: "text" },
    { name: "billable", label: "Billable to the customer", kind: "bool", defaultValue: "false" },
    { name: "description", label: "Description", kind: "textarea", wide: true },
  ],
  summary: (rows) => [{ label: "Total shown", value: money(rows.reduce((s, r) => s + Number(r.base_amount || 0), 0)) }],
  columns: () => [strong("date", "Date", (r) => calendarDate(r.expense_date)), col("project", "Project", (r) => String(r.project_number)), col("who", "By", (r) => String(r.incurred_by_name ?? "")), col("cat", "Category", (r) => String(r.category)), col("amount", "Amount", (r) => `${money(r.amount)} ${r.currency_code}`), col("base", "In project currency", (r) => money(r.base_amount)), col("receipt", "Receipt", (r) => String(r.receipt_reference ?? "")), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["project_number", "category", "incurred_by_name", "receipt_reference"]),
  rowActions: [
    { label: "Submit", permission: "projects.expense.enter", show: (r) => ["draft", "rejected"].includes(String(r.status)), run: (r) => act("expense-submit", { id: r.id }), success: "Submitted." },
    { label: "Approve", permission: "projects.expense.approve", show: (r) => r.status === "submitted", run: (r) => act("expense-approve", { id: r.id }), success: "Approved." },
    { label: "Reject", permission: "projects.expense.approve", show: (r) => r.status === "submitted", note: { label: "Reason", required: true }, run: (r, note) => act("expense-reject", { id: r.id, reason: note }), success: "Rejected." },
    { label: "Reimburse", permission: "projects.expense.approve", show: (r) => r.status === "approved", run: (r) => act("expense-reimburse", { id: r.id }), success: "Reimbursed." },
    { label: "Delete", permission: "projects.expense.enter", show: (r) => r.status === "draft", run: (r) => act("expense-delete", { id: r.id }), success: "Deleted." },
  ],
};

// ------------------------------------------------------------------ F212/F213: materials and procurement
const materials: RegisterConfig = {
  key: "materials",
  title: "Materials consumed",
  description: "Stock issued to a project. The issue is a real Stock movement, so on-hand quantity, holds and costing all apply; a return puts it back.",
  searchLabel: "Search materials",
  emptyTitle: "No materials issued",
  emptyDescription: "Issue stock to an active project.",
  source: { kind: "view", view: "materials" },
  createLabel: "Issue material",
  createPermission: "projects.expense.enter",
  save: { action: "material-issue", success: "Issued from Stock." },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects" },
    { name: "itemId", label: "Item", kind: "select", required: true, options: "items" },
    { name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: "warehouses" },
    { name: "quantity", label: "Quantity", kind: "number", step: 1, min: 0.0001, required: true },
    { name: "taskId", label: "Task", kind: "select", options: "tasks" },
    { name: "billable", label: "Billable", kind: "bool", defaultValue: "false" },
    { name: "note", label: "Note", kind: "text", wide: true },
  ],
  columns: () => [strong("date", "Date", (r) => calendarDate(r.consumed_on)), col("project", "Project", (r) => String(r.project_number)), col("item", "Item", (r) => `${r.item_code ?? ""} ${r.item_name ?? ""}`), col("qty", "Quantity", (r) => quantity(r.quantity)), col("cost", "Cost", (r) => shown(r.total_cost)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["project_number", "item_name", "item_code"]),
  rowActions: [{ label: "Return to stock", permission: "projects.expense.enter", show: (r) => r.status === "issued", note: { label: "Reason" }, run: (r, note) => act("material-return", { id: r.id, reason: note }), success: "Returned to stock." }],
};

const procurement: RegisterConfig = {
  key: "procurement",
  title: "Project procurement",
  description: "Purchasing linked to a project. Requisitions, sourcing events and purchase orders are commitments; receipts and posted vendor bills are actual cost (a vendor bill's amount comes from the bill itself).",
  searchLabel: "Search links",
  emptyTitle: "No procurement linked",
  emptyDescription: "Link a purchase order, receipt or vendor bill to a project.",
  source: { kind: "view", view: "procurement-links" },
  createLabel: "Link a document",
  createPermission: "projects.procurement.link",
  save: { action: "procurement-link", success: "Linked.", transform: (v) => ({ documentId: v.purchaseOrderId || v.receiptId || v.requisitionId || v.sourcingEventId || v.vendorBillId, documentType: v.purchaseOrderId ? "purchase_order" : v.receiptId ? "receipt" : v.requisitionId ? "requisition" : v.sourcingEventId ? "sourcing_event" : "vendor_bill" }) },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects" },
    { name: "purchaseOrderId", label: "Purchase order (commitment)", kind: "select", options: "purchaseOrders" },
    { name: "requisitionId", label: "Requisition (commitment)", kind: "select", options: "requisitions" },
    { name: "sourcingEventId", label: "Sourcing event (commitment)", kind: "select", options: "sourcingEvents" },
    { name: "committedAmount", label: "Committed amount", kind: "number", step: 0.01 },
    { name: "receiptId", label: "Receipt (actual)", kind: "select", options: "receipts" },
    { name: "actualAmount", label: "Actual amount (receipt)", kind: "number", step: 0.01 },
    { name: "vendorBillId", label: "Posted vendor bill (actual)", kind: "select", options: "vendorBills" },
    { name: "note", label: "Note", kind: "text", wide: true },
  ],
  columns: () => [strong("project", "Project", (r) => String(r.project_number)), badge("type", "Document", (r) => r.document_type), col("id", "Reference", (r) => String(r.document_id).slice(0, 8)), col("committed", "Committed", (r) => (r.committed_amount === null ? "Restricted" : money(r.committed_amount))), col("actual", "Actual", (r) => (r.actual_amount === null ? "Restricted" : money(r.actual_amount))), col("note", "Note", (r) => String(r.note ?? ""))],
  searchText: (r) => text(r, ["project_number", "document_type", "note"]),
  rowActions: [{ label: "Unlink", permission: "projects.procurement.link", run: (r) => act("procurement-unlink", { id: r.id }), success: "Unlinked." }],
};

// ------------------------------------------------------------------ F214/F215: budgets
const budgets: RegisterConfig = {
  key: "budgets",
  title: "Project budgets",
  description: "An approved budget is the baseline. A revision needs a reason, is approved by someone else, and supersedes the current one; it cannot be set below cost already incurred.",
  searchLabel: "Search budgets",
  emptyTitle: "No budgets",
  emptyDescription: "Create a budget for a project.",
  source: { kind: "view", view: "budgets" },
  createLabel: "New budget or revision",
  createPermission: "projects.budget.manage",
  save: { action: "budget-create", success: "Budget saved as a draft. Submit it for approval." },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects" },
    { name: "laborBudget", label: "Labour", kind: "number", step: 0.01 },
    { name: "expenseBudget", label: "Expenses", kind: "number", step: 0.01 },
    { name: "procurementBudget", label: "Procurement and materials", kind: "number", step: 0.01 },
    { name: "contingencyBudget", label: "Contingency", kind: "number", step: 0.01 },
    { name: "revenueBudget", label: "Revenue", kind: "number", step: 0.01 },
    { name: "reason", label: "Reason (required for a revision)", kind: "text", wide: true },
  ],
  columns: () => [strong("project", "Project", (r) => `${r.project_number} v${r.version}`), col("total", "Cost budget", (r) => money(r.total_cost_budget)), col("delta", "Change from base", (r) => (r.change_from_base === null ? "—" : money(r.change_from_base))), col("reason", "Reason", (r) => String(r.reason ?? "")), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["project_number", "reason", "status"]),
  rowActions: [
    { label: "Submit", permission: "projects.budget.manage", show: (r) => r.status === "draft", run: (r) => act("budget-submit", { id: r.id }), success: "Submitted for approval." },
    { label: "Approve", permission: "projects.approve", show: (r) => r.status === "pending_approval", run: (r) => act("budget-approve", { id: r.id }), success: "Approved and active." },
    { label: "Reject", permission: "projects.approve", show: (r) => r.status === "pending_approval", note: { label: "Reason", required: true }, run: (r, note) => act("budget-reject", { id: r.id, reason: note }), success: "Rejected." },
  ],
};

// ------------------------------------------------------------------ F218-F221: billing
const billingActions: RowAction[] = [
  { label: "Approve", permission: "projects.approve", show: (r) => r.status === "ready", run: (r) => act("billing-approve", { id: r.id }), success: "Approved for invoicing." },
  { label: "Invoice", permission: "projects.billing.manage", show: (r) => ["ready", "requested"].includes(String(r.status)), run: (r) => act("billing-invoice", { id: r.id }), success: "A draft invoice was created in Accounting." },
  { label: "Cancel", permission: "projects.billing.manage", show: (r) => ["ready", "requested"].includes(String(r.status)), note: { label: "Reason", required: true }, run: (r, note) => act("billing-cancel", { id: r.id, reason: note }), success: "Cancelled. The work is released for billing again." },
];
const billing: RegisterConfig = {
  key: "billing",
  title: "Project billing",
  description: "Fixed-price instalments, completed milestones and approved time-and-material work. Each line is prepared, approved by someone else, then handed to Accounting as one draft invoice, once.",
  searchLabel: "Search billing lines",
  emptyTitle: "No billing lines",
  emptyDescription: "Prepare a billing line for a billable project.",
  source: { kind: "view", view: "billing" },
  filters: [{ name: "status", label: "Status", options: opts("ready", "requested", "invoiced", "cancelled") }],
  createLabel: "Prepare billing",
  createPermission: "projects.billing.manage",
  save: { action: "billing-create", success: "Billing line prepared." },
  fields: [
    { name: "billingKind", label: "Kind", kind: "select", required: true, options: [{ value: "fixed", label: "Fixed-price instalment" }, { value: "milestone", label: "Completed milestone" }, { value: "time_material", label: "Time and material" }], defaultValue: "fixed" },
    { name: "projectId", label: "Project (instalment / T&M)", kind: "select", options: "projects" },
    { name: "milestoneId", label: "Milestone", kind: "select", options: "milestones", showIf: (v) => v.billingKind === "milestone" },
    { name: "description", label: "Description", kind: "text", showIf: (v) => v.billingKind !== "milestone" },
    { name: "amount", label: "Amount", kind: "number", step: 0.01, showIf: (v) => v.billingKind === "fixed" },
    { name: "periodStart", label: "Period start", kind: "date", showIf: (v) => v.billingKind === "time_material" },
    { name: "periodEnd", label: "Period end", kind: "date", showIf: (v) => v.billingKind === "time_material" },
  ],
  summary: (rows) => [{ label: "Queued", value: money(rows.filter((r) => ["ready", "requested"].includes(String(r.status))).reduce((s, r) => s + Number(r.amount || 0), 0)) }, { label: "Invoiced", value: money(rows.filter((r) => r.status === "invoiced").reduce((s, r) => s + Number(r.amount || 0), 0)) }],
  columns: () => [strong("number", "Billing", (r) => String(r.billing_number)), col("project", "Project", (r) => String(r.project_number)), badge("type", "Type", (r) => r.billing_type), col("desc", "Description", (r) => String(r.description)), col("amount", "Amount", (r) => money(r.amount)), col("invoice", "Invoice", (r) => String(r.invoice_number ?? "")), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["billing_number", "project_number", "description", "invoice_number"]),
  rowActions: billingActions,
};

const invoices: RegisterConfig = {
  key: "invoices",
  title: "Project invoices",
  description: "Invoices raised from project billing. They are Accounting's documents: this list shows the project they came from and their current state there.",
  searchLabel: "Search invoices",
  emptyTitle: "No project invoices",
  emptyDescription: "Invoice an approved billing line.",
  source: { kind: "view", view: "billing", params: { status: "invoiced" } },
  columns: () => [strong("invoice", "Invoice", (r) => String(r.invoice_number ?? "")), col("project", "Project", (r) => String(r.project_number)), col("billing", "Billing line", (r) => String(r.billing_number)), col("amount", "Amount", (r) => money(r.amount)), col("outstanding", "Outstanding", (r) => (r.invoice_outstanding === null || r.invoice_outstanding === undefined ? "—" : money(r.invoice_outstanding))), col("date", "Invoiced", (r) => dateTime(r.invoiced_at)), badge("status", "In Accounting", (r) => r.invoice_status)],
  searchText: (r) => text(r, ["invoice_number", "project_number", "billing_number"]),
};

// ------------------------------------------------------------------ F224-F226: risks, issues, documents
const risks: RegisterConfig = {
  key: "risks",
  title: "Risks",
  description: "Scored probability x impact (1-5 each). A risk scoring 15 or more needs an owner and a mitigation plan before it can be assessed; a risk that happens becomes a linked issue.",
  searchLabel: "Search risks",
  emptyTitle: "No risks",
  emptyDescription: "Register a risk.",
  source: { kind: "view", view: "risks" },
  filters: [{ name: "status", label: "Status", options: opts("identified", "assessed", "mitigating", "realized", "closed") }],
  createLabel: "Register risk",
  createPermission: "projects.view",
  save: { action: "risk-create", success: "Risk registered." },
  edit: { action: "risk-update", show: (r) => !["realized", "closed"].includes(String(r.status)) },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects", createOnly: true },
    { name: "title", label: "Title", kind: "text", required: true },
    { name: "probability", label: "Probability (1-5)", kind: "number", step: 1, min: 1, required: true, defaultValue: 3 },
    { name: "impact", label: "Impact (1-5)", kind: "number", step: 1, min: 1, required: true, defaultValue: 3 },
    { name: "ownerUserId", label: "Owner", kind: "select", options: "users", rowKey: "owner_user_id" },
    { name: "reviewDate", label: "Review by", kind: "date", rowKey: "review_date" },
    { name: "mitigation", label: "Mitigation", kind: "textarea", wide: true },
    { name: "contingency", label: "Contingency", kind: "textarea", wide: true },
  ],
  columns: () => [strong("number", "Risk", (r) => String(r.risk_number)), col("project", "Project", (r) => String(r.project_number)), col("title", "Title", (r) => String(r.title)), col("score", "Score", (r) => `${r.probability} x ${r.impact} = ${r.score}`), badge("rating", "Rating", (r) => r.rating), col("owner", "Owner", (r) => String(r.owner_name ?? "")), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["risk_number", "project_number", "title", "owner_name"]),
  rowActions: [
    { label: "Assess", show: (r) => r.status === "identified", run: (r) => act("risk-update", { id: r.id, status: "assessed" }), success: "Assessed." },
    { label: "Mitigating", show: (r) => ["identified", "assessed"].includes(String(r.status)), run: (r) => act("risk-update", { id: r.id, status: "mitigating" }), success: "Mitigation under way." },
    { label: "It happened", show: (r) => ["identified", "assessed", "mitigating"].includes(String(r.status)), run: (r) => act("risk-realize", { id: r.id }), success: "Raised as an issue." },
    { label: "Close", show: (r) => ["identified", "assessed", "mitigating"].includes(String(r.status)), run: (r) => act("risk-update", { id: r.id, status: "closed" }), success: "Closed." },
  ],
};

const issues: RegisterConfig = {
  key: "issues",
  title: "Issues",
  description: "Problems affecting delivery. A critical open issue blocks project completion; resolving needs a resolution and only a project manager closes.",
  searchLabel: "Search issues",
  emptyTitle: "No issues",
  emptyDescription: "Raise an issue.",
  source: { kind: "view", view: "issues" },
  filters: [{ name: "status", label: "Status", options: opts("open", "in_progress", "resolved", "closed") }, { name: "severity", label: "Severity", options: SEVERITY }],
  createLabel: "Raise issue",
  createPermission: "projects.view",
  save: { action: "issue-create", success: "Issue raised." },
  edit: { action: "issue-update", show: (r) => r.status !== "closed" },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects", createOnly: true },
    { name: "title", label: "Title", kind: "text", required: true },
    { name: "severity", label: "Severity", kind: "select", options: SEVERITY, defaultValue: "medium" },
    { name: "ownerUserId", label: "Owner", kind: "select", options: "users", rowKey: "owner_user_id" },
    { name: "taskId", label: "Related task", kind: "select", options: "tasks", createOnly: true },
    { name: "dueDate", label: "Due", kind: "date", rowKey: "due_date" },
    { name: "description", label: "Description", kind: "textarea", wide: true },
  ],
  columns: () => [strong("number", "Issue", (r) => String(r.issue_number)), col("project", "Project", (r) => String(r.project_number)), col("title", "Title", (r) => String(r.title)), badge("severity", "Severity", (r) => r.severity), col("owner", "Owner", (r) => String(r.owner_name ?? "")), col("due", "Due", (r) => calendarDate(r.due_date)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["issue_number", "project_number", "title", "owner_name"]),
  rowActions: [
    { label: "Start", show: (r) => r.status === "open", run: (r) => act("issue-update", { id: r.id, status: "in_progress" }), success: "In progress." },
    { label: "Resolve", show: (r) => ["open", "in_progress"].includes(String(r.status)), note: { label: "How was it resolved?", required: true }, run: (r, note) => act("issue-update", { id: r.id, status: "resolved", resolution: note }), success: "Resolved." },
    { label: "Close", show: (r) => r.status === "resolved", run: (r) => act("issue-update", { id: r.id, status: "closed" }), success: "Closed." },
  ],
};

const documents: RegisterConfig = {
  key: "documents",
  title: "Project documents",
  description: "Documents by reference. A confidential document is visible only to its author, the project manager, approvers and auditors.",
  searchLabel: "Search documents",
  emptyTitle: "No documents",
  emptyDescription: "Add a document reference.",
  source: { kind: "view", view: "documents" },
  createLabel: "Add document",
  createPermission: "projects.view",
  save: { action: "document-add", success: "Document added." },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects" },
    { name: "title", label: "Title", kind: "text", required: true },
    { name: "documentType", label: "Type", kind: "select", options: opts("contract", "scope", "plan", "deliverable", "report", "minutes", "change_request", "other"), defaultValue: "other" },
    { name: "referenceUrl", label: "Link or file reference", kind: "text" },
    { name: "version", label: "Version", kind: "text", defaultValue: "1" },
    { name: "confidential", label: "Confidential", kind: "bool", defaultValue: "false" },
  ],
  columns: () => [strong("title", "Title", (r) => String(r.title)), col("project", "Project", (r) => String(r.project_number)), col("type", "Type", (r) => String(r.document_type)), col("version", "Version", (r) => String(r.version)), col("by", "Added by", (r) => String(r.created_by_name ?? "")), col("conf", "Confidential", (r) => (r.confidential ? "Yes" : "No")), col("date", "Added", (r) => dateTime(r.created_at))],
  searchText: (r) => text(r, ["title", "project_number", "document_type"]),
  rowActions: [{ label: "Remove", run: (r) => act("document-remove", { id: r.id }), success: "Removed." }],
};

// ------------------------------------------------------------------ F209/F210: time and timesheets
const time: RegisterConfig = {
  key: "time",
  title: "Time entries",
  description: "Log hours against a leaf task on an active project. Rates are captured from the team member at the time of entry; submitting a week sends its draft time for approval.",
  searchLabel: "Search time",
  emptyTitle: "No time logged",
  emptyDescription: "Log time against a project you are on.",
  source: { kind: "view", view: "time-entries" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "submitted", "approved", "rejected") }],
  createLabel: "Log time",
  createPermission: "projects.time.enter",
  save: { action: "time-log", success: "Time logged as a draft. Submit the week for approval." },
  edit: { action: "time-update", permission: "projects.time.enter", show: (r) => ["draft", "rejected"].includes(String(r.status)) },
  fields: [
    { name: "projectId", label: "Project", kind: "select", required: true, options: "projects", createOnly: true },
    { name: "taskId", label: "Task", kind: "select", options: "tasks", rowKey: "task_id" },
    { name: "workDate", label: "Date", kind: "date", required: true, rowKey: "work_date" },
    { name: "hours", label: "Hours", kind: "number", step: 0.25, min: 0.25, required: true },
    { name: "billable", label: "Billable", kind: "bool", defaultValue: "false" },
    { name: "description", label: "What was done", kind: "textarea", wide: true },
  ],
  summary: (rows) => [{ label: "Hours shown", value: quantity(rows.reduce((s, r) => s + Number(r.hours || 0), 0)) }],
  columns: () => [strong("date", "Date", (r) => calendarDate(r.work_date)), col("project", "Project", (r) => String(r.project_number)), col("task", "Task", (r) => String(r.task_number ?? "")), col("who", "Person", (r) => String(r.user_name ?? "")), col("hours", "Hours", (r) => quantity(r.hours)), col("billable", "Billable", (r) => (r.billable ? "Yes" : "No")), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["project_number", "task_number", "user_name", "description"]),
  rowActions: [
    { label: "Submit week", permission: "projects.time.enter", show: (r) => ["draft", "rejected"].includes(String(r.status)), run: (r) => act("timesheet-submit", { weekStart: String(r.work_date).slice(0, 10) }), success: "Week submitted." },
    { label: "Delete", permission: "projects.time.enter", show: (r) => r.status === "draft", run: (r) => act("time-delete", { id: r.id }), success: "Deleted." },
    { label: "Reopen approved time", permission: "projects.approve", show: (r) => r.status === "approved" && !r.billed_billing_id, note: { label: "Reason", required: true }, run: (r, note) => act("time-reopen", { id: r.id, reason: note }), success: "Reopened for correction." },
  ],
};

const timesheets: RegisterConfig = {
  key: "timesheets",
  title: "Timesheets",
  description: "One per person per week. An approver other than the person who logged the time approves or rejects the week.",
  searchLabel: "Search timesheets",
  emptyTitle: "No timesheets",
  emptyDescription: "Timesheets appear once time is logged.",
  source: { kind: "view", view: "timesheets" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "submitted", "approved", "rejected") }],
  columns: () => [strong("week", "Week of", (r) => calendarDate(r.week_start)), col("who", "Person", (r) => String(r.user_name ?? "")), col("entries", "Entries", (r) => quantity(r.entry_count)), col("hours", "Hours", (r) => quantity(r.total_hours)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["user_name", "status"]),
  rowActions: [
    { label: "Recall", permission: "projects.time.enter", show: (r) => r.status === "submitted", run: (r) => act("timesheet-recall", { weekStart: String(r.week_start).slice(0, 10) }), success: "Recalled to draft." },
    { label: "Approve", permission: "projects.time.approve", show: (r) => r.status === "submitted", run: (r) => act("timesheet-approve", { id: r.id }), success: "Approved." },
    { label: "Reject", permission: "projects.time.approve", show: (r) => r.status === "submitted", note: { label: "Reason", required: true }, run: (r, note) => act("timesheet-reject", { id: r.id, reason: note }), success: "Rejected." },
  ],
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  all: projects, templates, tasks, milestones, "resource-allocation": allocation, expenses, materials, procurement, budgets, billing, invoices, risks, issues, documents, time, timesheets,
};

void (null as unknown as FieldDef);
