"use client";

import { act } from "@/features/assets/shared/client";
import type { FieldDef } from "@/features/assets/shared/FieldInput";
import type {
  RegisterConfig,
  RowAction,
} from "@/features/assets/shared/Register";
import {
  badge,
  calendarDate,
  col,
  dateTime,
  money,
  opts,
  quantity,
  strong,
  text,
} from "@/features/assets/shared/helpers";

const METHODS = opts("straight_line", "none");
const CONVENTIONS = opts("full_month", "mid_month", "next_month");
const RATINGS = opts("excellent", "good", "fair", "poor", "critical");
const CRIT = opts("low", "medium", "high", "critical");

const accountField = (name: string, label: string): FieldDef => ({
  name,
  label,
  kind: "select",
  options: "accounts",
});

// ------------------------------------------------------------------ F231-F236: the register
const register: RegisterConfig = {
  key: "register",
  title: "Asset register",
  description:
    "Every asset with its identity, custody, location and condition. Value figures appear only to people with financial access; a custodian sees just the assets assigned to them.",
  searchLabel: "Search assets, tags, serial numbers",
  emptyTitle: "No assets yet",
  emptyDescription:
    "Register an asset, or create one from a posted supplier bill.",
  source: { kind: "view", view: "register" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "draft",
        "available",
        "assigned",
        "in_maintenance",
        "pending_disposal",
        "lost",
        "disposed",
      ),
    },
    { name: "criticality", label: "Criticality", options: CRIT },
  ],
  createLabel: "Register asset",
  createPermission: "assets.create",
  save: {
    action: "asset-register",
    success:
      "Asset registered as a draft. Capitalize it to start depreciation.",
  },
  edit: {
    action: "asset-update",
    permission: "assets.manage",
    show: (r) => r.status !== "disposed",
  },
  fields: [
    { name: "name", label: "Name", kind: "text", required: true },
    {
      name: "categoryId",
      label: "Category",
      kind: "select",
      required: true,
      options: "categories",
      createOnly: true,
    },
    {
      name: "acquisitionCost",
      label: "Acquisition cost",
      kind: "number",
      step: 0.01,
      createOnly: true,
    },
    {
      name: "acquisitionDate",
      label: "Acquisition date",
      kind: "date",
      createOnly: true,
    },
    {
      name: "serialNumber",
      label: "Serial number",
      kind: "text",
      rowKey: "serial_number",
    },
    { name: "manufacturer", label: "Manufacturer", kind: "text" },
    { name: "model", label: "Model", kind: "text" },
    {
      name: "locationId",
      label: "Location",
      kind: "select",
      options: "locations",
      createOnly: true,
    },
    {
      name: "departmentId",
      label: "Department",
      kind: "select",
      options: "departments",
      createOnly: true,
    },
    {
      name: "supplierId",
      label: "Supplier",
      kind: "select",
      options: "suppliers",
      rowKey: "supplier_id",
    },
    {
      name: "parentAssetId",
      label: "Component of",
      kind: "select",
      options: "assets",
      rowKey: "parent_asset_id",
    },
    {
      name: "criticality",
      label: "Criticality",
      kind: "select",
      options: CRIT,
      defaultValue: "medium",
    },
    {
      name: "ownership",
      label: "Ownership",
      kind: "select",
      options: opts("owned", "leased", "loaned"),
      defaultValue: "owned",
    },
    { name: "notes", label: "Notes", kind: "textarea", wide: true },
  ],
  summary: (rows) => [
    { label: "Assets shown", value: String(rows.length) },
    {
      label: "Net book value",
      value: rows.some(
        (r) => r.net_book_value !== null && r.net_book_value !== undefined,
      )
        ? money(rows.reduce((s, r) => s + Number(r.net_book_value || 0), 0))
        : "Restricted",
    },
  ],
  columns: () => [
    strong("number", "Asset", (r) => String(r.asset_number)),
    col("name", "Name", (r) => String(r.name)),
    col("category", "Category", (r) => String(r.category_name ?? "")),
    col("location", "Location", (r) => String(r.location_name ?? "")),
    col("custodian", "Custodian", (r) => String(r.custodian_name ?? "")),
    badge("criticality", "Criticality", (r) => r.criticality),
    col("nbv", "Net book value", (r) =>
      r.net_book_value === null || r.net_book_value === undefined
        ? "—"
        : money(r.net_book_value),
    ),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, [
      "asset_number",
      "name",
      "tag_code",
      "serial_number",
      "category_name",
      "location_name",
      "custodian_name",
    ]),
  rowActions: [
    {
      label: "Assign",
      permission: "assets.assign",
      show: (r) => ["available", "assigned"].includes(String(r.status)),
      fields: [
        {
          name: "userId",
          label: "Custodian",
          kind: "select",
          options: "users",
        },
        {
          name: "departmentId",
          label: "Department",
          kind: "select",
          options: "departments",
        },
        {
          name: "locationId",
          label: "Location",
          kind: "select",
          options: "locations",
        },
      ],
      note: { label: "Reason" },
      run: (r, note, v) =>
        act("asset-assign", { assetId: r.id, ...v, reason: note }),
      success: "Assigned. The movement is recorded in the asset's history.",
    },
    {
      label: "Return",
      permission: "assets.assign",
      show: (r) => r.status === "assigned",
      fields: [
        {
          name: "conditionRating",
          label: "Condition on return",
          kind: "select",
          options: RATINGS,
          defaultValue: "good",
        },
      ],
      run: (r, _n, v) => act("asset-return", { assetId: r.id, ...v }),
      success: "Returned and available.",
    },
  ],
};

const categories: RegisterConfig = {
  key: "categories",
  title: "Asset categories",
  description:
    "Depreciation policy and the ledger accounts each category posts to. Accounts must be active posting accounts of this company.",
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
    {
      name: "usefulLifeMonths",
      label: "Useful life (months)",
      kind: "number",
      step: 1,
      min: 1,
      defaultValue: 60,
      rowKey: "useful_life_months",
    },
    {
      name: "depreciationMethod",
      label: "Depreciation method",
      kind: "select",
      options: METHODS,
      defaultValue: "straight_line",
      rowKey: "depreciation_method",
    },
    {
      name: "depreciationConvention",
      label: "Convention",
      kind: "select",
      options: CONVENTIONS,
      rowKey: "depreciation_convention",
    },
    {
      name: "residualValuePercent",
      label: "Residual value %",
      kind: "number",
      step: 0.01,
      rowKey: "residual_value_percent",
    },
    {
      name: "capitalizationThreshold",
      label: "Capitalization threshold",
      kind: "number",
      step: 0.01,
      rowKey: "capitalization_threshold",
    },
    {
      name: "tagPrefix",
      label: "Tag prefix",
      kind: "text",
      rowKey: "tag_prefix",
    },
    accountField("assetAccountId", "Asset account"),
    accountField(
      "accumulatedDepreciationAccountId",
      "Accumulated depreciation account",
    ),
    accountField(
      "depreciationExpenseAccountId",
      "Depreciation expense account",
    ),
    accountField("gainLossAccountId", "Gain / loss on disposal account"),
    accountField("clearingAccountId", "Capitalization clearing account"),
    accountField("revaluationReserveAccountId", "Revaluation reserve account"),
    accountField("impairmentLossAccountId", "Impairment loss account"),
    accountField(
      "proceedsAccountId",
      "Disposal proceeds account (bank / receivable)",
    ),
  ].map((f) =>
    f.name.endsWith("AccountId")
      ? {
          ...f,
          rowKey: f.name
            .replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
            .replace("_id", "_id"),
        }
      : f,
  ) as FieldDef[],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    badge("method", "Method", (r) => r.depreciation_method),
    col("life", "Life (months)", (r) => quantity(r.useful_life_months)),
    col("threshold", "Threshold", (r) => money(r.capitalization_threshold)),
    col("assets", "Assets", (r) => quantity(r.asset_count)),
    badge("status", "Status", (r) => (r.active ? "active" : "retired")),
  ],
  searchText: (r) => text(r, ["code", "name"]),
};

const locations: RegisterConfig = {
  key: "locations",
  title: "Locations",
  description:
    "Sites, buildings, floors and rooms. A location cannot be its own ancestor.",
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
    {
      name: "locationType",
      label: "Type",
      kind: "select",
      options: opts(
        "site",
        "building",
        "floor",
        "room",
        "yard",
        "vehicle",
        "other",
      ),
      defaultValue: "site",
      rowKey: "location_type",
    },
    {
      name: "parentId",
      label: "Inside",
      kind: "select",
      options: "locations",
      rowKey: "parent_id",
    },
    { name: "address", label: "Address", kind: "text" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    badge("type", "Type", (r) => r.location_type),
    col("parent", "Inside", (r) => String(r.parent_name ?? "")),
    col("assets", "Assets", (r) => quantity(r.asset_count)),
  ],
  searchText: (r) => text(r, ["code", "name", "parent_name"]),
};

// ------------------------------------------------------------------ F237/F238: acquisition and capitalization
const acquisition: RegisterConfig = {
  key: "acquisition",
  title: "Acquisition from supplier bills",
  description:
    "Posted supplier bill lines that have not become an asset yet. Creating an asset from a line happens once; the bill's own cost and date are used.",
  searchLabel: "Search bill lines",
  emptyTitle: "Nothing waiting",
  emptyDescription: "Posted bill lines that are not yet assets appear here.",
  source: { kind: "view", view: "source-lines" },
  columns: () => [
    strong("bill", "Bill", (r) => String(r.bill_number)),
    col("supplier", "Supplier", (r) => String(r.supplier_name ?? "")),
    col("desc", "Description", (r) => String(r.description ?? "")),
    col("date", "Bill date", (r) => calendarDate(r.bill_date)),
    col("amount", "Amount", (r) => money(r.net_amount)),
  ],
  searchText: (r) => text(r, ["bill_number", "supplier_name", "description"]),
  rowActions: [
    {
      label: "Create asset",
      permission: "assets.create",
      fields: [
        {
          name: "categoryId",
          label: "Category",
          kind: "select",
          required: true,
          options: "categories",
        },
        {
          name: "name",
          label: "Name (defaults to the line description)",
          kind: "text",
        },
      ],
      run: (r, _n, v) =>
        act("asset-from-source", {
          sourceType: "vendor_bill_line",
          sourceId: r.id,
          ...v,
        }),
      success: "Asset created from the bill line. Capitalize it next.",
    },
  ],
};

const capitalization: RegisterConfig = {
  key: "capitalization",
  title: "Capitalization",
  description:
    "Draft assets waiting to be capitalized. Capitalizing needs a different person from the one who registered the asset, meets the category threshold, books the cost to the ledger and creates the depreciation schedule.",
  searchLabel: "Search draft assets",
  emptyTitle: "No draft assets",
  emptyDescription: "Registered assets appear here until they are capitalized.",
  source: { kind: "view", view: "drafts" },
  columns: () => [
    strong("number", "Asset", (r) => String(r.asset_number)),
    col("name", "Name", (r) => String(r.name)),
    col("category", "Category", (r) => String(r.category_name ?? "")),
    col("cost", "Cost", (r) =>
      r.acquisition_cost === null ? "Restricted" : money(r.acquisition_cost),
    ),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["asset_number", "name", "category_name"]),
  rowActions: [
    {
      label: "Capitalize",
      permission: "assets.capitalize",
      fields: [
        {
          name: "capitalizationDate",
          label: "Capitalization date",
          kind: "date",
        },
        {
          name: "placedInServiceDate",
          label: "In-service date (blank = same)",
          kind: "date",
        },
      ],
      run: (r, _n, v) => act("asset-capitalize", { id: r.id, ...v }),
      success: "Capitalized and posted to the ledger.",
    },
  ],
};

// ------------------------------------------------------------------ F239-F241: custody
const assignments: RegisterConfig = {
  key: "assignments",
  title: "Assignments",
  description:
    "Who holds what. Assigning an asset that is already assigned hands it over: the previous assignment is closed and both moves are recorded.",
  searchLabel: "Search assignments",
  emptyTitle: "No assignments",
  emptyDescription: "Assign an asset from the register.",
  source: { kind: "view", view: "assignments" },
  filters: [
    { name: "status", label: "Status", options: opts("active", "returned") },
  ],
  columns: () => [
    strong("asset", "Asset", (r) => String(r.asset_number)),
    col("name", "Name", (r) => String(r.asset_name)),
    col("custodian", "Custodian", (r) => String(r.custodian_name ?? "")),
    col("from", "Since", (r) => dateTime(r.assigned_from)),
    col("until", "Returned", (r) => dateTime(r.returned_at)),
    badge("status", "Status", (r) => r.assignment_status),
  ],
  searchText: (r) => text(r, ["asset_number", "asset_name", "custodian_name"]),
  rowActions: [
    {
      label: "Return",
      permission: "assets.assign",
      show: (r) => r.assignment_status === "active",
      fields: [
        {
          name: "conditionRating",
          label: "Condition on return",
          kind: "select",
          options: RATINGS,
          defaultValue: "good",
        },
      ],
      run: (r, _n, v) => act("asset-return", { assetId: r.asset_id, ...v }),
      success: "Returned.",
    },
  ],
};

const transfers: RegisterConfig = {
  key: "transfers",
  title: "Transfers",
  description:
    "Moving an asset to another location, department, cost centre or custodian. Requested, approved by someone else, then completed on its effective date.",
  searchLabel: "Search transfers",
  emptyTitle: "No transfers",
  emptyDescription: "Request a transfer to move an asset.",
  source: { kind: "view", view: "transfers" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "submitted",
        "approved",
        "completed",
        "rejected",
        "cancelled",
      ),
    },
  ],
  createLabel: "Request transfer",
  createPermission: "assets.transfer",
  save: { action: "transfer-request", success: "Transfer requested." },
  fields: [
    {
      name: "assetId",
      label: "Asset",
      kind: "select",
      required: true,
      options: "assets",
    },
    {
      name: "toLocationId",
      label: "To location",
      kind: "select",
      options: "locations",
    },
    {
      name: "toDepartmentId",
      label: "To department",
      kind: "select",
      options: "departments",
    },
    {
      name: "toCostCenterId",
      label: "To cost centre",
      kind: "select",
      options: "costCenters",
    },
    {
      name: "toUserId",
      label: "To custodian",
      kind: "select",
      options: "users",
    },
    { name: "effectiveDate", label: "Effective date", kind: "date" },
    {
      name: "reason",
      label: "Reason",
      kind: "textarea",
      required: true,
      wide: true,
    },
  ],
  columns: () => [
    strong("number", "Transfer", (r) => String(r.transfer_number)),
    col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`),
    col("date", "Effective", (r) => calendarDate(r.effective_date)),
    col("reason", "Reason", (r) => String(r.reason ?? "")),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, ["transfer_number", "asset_number", "asset_name", "reason"]),
  rowActions: [
    {
      label: "Approve",
      permission: "assets.manage",
      show: (r) => r.status === "submitted",
      run: (r) => act("transfer-approve", { id: r.id }),
      success: "Approved.",
    },
    {
      label: "Reject",
      permission: "assets.manage",
      show: (r) => r.status === "submitted",
      note: { label: "Reason", required: true },
      run: (r, note) => act("transfer-reject", { id: r.id, reason: note }),
      success: "Rejected.",
    },
    {
      label: "Complete",
      permission: "assets.transfer",
      show: (r) => r.status === "approved",
      run: (r) => act("transfer-complete", { id: r.id }),
      success: "Completed. The asset and its history are updated.",
    },
    {
      label: "Cancel",
      permission: "assets.transfer",
      show: (r) => ["submitted", "approved"].includes(String(r.status)),
      run: (r) => act("transfer-cancel", { id: r.id }),
      success: "Cancelled.",
    },
  ],
};

// ------------------------------------------------------------------ F242-F251: value
const runs: RegisterConfig = {
  key: "depreciation",
  title: "Depreciation runs",
  description:
    "A run collects every scheduled charge up to a period end. Someone other than the preparer approves it, posting books one journal per run, and a posted run can be reversed (latest first).",
  searchLabel: "Search runs",
  emptyTitle: "No runs",
  emptyDescription: "Prepare a run once assets are capitalized.",
  source: { kind: "view", view: "runs" },
  createLabel: "Prepare run",
  createPermission: "assets.depreciate",
  save: { action: "run-create", success: "Run prepared from the schedule." },
  fields: [
    {
      name: "periodEnd",
      label: "Depreciate up to",
      kind: "date",
      required: true,
    },
  ],
  summary: (rows) => [
    {
      label: "Total shown",
      value: money(
        rows
          .filter((r) => r.status !== "reversed")
          .reduce((s, r) => s + Number(r.total_depreciation || 0), 0),
      ),
    },
  ],
  columns: () => [
    strong("number", "Run", (r) => String(r.run_number)),
    col("period", "Up to", (r) => calendarDate(r.period_end)),
    col("assets", "Assets", (r) => quantity(r.asset_count)),
    col("total", "Depreciation", (r) => money(r.total_depreciation)),
    badge("accounting", "Ledger", (r) => r.accounting_status),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["run_number", "status"]),
  rowActions: [
    {
      label: "Approve",
      permission: "assets.accounting.handoff",
      show: (r) => r.status === "calculated",
      run: (r) => act("run-approve", { id: r.id }),
      success: "Approved.",
    },
    {
      label: "Post",
      permission: "assets.accounting.handoff",
      show: (r) => r.status === "approved",
      run: (r) => act("run-post", { id: r.id }),
      success: "Posted to the ledger.",
    },
    {
      label: "Reverse",
      permission: "assets.accounting.handoff",
      show: (r) => r.status === "posted",
      note: { label: "Reason", required: true },
      run: (r, note) => act("run-reverse", { id: r.id, reason: note }),
      success: "Reversed. The charges return to the schedule.",
    },
  ],
};

// ------------------------------------------------------------------ F252-F257: maintenance
const plans: RegisterConfig = {
  key: "maintenance-plans",
  title: "Maintenance plans",
  description:
    "Recurring preventive work. Generating due work turns every plan inside its lead window into a planned work order, once.",
  searchLabel: "Search plans",
  emptyTitle: "No plans",
  emptyDescription: "Create a plan for an asset.",
  source: { kind: "view", view: "plans" },
  createLabel: "New plan",
  createPermission: "assets.maintain",
  save: { action: "plan-save", success: "Plan saved." },
  fields: [
    {
      name: "assetId",
      label: "Asset",
      kind: "select",
      required: true,
      options: "assets",
    },
    { name: "name", label: "Name", kind: "text", required: true },
    {
      name: "maintenanceType",
      label: "Type",
      kind: "select",
      options: opts(
        "preventive",
        "predictive",
        "inspection",
        "calibration",
        "statutory",
      ),
      defaultValue: "preventive",
    },
    {
      name: "frequencyUnit",
      label: "Every",
      kind: "select",
      required: true,
      options: opts("days", "weeks", "months", "years"),
      defaultValue: "months",
    },
    {
      name: "frequencyValue",
      label: "Interval",
      kind: "number",
      step: 1,
      min: 1,
      required: true,
      defaultValue: 3,
    },
    { name: "nextDueDate", label: "Next due", kind: "date" },
    { name: "leadDays", label: "Lead days", kind: "number", step: 1 },
    {
      name: "instructions",
      label: "Instructions",
      kind: "textarea",
      wide: true,
    },
  ],
  columns: () => [
    strong("asset", "Asset", (r) => String(r.asset_number)),
    col("name", "Plan", (r) => String(r.name)),
    badge("type", "Type", (r) => r.maintenance_type),
    col("every", "Every", (r) => `${r.frequency_value} ${r.frequency_unit}`),
    col("due", "Next due", (r) => calendarDate(r.next_due_date)),
    badge("overdue", "Due", (r) => (r.overdue ? "overdue" : "active")),
  ],
  searchText: (r) => text(r, ["asset_number", "asset_name", "name"]),
  rowActions: [
    {
      label: "Generate due work",
      permission: "assets.maintain",
      run: () => act("plans-generate", {}),
      success: "Due plans have been turned into work orders.",
    },
  ],
};

const orders: RegisterConfig = {
  key: "work-orders",
  title: "Work orders",
  description:
    "Preventive, corrective and breakdown work. A breakdown can take the asset out of service and opens downtime; completing the order restores it and closes the downtime.",
  searchLabel: "Search work orders",
  emptyTitle: "No work orders",
  emptyDescription: "Raise a work order or generate the ones due.",
  source: { kind: "view", view: "work-orders" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "planned",
        "in_progress",
        "on_hold",
        "completed",
        "cancelled",
      ),
    },
  ],
  createLabel: "New work order",
  createPermission: "assets.maintain",
  save: { action: "order-create", success: "Work order created." },
  fields: [
    {
      name: "assetId",
      label: "Asset",
      kind: "select",
      required: true,
      options: "assets",
    },
    {
      name: "maintenanceType",
      label: "Type",
      kind: "select",
      options: opts(
        "corrective",
        "breakdown",
        "preventive",
        "inspection",
        "statutory",
      ),
      defaultValue: "corrective",
    },
    {
      name: "priority",
      label: "Priority",
      kind: "select",
      options: opts("low", "normal", "high", "urgent"),
      defaultValue: "normal",
    },
    {
      name: "takeOutOfService",
      label: "Take the asset out of service",
      kind: "bool",
      defaultValue: "false",
    },
    { name: "scheduledStartAt", label: "Scheduled start", kind: "datetime" },
    {
      name: "problemDescription",
      label: "Problem",
      kind: "textarea",
      wide: true,
    },
  ],
  summary: (rows) => [
    {
      label: "Total cost shown",
      value: money(rows.reduce((s, r) => s + Number(r.total_cost || 0), 0)),
    },
  ],
  columns: () => [
    strong("number", "Order", (r) => String(r.work_order_number)),
    col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`),
    badge("type", "Type", (r) => r.maintenance_type),
    badge("priority", "Priority", (r) => r.priority),
    col("cost", "Cost", (r) => money(r.total_cost)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, [
      "work_order_number",
      "asset_number",
      "asset_name",
      "problem_description",
    ]),
  rowActions: [
    {
      label: "Start",
      permission: "assets.maintain",
      show: (r) =>
        ["planned", "scheduled", "on_hold"].includes(String(r.status)),
      run: (r) => act("order-start", { id: r.id }),
      success: "In progress.",
    },
    {
      label: "Hold",
      permission: "assets.maintain",
      show: (r) => r.status === "in_progress",
      note: { label: "Reason", required: true },
      run: (r, note) => act("order-hold", { id: r.id, reason: note }),
      success: "On hold.",
    },
    {
      label: "Complete",
      permission: "assets.maintain",
      show: (r) =>
        ["planned", "scheduled", "in_progress", "on_hold"].includes(
          String(r.status),
        ),
      fields: [
        { name: "laborCost", label: "Labour cost", kind: "number", step: 0.01 },
        {
          name: "externalCost",
          label: "External cost",
          kind: "number",
          step: 0.01,
        },
        {
          name: "resolution",
          label: "Resolution (required for repairs)",
          kind: "text",
        },
        { name: "failureCause", label: "Failure cause", kind: "text" },
      ],
      note: { label: "Findings" },
      run: (r, note, v) =>
        act("order-complete", { id: r.id, findings: note, ...v }),
      success: "Completed. The asset is back in service.",
    },
    {
      label: "Cancel",
      permission: "assets.maintain",
      show: (r) =>
        ["planned", "scheduled", "in_progress", "on_hold"].includes(
          String(r.status),
        ),
      note: { label: "Reason", required: true },
      run: (r, note) => act("order-cancel", { id: r.id, reason: note }),
      success: "Cancelled.",
    },
  ],
};

// ------------------------------------------------------------------ F262-F265: disposal
const disposalColumns: RegisterConfig["columns"] = () => [
  strong("number", "Disposal", (r) => String(r.disposal_number)),
  col("asset", "Asset", (r) => `${r.asset_number} ${r.asset_name}`),
  badge("method", "Method", (r) => r.disposal_method),
  col("date", "Date", (r) => calendarDate(r.disposal_date)),
  col("proceeds", "Proceeds", (r) => money(r.proceeds_amount)),
  col("gl", "Gain / loss", (r) =>
    r.status === "completed" ? money(r.gain_loss_amount) : "—",
  ),
  badge("status", "Status", (r) => r.status),
];
const disposalActions: RowAction[] = [
  {
    label: "Approve",
    permission: "assets.accounting.handoff",
    show: (r) => r.status === "pending_approval",
    run: (r) => act("disposal-approve", { id: r.id }),
    success: "Approved.",
  },
  {
    label: "Reject",
    permission: "assets.accounting.handoff",
    show: (r) => ["pending_approval", "approved"].includes(String(r.status)),
    note: { label: "Reason", required: true },
    run: (r, note) => act("disposal-reject", { id: r.id, reason: note }),
    success: "Rejected. The asset returns to its earlier status.",
  },
  {
    label: "Complete",
    permission: "assets.dispose",
    show: (r) => r.status === "approved",
    run: (r) => act("disposal-complete", { id: r.id }),
    success: "Completed. Gain or loss is posted and the asset is derecognised.",
  },
  {
    label: "Cancel",
    permission: "assets.dispose",
    show: (r) => ["pending_approval", "approved"].includes(String(r.status)),
    run: (r) => act("disposal-cancel", { id: r.id }),
    success: "Cancelled.",
  },
];
const disposalFields = (methods: ReturnType<typeof opts>): FieldDef[] => [
  {
    name: "assetId",
    label: "Asset",
    kind: "select",
    required: true,
    options: "assets",
  },
  {
    name: "disposalMethod",
    label: "Method",
    kind: "select",
    required: true,
    options: methods,
    defaultValue: methods[0].value,
  },
  { name: "disposalDate", label: "Disposal date", kind: "date" },
  { name: "proceedsAmount", label: "Proceeds", kind: "number", step: 0.01 },
  { name: "disposalCost", label: "Disposal cost", kind: "number", step: 0.01 },
  {
    name: "buyerPartyId",
    label: "Buyer (sales)",
    kind: "select",
    options: "customers",
  },
  { name: "saleReference", label: "Sale reference", kind: "text" },
  {
    name: "reason",
    label: "Reason",
    kind: "textarea",
    required: true,
    wide: true,
  },
];

const retirement: RegisterConfig = {
  key: "retirement",
  title: "Retirement and write-off",
  description:
    "Scrapping, writing off or donating an asset. Approved by someone else; completing derecognises the asset and books any loss.",
  searchLabel: "Search",
  emptyTitle: "Nothing retired",
  emptyDescription: "Request a scrap or write-off.",
  source: { kind: "view", view: "disposals", params: { group: "retire" } },
  createLabel: "Request retirement",
  createPermission: "assets.dispose",
  save: {
    action: "disposal-request",
    success: "Requested. It awaits approval.",
  },
  fields: disposalFields(opts("scrap", "write_off", "donation")),
  columns: disposalColumns,
  searchText: (r) =>
    text(r, ["disposal_number", "asset_number", "asset_name", "status"]),
  rowActions: disposalActions,
};

const disposal: RegisterConfig = {
  key: "disposal",
  title: "Disposal and sale",
  description:
    "Selling an asset or returning it to a vendor. Gain or loss is proceeds less costs less the carrying value; depreciation to the disposal date must be posted first.",
  searchLabel: "Search",
  emptyTitle: "No disposals",
  emptyDescription: "Request a sale.",
  source: { kind: "view", view: "disposals", params: { group: "sale" } },
  createLabel: "Request sale",
  createPermission: "assets.dispose",
  save: {
    action: "disposal-request",
    success: "Requested. It awaits approval.",
  },
  fields: disposalFields(opts("sale", "return_to_vendor")),
  columns: disposalColumns,
  searchText: (r) =>
    text(r, ["disposal_number", "asset_number", "asset_name", "status"]),
  rowActions: disposalActions,
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  register,
  categories,
  locations,
  acquisition,
  capitalization,
  assignments,
  transfers,
  depreciation: runs,
  "maintenance-plans": plans,
  "work-orders": orders,
  retirement,
  disposal,
};
