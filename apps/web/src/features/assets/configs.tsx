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
  money,
  opts,
  strong,
  text,
} from "@/features/assets/shared/helpers";



// ------------------------------------------------------------------ F239-F241: custody
// ------------------------------------------------------------------ F242-F251: value

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
  "maintenance-plans": plans,
  "work-orders": orders,
  retirement,
  disposal,
};
