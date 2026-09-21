"use client";

import { act } from "@/features/assets/shared/client";
import type { FieldDef } from "@/features/assets/shared/FieldInput";
import type { RegisterConfig, RowAction } from "@/features/assets/shared/Register";
import { badge, calendarDate, col, dateTime, money, opts, quantity, strong, text } from "@/features/assets/shared/helpers";

const METHODS = opts("straight_line", "declining_balance", "units_of_production", "none");
const CONVENTIONS = opts("full_month", "mid_month", "next_month");
const RATINGS = opts("excellent", "good", "fair", "poor", "critical");
const CRIT = opts("low", "medium", "high", "critical");
const yes = (v: unknown) => (v ? "Yes" : "No");

const accountField = (name: string, label: string): FieldDef => ({ name, label, kind: "select", options: "accounts" });

// ------------------------------------------------------------------ F231-F236: the register
const register: RegisterConfig = {
  key: "register",
  title: "Asset register",
  description: "Every asset with its identity, custody, location and condition. Value figures appear only to people with financial access; a custodian sees just the assets assigned to them.",
  searchLabel: "Search assets, tags, serial numbers",
  emptyTitle: "No assets yet",
  emptyDescription: "Register an asset, or create one from a posted supplier bill.",
  source: { kind: "view", view: "register" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "available", "assigned", "in_maintenance", "pending_disposal", "lost", "disposed") }, { name: "criticality", label: "Criticality", options: CRIT }],
  createLabel: "Register asset",
  createPermission: "assets.create",
  save: { action: "asset-register", success: "Asset registered as a draft. Capitalize it to start depreciation." },
  edit: { action: "asset-update", permission: "assets.manage", show: (r) => r.status !== "disposed" },
  fields: [
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "categoryId", label: "Category", kind: "select", required: true, options: "categories", createOnly: true },
    { name: "acquisitionCost", label: "Acquisition cost", kind: "number", step: 0.01, createOnly: true },
    { name: "acquisitionDate", label: "Acquisition date", kind: "date", createOnly: true },
    { name: "serialNumber", label: "Serial number", kind: "text", rowKey: "serial_number" },
    { name: "manufacturer", label: "Manufacturer", kind: "text" },
    { name: "model", label: "Model", kind: "text" },
    { name: "locationId", label: "Location", kind: "select", options: "locations", createOnly: true },
    { name: "departmentId", label: "Department", kind: "select", options: "departments", createOnly: true },
    { name: "supplierId", label: "Supplier", kind: "select", options: "suppliers", rowKey: "supplier_id" },
    { name: "parentAssetId", label: "Component of", kind: "select", options: "assets", rowKey: "parent_asset_id" },
    { name: "criticality", label: "Criticality", kind: "select", options: CRIT, defaultValue: "medium" },
    { name: "ownership", label: "Ownership", kind: "select", options: opts("owned", "leased", "loaned"), defaultValue: "owned" },
    { name: "totalUnits", label: "Total expected units (usage-based depreciation)", kind: "number", step: 1, createOnly: true },
    { name: "notes", label: "Notes", kind: "textarea", wide: true },
  ],
  summary: (rows) => [{ label: "Assets shown", value: String(rows.length) }, { label: "Net book value", value: rows.some((r) => r.net_book_value !== null && r.net_book_value !== undefined) ? money(rows.reduce((s, r) => s + Number(r.net_book_value || 0), 0)) : "Restricted" }],
  columns: () => [
    strong("number", "Asset", (r) => String(r.asset_number)),
    col("name", "Name", (r) => String(r.name)),
    col("category", "Category", (r) => String(r.category_name ?? "")),
    col("location", "Location", (r) => String(r.location_name ?? "")),
    col("custodian", "Custodian", (r) => String(r.custodian_name ?? "")),
    badge("criticality", "Criticality", (r) => r.criticality),
    col("nbv", "Net book value", (r) => (r.net_book_value === null || r.net_book_value === undefined ? "—" : money(r.net_book_value))),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["asset_number", "name", "tag_code", "serial_number", "category_name", "location_name", "custodian_name"]),
  rowActions: [
    { label: "Assign", permission: "assets.assign", show: (r) => ["available", "assigned"].includes(String(r.status)), fields: [{ name: "userId", label: "Custodian", kind: "select", options: "users" }, { name: "departmentId", label: "Department", kind: "select", options: "departments" }, { name: "locationId", label: "Location", kind: "select", options: "locations" }], note: { label: "Reason" }, run: (r, note, v) => act("asset-assign", { assetId: r.id, ...v, reason: note }), success: "Assigned. The movement is recorded in the asset's history." },
    { label: "Return", permission: "assets.assign", show: (r) => r.status === "assigned", fields: [{ name: "conditionRating", label: "Condition on return", kind: "select", options: RATINGS, defaultValue: "good" }], run: (r, _n, v) => act("asset-return", { assetId: r.id, ...v }), success: "Returned and available." },
    { label: "Record usage", permission: "assets.depreciate", show: (r) => r.depreciation_method === "units_of_production" && ["available", "assigned", "in_maintenance"].includes(String(r.status)), fields: [{ name: "periodEnd", label: "Period end", kind: "date", required: true }, { name: "units", label: "Units used in the period", kind: "number", step: 1, min: 1, required: true }], run: (r, _n, v) => act("usage-record", { assetId: r.id, ...v }), success: "Usage recorded; the period's depreciation is calculated from it." },
  ],
};

const categories: RegisterConfig = {
  key: "categories",
  title: "Asset categories",
  description: "Depreciation policy and the ledger accounts each category posts to. Accounts must be active posting accounts of this company.",
  searchLabel: "Search categories",
  emptyTitle: "No categories",
  emptyDescription: "Create a category before registering assets.",
  source: { kind: "view", view: "categories" },
  createLabel: "New category",
  createPermission: "assets.settings.manage",
  save: { action: "category-save", success: "Category saved." },
  edit: { action: "category-save", permission: "assets.settings.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "usefulLifeMonths", label: "Useful life (months)", kind: "number", step: 1, min: 1, defaultValue: 60, rowKey: "useful_life_months" },
    { name: "depreciationMethod", label: "Depreciation method", kind: "select", options: METHODS, defaultValue: "straight_line", rowKey: "depreciation_method" },
    { name: "depreciationConvention", label: "Convention", kind: "select", options: CONVENTIONS, rowKey: "depreciation_convention" },
    { name: "decliningRate", label: "Declining-balance rate % (0 = double declining)", kind: "number", step: 0.01, rowKey: "declining_rate" },
    { name: "residualValuePercent", label: "Residual value %", kind: "number", step: 0.01, rowKey: "residual_value_percent" },
    { name: "capitalizationThreshold", label: "Capitalization threshold", kind: "number", step: 0.01, rowKey: "capitalization_threshold" },
    { name: "tagPrefix", label: "Tag prefix", kind: "text", rowKey: "tag_prefix" },
    accountField("assetAccountId", "Asset account"),
    accountField("accumulatedDepreciationAccountId", "Accumulated depreciation account"),
    accountField("depreciationExpenseAccountId", "Depreciation expense account"),
    accountField("gainLossAccountId", "Gain / loss on disposal account"),
    accountField("clearingAccountId", "Capitalization clearing account"),
    accountField("revaluationReserveAccountId", "Revaluation reserve account"),
    accountField("impairmentLossAccountId", "Impairment loss account"),
    accountField("proceedsAccountId", "Disposal proceeds account (bank / receivable)"),
  ].map((f) => (f.name.endsWith("AccountId") ? { ...f, rowKey: f.name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace("_id", "_id") } : f)) as FieldDef[],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), badge("method", "Method", (r) => r.depreciation_method), col("life", "Life (months)", (r) => quantity(r.useful_life_months)), col("threshold", "Threshold", (r) => money(r.capitalization_threshold)), col("assets", "Assets", (r) => quantity(r.asset_count)), badge("status", "Status", (r) => (r.active ? "active" : "retired"))],
  searchText: (r) => text(r, ["code", "name"]),
};

const locations: RegisterConfig = {
  key: "locations",
  title: "Locations",
  description: "Sites, buildings, floors and rooms. A location cannot be its own ancestor.",
  searchLabel: "Search locations",
  emptyTitle: "No locations",
  emptyDescription: "Add a site to place assets.",
  source: { kind: "view", view: "locations" },
  createLabel: "New location",
  createPermission: "assets.manage",
  save: { action: "location-save", success: "Location saved." },
  edit: { action: "location-save", permission: "assets.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "locationType", label: "Type", kind: "select", options: opts("site", "building", "floor", "room", "yard", "vehicle", "other"), defaultValue: "site", rowKey: "location_type" },
    { name: "parentId", label: "Inside", kind: "select", options: "locations", rowKey: "parent_id" },
    { name: "address", label: "Address", kind: "text" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), badge("type", "Type", (r) => r.location_type), col("parent", "Inside", (r) => String(r.parent_name ?? "")), col("assets", "Assets", (r) => quantity(r.asset_count))],
  searchText: (r) => text(r, ["code", "name", "parent_name"]),
};

// ------------------------------------------------------------------ F237/F238: acquisition and capitalization
const acquisition: RegisterConfig = {
  key: "acquisition",
  title: "Acquisition from supplier bills",
  description: "Posted supplier bill lines that have not become an asset yet. Creating an asset from a line happens once; the bill's own cost and date are used.",
  searchLabel: "Search bill lines",
  emptyTitle: "Nothing waiting",
  emptyDescription: "Posted bill lines that are not yet assets appear here.",
  source: { kind: "view", view: "source-lines" },
  columns: () => [strong("bill", "Bill", (r) => String(r.bill_number)), col("supplier", "Supplier", (r) => String(r.supplier_name ?? "")), col("desc", "Description", (r) => String(r.description ?? "")), col("date", "Bill date", (r) => calendarDate(r.bill_date)), col("amount", "Amount", (r) => money(r.net_amount))],
  searchText: (r) => text(r, ["bill_number", "supplier_name", "description"]),
  rowActions: [{ label: "Create asset", permission: "assets.create", fields: [{ name: "categoryId", label: "Category", kind: "select", required: true, options: "categories" }, { name: "name", label: "Name (defaults to the line description)", kind: "text" }], run: (r, _n, v) => act("asset-from-source", { sourceType: "vendor_bill_line", sourceId: r.id, ...v }), success: "Asset created from the bill line. Capitalize it next." }],
};

const capitalization: RegisterConfig = {
  key: "capitalization",
  title: "Capitalization",
  description: "Draft assets waiting to be capitalized. Capitalizing needs a different person from the one who registered the asset, meets the category threshold, books the cost to the ledger and creates the depreciation schedule.",
  searchLabel: "Search draft assets",
  emptyTitle: "No draft assets",
  emptyDescription: "Registered assets appear here until they are capitalized.",
  source: { kind: "view", view: "drafts" },
  columns: () => [strong("number", "Asset", (r) => String(r.asset_number)), col("name", "Name", (r) => String(r.name)), col("category", "Category", (r) => String(r.category_name ?? "")), col("cost", "Cost", (r) => (r.acquisition_cost === null ? "Restricted" : money(r.acquisition_cost))), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["asset_number", "name", "category_name"]),
  rowActions: [{ label: "Capitalize", permission: "assets.capitalize", fields: [{ name: "capitalizationDate", label: "Capitalization date", kind: "date" }, { name: "placedInServiceDate", label: "In-service date (blank = same)", kind: "date" }], run: (r, _n, v) => act("asset-capitalize", { id: r.id, ...v }), success: "Capitalized and posted to the ledger." }],
};

// ------------------------------------------------------------------ F239-F241: custody
const assignments: RegisterConfig = {
  key: "assignments",
  title: "Assignments",
  description: "Who holds what. Assigning an asset that is already assigned hands it over: the previous assignment is closed and both moves are recorded.",
  searchLabel: "Search assignments",
  emptyTitle: "No assignments",
  emptyDescription: "Assign an asset from the register.",
  source: { kind: "view", view: "assignments" },
  filters: [{ name: "status", label: "Status", options: opts("active", "returned") }],
  columns: () => [strong("asset", "Asset", (r) => String(r.asset_number)), col("name", "Name", (r) => String(r.asset_name)), col("custodian", "Custodian", (r) => String(r.custodian_name ?? "")), col("from", "Since", (r) => dateTime(r.assigned_from)), col("until", "Returned", (r) => dateTime(r.returned_at)), badge("status", "Status", (r) => r.assignment_status)],
  searchText: (r) => text(r, ["asset_number", "asset_name", "custodian_name"]),
  rowActions: [{ label: "Return", permission: "assets.assign", show: (r) => r.assignment_status === "active", fields: [{ name: "conditionRating", label: "Condition on return", kind: "select", options: RATINGS, defaultValue: "good" }], run: (r, _n, v) => act("asset-return", { assetId: r.asset_id, ...v }), success: "Returned." }],
};

const transfers: RegisterConfig = {
  key: "transfers",
  title: "Transfers",
  description: "Moving an asset to another location, department, cost centre or custodian. Requested, approved by someone else, then completed on its effective date.",
  searchLabel: "Search transfers",
  emptyTitle: "No transfers",
  emptyDescription: "Request a transfer to move an asset.",
  source: { kind: "view", view: "transfers" },
  filters: [{ name: "status", label: "Status", options: opts("submitted", "approved", "completed", "rejected", "cancelled") }],
  createLabel: "Request transfer",
  createPermission: "assets.transfer",
  save: { action: "transfer-request", success: "Transfer requested." },
  fields: [
    { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
    { name: "toLocationId", label: "To location", kind: "select", options: "locations" },
    { name: "toDepartmentId", label: "To department", kind: "select", options: "departments" },
    { name: "toCostCenterId", label: "To cost centre", kind: "select", options: "costCenters" },
    { name: "toUserId", label: "To custodian", kind: "select", options: "users" },
    { name: "effectiveDate", label: "Effective date", kind: "date" },
    { name: "reason", label: "Reason", kind: "textarea", required: true, wide: true },
  ],
  columns: () => [strong("number", "Transfer", (r) => String(r.transfer_number)), col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`), col("date", "Effective", (r) => calendarDate(r.effective_date)), col("reason", "Reason", (r) => String(r.reason ?? "")), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["transfer_number", "asset_number", "asset_name", "reason"]),
  rowActions: [
    { label: "Approve", permission: "assets.manage", show: (r) => r.status === "submitted", run: (r) => act("transfer-approve", { id: r.id }), success: "Approved." },
    { label: "Reject", permission: "assets.manage", show: (r) => r.status === "submitted", note: { label: "Reason", required: true }, run: (r, note) => act("transfer-reject", { id: r.id, reason: note }), success: "Rejected." },
    { label: "Complete", permission: "assets.transfer", show: (r) => r.status === "approved", run: (r) => act("transfer-complete", { id: r.id }), success: "Completed. The asset and its history are updated." },
    { label: "Cancel", permission: "assets.transfer", show: (r) => ["submitted", "approved"].includes(String(r.status)), run: (r) => act("transfer-cancel", { id: r.id }), success: "Cancelled." },
  ],
};

// ------------------------------------------------------------------ F242-F251: value
const runs: RegisterConfig = {
  key: "depreciation",
  title: "Depreciation runs",
  description: "A run collects every scheduled charge up to a period end. Someone other than the preparer approves it, posting books one journal per run, and a posted run can be reversed (latest first).",
  searchLabel: "Search runs",
  emptyTitle: "No runs",
  emptyDescription: "Prepare a run once assets are capitalized.",
  source: { kind: "view", view: "runs" },
  createLabel: "Prepare run",
  createPermission: "assets.depreciate",
  save: { action: "run-create", success: "Run prepared from the schedule." },
  fields: [{ name: "periodEnd", label: "Depreciate up to", kind: "date", required: true }],
  summary: (rows) => [{ label: "Total shown", value: money(rows.filter((r) => r.status !== "reversed").reduce((s, r) => s + Number(r.total_depreciation || 0), 0)) }],
  columns: () => [strong("number", "Run", (r) => String(r.run_number)), col("period", "Up to", (r) => calendarDate(r.period_end)), col("assets", "Assets", (r) => quantity(r.asset_count)), col("total", "Depreciation", (r) => money(r.total_depreciation)), badge("accounting", "Ledger", (r) => r.accounting_status), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["run_number", "status"]),
  rowActions: [
    { label: "Approve", permission: "assets.accounting.handoff", show: (r) => r.status === "calculated", run: (r) => act("run-approve", { id: r.id }), success: "Approved." },
    { label: "Post", permission: "assets.accounting.handoff", show: (r) => r.status === "approved", run: (r) => act("run-post", { id: r.id }), success: "Posted to the ledger." },
    { label: "Reverse", permission: "assets.accounting.handoff", show: (r) => r.status === "posted", note: { label: "Reason", required: true }, run: (r, note) => act("run-reverse", { id: r.id, reason: note }), success: "Reversed. The charges return to the schedule." },
  ],
};

const adjustmentColumns: RegisterConfig["columns"] = () => [strong("number", "Adjustment", (r) => String(r.adjustment_number)), col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`), badge("type", "Type", (r) => r.adjustment_type), col("date", "Effective", (r) => calendarDate(r.effective_date)), col("from", "Was", (r) => money(r.previous_net_book_value)), col("to", "Now", (r) => money(r.new_net_book_value)), badge("status", "Status", (r) => r.status)];
const adjustmentActions: RowAction[] = [
  { label: "Approve", permission: "assets.accounting.handoff", show: (r) => r.status === "pending_approval", run: (r) => act("adjustment-approve", { id: r.id }), success: "Approved and posted. The remaining schedule is recalculated." },
  { label: "Reject", permission: "assets.accounting.handoff", show: (r) => r.status === "pending_approval", note: { label: "Reason", required: true }, run: (r, note) => act("adjustment-reject", { id: r.id, reason: note }), success: "Rejected." },
  { label: "Cancel", permission: "assets.depreciate", show: (r) => r.status === "pending_approval", run: (r) => act("adjustment-cancel", { id: r.id }), success: "Cancelled." },
];
const adjustmentFields = (typeOptions?: ReturnType<typeof opts>): FieldDef[] => [
  { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
  ...(typeOptions ? [{ name: "adjustmentType", label: "Type", kind: "select", required: true, options: typeOptions, defaultValue: typeOptions[0].value } as FieldDef] : []),
  { name: "newNetBookValue", label: "New net book value", kind: "number", step: 0.01, required: true },
  { name: "effectiveDate", label: "Effective date", kind: "date" },
  { name: "reason", label: "Reason", kind: "textarea", required: true, wide: true },
  { name: "evidence", label: "Evidence / reference", kind: "text", wide: true },
];

const revaluation: RegisterConfig = {
  key: "revaluation",
  title: "Revaluation",
  description: "Restating an asset to a new value. An increase credits the revaluation reserve; a decrease uses any reserve first. A second person approves, and future depreciation is recalculated from the new value.",
  searchLabel: "Search adjustments",
  emptyTitle: "No revaluations",
  emptyDescription: "Request a revaluation for an in-service asset.",
  source: { kind: "view", view: "adjustments", params: { adjustmentType: "revaluation" } },
  createLabel: "Request revaluation",
  createPermission: "assets.depreciate",
  save: { action: "adjustment-request", fixed: { adjustmentType: "revaluation" }, success: "Requested. It awaits approval." },
  fields: adjustmentFields(),
  columns: adjustmentColumns,
  searchText: (r) => text(r, ["adjustment_number", "asset_number", "asset_name", "status"]),
  rowActions: adjustmentActions,
};

const impairment: RegisterConfig = {
  key: "impairment",
  title: "Impairment",
  description: "Writing an asset down when it is worth less than its carrying value, or reversing an earlier impairment (never more than was recognised). A second person approves.",
  searchLabel: "Search adjustments",
  emptyTitle: "No impairments",
  emptyDescription: "Request an impairment for an in-service asset.",
  source: { kind: "view", view: "adjustments", params: { adjustmentType: "impairment" } },
  createLabel: "Request impairment",
  createPermission: "assets.depreciate",
  save: { action: "adjustment-request", success: "Requested. It awaits approval." },
  fields: adjustmentFields(opts("impairment", "impairment_reversal")),
  columns: adjustmentColumns,
  searchText: (r) => text(r, ["adjustment_number", "asset_number", "asset_name", "status"]),
  rowActions: adjustmentActions,
};

// ------------------------------------------------------------------ F252-F257: maintenance
const plans: RegisterConfig = {
  key: "maintenance-plans",
  title: "Maintenance plans",
  description: "Recurring preventive work. Generating due work turns every plan inside its lead window into a planned work order, once.",
  searchLabel: "Search plans",
  emptyTitle: "No plans",
  emptyDescription: "Create a plan for an asset.",
  source: { kind: "view", view: "plans" },
  createLabel: "New plan",
  createPermission: "assets.maintain",
  save: { action: "plan-save", success: "Plan saved." },
  fields: [
    { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "maintenanceType", label: "Type", kind: "select", options: opts("preventive", "predictive", "inspection", "calibration", "statutory"), defaultValue: "preventive" },
    { name: "frequencyUnit", label: "Every", kind: "select", required: true, options: opts("days", "weeks", "months", "years"), defaultValue: "months" },
    { name: "frequencyValue", label: "Interval", kind: "number", step: 1, min: 1, required: true, defaultValue: 3 },
    { name: "nextDueDate", label: "Next due", kind: "date" },
    { name: "leadDays", label: "Lead days", kind: "number", step: 1 },
    { name: "instructions", label: "Instructions", kind: "textarea", wide: true },
  ],
  columns: () => [strong("asset", "Asset", (r) => String(r.asset_number)), col("name", "Plan", (r) => String(r.name)), badge("type", "Type", (r) => r.maintenance_type), col("every", "Every", (r) => `${r.frequency_value} ${r.frequency_unit}`), col("due", "Next due", (r) => calendarDate(r.next_due_date)), badge("overdue", "Due", (r) => (r.overdue ? "overdue" : "active"))],
  searchText: (r) => text(r, ["asset_number", "asset_name", "name"]),
  rowActions: [{ label: "Generate due work", permission: "assets.maintain", run: () => act("plans-generate", {}), success: "Due plans have been turned into work orders." }],
};

const orders: RegisterConfig = {
  key: "work-orders",
  title: "Work orders",
  description: "Preventive, corrective and breakdown work. A breakdown can take the asset out of service and opens downtime; completing the order restores it and closes the downtime.",
  searchLabel: "Search work orders",
  emptyTitle: "No work orders",
  emptyDescription: "Raise a work order or generate the ones due.",
  source: { kind: "view", view: "work-orders" },
  filters: [{ name: "status", label: "Status", options: opts("planned", "in_progress", "on_hold", "completed", "cancelled") }],
  createLabel: "New work order",
  createPermission: "assets.maintain",
  save: { action: "order-create", success: "Work order created." },
  fields: [
    { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
    { name: "maintenanceType", label: "Type", kind: "select", options: opts("corrective", "breakdown", "preventive", "inspection", "statutory"), defaultValue: "corrective" },
    { name: "priority", label: "Priority", kind: "select", options: opts("low", "normal", "high", "urgent"), defaultValue: "normal" },
    { name: "takeOutOfService", label: "Take the asset out of service", kind: "bool", defaultValue: "false" },
    { name: "scheduledStartAt", label: "Scheduled start", kind: "datetime" },
    { name: "problemDescription", label: "Problem", kind: "textarea", wide: true },
  ],
  summary: (rows) => [{ label: "Total cost shown", value: money(rows.reduce((s, r) => s + Number(r.total_cost || 0), 0)) }],
  columns: () => [strong("number", "Order", (r) => String(r.work_order_number)), col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`), badge("type", "Type", (r) => r.maintenance_type), badge("priority", "Priority", (r) => r.priority), col("cost", "Cost", (r) => money(r.total_cost)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["work_order_number", "asset_number", "asset_name", "problem_description"]),
  rowActions: [
    { label: "Start", permission: "assets.maintain", show: (r) => ["planned", "scheduled", "on_hold"].includes(String(r.status)), run: (r) => act("order-start", { id: r.id }), success: "In progress." },
    { label: "Hold", permission: "assets.maintain", show: (r) => r.status === "in_progress", note: { label: "Reason", required: true }, run: (r, note) => act("order-hold", { id: r.id, reason: note }), success: "On hold." },
    { label: "Complete", permission: "assets.maintain", show: (r) => ["planned", "scheduled", "in_progress", "on_hold"].includes(String(r.status)), fields: [{ name: "laborCost", label: "Labour cost", kind: "number", step: 0.01 }, { name: "externalCost", label: "External cost", kind: "number", step: 0.01 }, { name: "resolution", label: "Resolution (required for repairs)", kind: "text" }, { name: "failureCause", label: "Failure cause", kind: "text" }], note: { label: "Findings" }, run: (r, note, v) => act("order-complete", { id: r.id, findings: note, ...v }), success: "Completed. The asset is back in service." },
    { label: "Cancel", permission: "assets.maintain", show: (r) => ["planned", "scheduled", "in_progress", "on_hold"].includes(String(r.status)), note: { label: "Reason", required: true }, run: (r, note) => act("order-cancel", { id: r.id, reason: note }), success: "Cancelled." },
  ],
};

const downtime: RegisterConfig = {
  key: "downtime",
  title: "Downtime",
  description: "When assets were unavailable and why. Breakdown work orders open and close downtime automatically; record any other outage here.",
  searchLabel: "Search downtime",
  emptyTitle: "No downtime recorded",
  emptyDescription: "Downtime appears when a breakdown is logged.",
  source: { kind: "view", view: "downtime" },
  createLabel: "Record downtime",
  createPermission: "assets.maintain",
  save: { action: "downtime-record", success: "Downtime recorded." },
  fields: [
    { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
    { name: "category", label: "Category", kind: "select", options: opts("breakdown", "planned", "other"), defaultValue: "breakdown" },
    { name: "startedAt", label: "Started", kind: "datetime", required: true },
    { name: "endedAt", label: "Ended (blank = still down)", kind: "datetime" },
    { name: "reason", label: "Reason", kind: "text", wide: true },
  ],
  summary: (rows) => [{ label: "Hours shown", value: quantity(rows.reduce((s, r) => s + Number(r.hours || 0), 0)) }],
  columns: () => [strong("asset", "Asset", (r) => String(r.asset_number)), badge("category", "Category", (r) => r.category), col("start", "Started", (r) => dateTime(r.started_at)), col("end", "Ended", (r) => (r.ended_at ? dateTime(r.ended_at) : "Still down")), col("hours", "Hours", (r) => quantity(r.hours))],
  searchText: (r) => text(r, ["asset_number", "asset_name", "reason"]),
  rowActions: [{ label: "End now", permission: "assets.maintain", show: (r) => !r.ended_at, run: (r) => act("downtime-end", { id: r.id }), success: "Downtime closed." }],
};

const warranties: RegisterConfig = {
  key: "warranties",
  title: "Warranties",
  description: "Coverage per asset, flagged as expiring inside the alert window. A claim must fall within the warranty period.",
  searchLabel: "Search warranties",
  emptyTitle: "No warranties",
  emptyDescription: "Add a warranty to an asset.",
  source: { kind: "view", view: "warranties" },
  createLabel: "Add warranty",
  createPermission: "assets.maintain",
  save: { action: "warranty-save", success: "Warranty added." },
  fields: [
    { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
    { name: "providerName", label: "Provider", kind: "text" },
    { name: "warrantyType", label: "Type", kind: "select", options: opts("manufacturer", "extended", "service_contract", "amc"), defaultValue: "manufacturer" },
    { name: "startDate", label: "Start", kind: "date", required: true },
    { name: "endDate", label: "End", kind: "date", required: true },
    { name: "coverage", label: "Coverage", kind: "text", wide: true },
  ],
  columns: () => [strong("asset", "Asset", (r) => String(r.asset_number)), col("provider", "Provider", (r) => String(r.provider_name ?? "")), badge("type", "Type", (r) => r.warranty_type), col("end", "Ends", (r) => calendarDate(r.end_date)), col("days", "Days left", (r) => quantity(r.days_remaining)), badge("status", "Status", (r) => r.warranty_status)],
  searchText: (r) => text(r, ["asset_number", "asset_name", "provider_name"]),
  rowActions: [{ label: "Raise claim", permission: "assets.maintain", show: (r) => r.warranty_status !== "expired", fields: [{ name: "claimDate", label: "Claim date", kind: "date" }, { name: "claimedAmount", label: "Claimed amount", kind: "number", step: 0.01 }], note: { label: "What failed", required: true }, run: (r, note, v) => act("claim-create", { warrantyId: r.id, description: note, ...v }), success: "Claim raised." }],
};

// ------------------------------------------------------------------ F258/F259: inspection and calibration
const inspections: RegisterConfig = {
  key: "inspections",
  title: "Inspections",
  description: "Condition, custody and safety inspections. A failed inspection raises a corrective work order and updates the asset's condition.",
  searchLabel: "Search inspections",
  emptyTitle: "No inspections",
  emptyDescription: "Record an inspection.",
  source: { kind: "view", view: "inspections" },
  filters: [{ name: "result", label: "Result", options: opts("pass", "conditional", "fail") }],
  createLabel: "Record inspection",
  createPermission: "assets.inspect",
  save: { action: "inspection-record", success: "Inspection recorded." },
  fields: [
    { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
    { name: "inspectionType", label: "Type", kind: "select", options: opts("condition", "custody", "safety", "compliance"), defaultValue: "condition" },
    { name: "result", label: "Result", kind: "select", required: true, options: opts("pass", "conditional", "fail"), defaultValue: "pass" },
    { name: "conditionRating", label: "Condition", kind: "select", options: RATINGS, defaultValue: "good" },
    { name: "locationVerified", label: "Location verified", kind: "bool", defaultValue: "true" },
    { name: "custodianVerified", label: "Custodian verified", kind: "bool", defaultValue: "true" },
    { name: "takeOutOfService", label: "Take out of service if it fails", kind: "bool", defaultValue: "false" },
    { name: "findings", label: "Findings", kind: "textarea", wide: true },
  ],
  columns: () => [strong("number", "Inspection", (r) => String(r.inspection_number)), col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`), col("date", "Date", (r) => calendarDate(r.inspection_date)), badge("result", "Result", (r) => r.result), badge("condition", "Condition", (r) => r.condition_rating), col("verified", "Location / custodian", (r) => `${yes(r.location_verified)} / ${yes(r.custodian_verified)}`)],
  searchText: (r) => text(r, ["inspection_number", "asset_number", "asset_name", "findings"]),
};

const calibrations: RegisterConfig = {
  key: "calibration",
  title: "Calibration",
  description: "Measuring equipment calibration with as-found and as-left readings. A failed calibration takes the equipment out of service and raises a corrective order.",
  searchLabel: "Search calibrations",
  emptyTitle: "No calibrations",
  emptyDescription: "Record a calibration.",
  source: { kind: "view", view: "calibrations" },
  createLabel: "Record calibration",
  createPermission: "assets.inspect",
  save: { action: "calibration-record", success: "Calibration recorded." },
  fields: [
    { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
    { name: "calibratedOn", label: "Calibrated on", kind: "date" },
    { name: "dueOn", label: "Next due", kind: "date", required: true },
    { name: "result", label: "Result", kind: "select", required: true, options: opts("pass", "adjusted", "fail"), defaultValue: "pass" },
    { name: "asFound", label: "As found", kind: "text" },
    { name: "asLeft", label: "As left", kind: "text" },
    { name: "certificateNumber", label: "Certificate no.", kind: "text" },
    { name: "standardReference", label: "Standard / lab", kind: "text" },
  ],
  columns: () => [strong("number", "Calibration", (r) => String(r.calibration_number)), col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`), col("on", "Calibrated", (r) => calendarDate(r.calibrated_on)), col("due", "Next due", (r) => calendarDate(r.due_on)), badge("result", "Result", (r) => r.result), badge("status", "Status", (r) => r.calibration_status)],
  searchText: (r) => text(r, ["calibration_number", "asset_number", "asset_name", "certificate_number"]),
};

// ------------------------------------------------------------------ F262-F265: disposal
const disposalColumns: RegisterConfig["columns"] = () => [strong("number", "Disposal", (r) => String(r.disposal_number)), col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`), badge("method", "Method", (r) => r.disposal_method), col("date", "Date", (r) => calendarDate(r.disposal_date)), col("proceeds", "Proceeds", (r) => money(r.proceeds_amount)), col("gl", "Gain / loss", (r) => (r.status === "completed" ? money(r.gain_loss_amount) : "—")), badge("status", "Status", (r) => r.status)];
const disposalActions: RowAction[] = [
  { label: "Approve", permission: "assets.accounting.handoff", show: (r) => r.status === "pending_approval", run: (r) => act("disposal-approve", { id: r.id }), success: "Approved." },
  { label: "Reject", permission: "assets.accounting.handoff", show: (r) => ["pending_approval", "approved"].includes(String(r.status)), note: { label: "Reason", required: true }, run: (r, note) => act("disposal-reject", { id: r.id, reason: note }), success: "Rejected. The asset returns to its earlier status." },
  { label: "Complete", permission: "assets.dispose", show: (r) => r.status === "approved", run: (r) => act("disposal-complete", { id: r.id }), success: "Completed. Gain or loss is posted and the asset is derecognised." },
  { label: "Cancel", permission: "assets.dispose", show: (r) => ["pending_approval", "approved"].includes(String(r.status)), run: (r) => act("disposal-cancel", { id: r.id }), success: "Cancelled." },
];
const disposalFields = (methods: ReturnType<typeof opts>): FieldDef[] => [
  { name: "assetId", label: "Asset", kind: "select", required: true, options: "assets" },
  { name: "disposalMethod", label: "Method", kind: "select", required: true, options: methods, defaultValue: methods[0].value },
  { name: "disposalDate", label: "Disposal date", kind: "date" },
  { name: "proceedsAmount", label: "Proceeds", kind: "number", step: 0.01 },
  { name: "disposalCost", label: "Disposal cost", kind: "number", step: 0.01 },
  { name: "buyerPartyId", label: "Buyer (sales)", kind: "select", options: "customers" },
  { name: "saleReference", label: "Sale reference", kind: "text" },
  { name: "reason", label: "Reason", kind: "textarea", required: true, wide: true },
];

const retirement: RegisterConfig = {
  key: "retirement",
  title: "Retirement and write-off",
  description: "Scrapping, writing off or donating an asset. Approved by someone else; completing derecognises the asset and books any loss.",
  searchLabel: "Search",
  emptyTitle: "Nothing retired",
  emptyDescription: "Request a scrap or write-off.",
  source: { kind: "view", view: "disposals", params: { group: "retire" } },
  createLabel: "Request retirement",
  createPermission: "assets.dispose",
  save: { action: "disposal-request", success: "Requested. It awaits approval." },
  fields: disposalFields(opts("scrap", "write_off", "donation")),
  columns: disposalColumns,
  searchText: (r) => text(r, ["disposal_number", "asset_number", "asset_name", "status"]),
  rowActions: disposalActions,
};

const disposal: RegisterConfig = {
  key: "disposal",
  title: "Disposal and sale",
  description: "Selling an asset or returning it to a vendor. Gain or loss is proceeds less costs less the carrying value; depreciation to the disposal date must be posted first.",
  searchLabel: "Search",
  emptyTitle: "No disposals",
  emptyDescription: "Request a sale.",
  source: { kind: "view", view: "disposals", params: { group: "sale" } },
  createLabel: "Request sale",
  createPermission: "assets.dispose",
  save: { action: "disposal-request", success: "Requested. It awaits approval." },
  fields: disposalFields(opts("sale", "return_to_vendor")),
  columns: disposalColumns,
  searchText: (r) => text(r, ["disposal_number", "asset_number", "asset_name", "status"]),
  rowActions: disposalActions,
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  register, categories, locations, acquisition, capitalization, assignments, transfers, depreciation: runs, revaluation, impairment,
  "maintenance-plans": plans, "work-orders": orders, downtime, warranties, inspections, calibration: calibrations, retirement, disposal,
};
