"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { StatusBadge } from "@vercentlabs/design-system";

import { act, type Row } from "@/features/manufacturing/shared/client";
import { amount, calendarDate, dateTime, label, quantity, tone } from "@/features/manufacturing/shared/format";
import type { RegisterConfig } from "@/features/manufacturing/shared/Register";

type Col = ColumnDef<Row, unknown>;
// `cell` is only set when given: an explicit undefined would replace the grid's default renderer with nothing.
export const col = (id: string, header: string, accessorFn: (row: Row) => string, cell?: Col["cell"]): Col => (cell ? { id, header, accessorFn, cell } : { id, header, accessorFn }) as Col;
export const badge = (id: string, header: string, value: (row: Row) => unknown): Col => ({ id, header, accessorFn: (row) => label(value(row)), cell: ({ row }) => <StatusBadge tone={tone(value(row.original))}>{label(value(row.original))}</StatusBadge> }) as Col;
export const strong = (id: string, header: string, value: (row: Row) => string): Col => col(id, header, value, ({ row }) => <span className="font-medium text-text">{value(row.original)}</span>);
export const link = (id: string, header: string, value: (row: Row) => string, href: (row: Row) => string): Col => col(id, header, value, ({ row }) => <Link className="font-medium text-brand hover:underline" href={href(row.original)}>{value(row.original)}</Link>);
export const text = (row: Row, keys: string[]) => keys.map((key) => String(row[key] ?? "")).join(" ");

const BOM_STATUSES = ["draft", "pending_approval", "active", "inactive", "obsolete"].map((value) => ({ value, label: label(value) }));

const boms: RegisterConfig = {
  key: "boms",
  title: "Bills of materials",
  description: "What goes into each product, with quantities, scrap allowance and issue method. A structure is approved by a second person before it can be used.",
  searchLabel: "Search BOMs",
  emptyTitle: "No BOMs yet",
  emptyDescription: "Create a BOM to define what a product is made of.",
  source: { kind: "view", view: "boms" },
  filters: [{ name: "status", label: "Status", options: BOM_STATUSES }],
  createLabel: "New BOM",
  createPermission: "manufacturing.bom.manage",
  newHref: "/manufacturing/bom/new",
  columns: () => [
    link("code", "BOM", (r) => `${r.code} v${r.version}`, (r) => `/manufacturing/bom/${r.id}`),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    badge("status", "Status", (r) => r.status),
    col("kind", "Kind", (r) => (r.is_alternate ? `Alternate ${r.alternate_priority}` : r.is_default ? "Default" : "—")),
    col("out", "Output", (r) => quantity(r.output_quantity)),
    col("components", "Components", (r) => String(r.component_count)),
    col("from", "Effective from", (r) => calendarDate(r.effective_from)),
    col("to", "Effective to", (r) => calendarDate(r.effective_to)),
  ],
  searchText: (r) => text(r, ["code", "name", "item_name", "item_code", "status"]),
};

const bomVersions: RegisterConfig = {
  ...boms,
  key: "bom-versions",
  title: "BOM versions",
  description: "Every version and revision of every BOM. A change is a new version that goes through approval; the version it replaces is retired but kept.",
  createLabel: undefined,
  createPermission: undefined,
  columns: () => [
    link("code", "BOM", (r) => String(r.code), (r) => `/manufacturing/bom/${r.id}`),
    col("version", "Version", (r) => `v${r.version}`),
    col("revision", "Revision", (r) => String(r.revision ?? "—")),
    badge("status", "Status", (r) => r.status),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col("created", "Created", (r) => dateTime(r.created_at)),
    col("approved", "Approved", (r) => dateTime(r.approved_at)),
  ],
};

const CHANGE_STATUSES = ["draft", "submitted", "approved", "rejected", "implemented", "cancelled"].map((value) => ({ value, label: label(value) }));
const engineeringChanges: RegisterConfig = {
  key: "engineering-changes",
  title: "Engineering changes",
  description: "A controlled change to a released BOM: proposed, approved by someone other than the requester, then implemented into a new active version. Open work orders keep the BOM they started with. Propose a change from an active BOM.",
  searchLabel: "Search changes",
  emptyTitle: "No engineering changes",
  emptyDescription: "Open an active BOM and choose Propose change.",
  source: { kind: "view", view: "changes" },
  filters: [{ name: "status", label: "Status", options: CHANGE_STATUSES }],
  columns: () => [
    strong("no", "Change", (r) => String(r.change_number)),
    col("title", "Title", (r) => String(r.title)),
    badge("status", "Status", (r) => r.status),
    col("bom", "BOM", (r) => `${r.bom_code} v${r.bom_version}`),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col("components", "Proposed lines", (r) => String(r.component_count)),
    col("effective", "Effective from", (r) => calendarDate(r.effective_from)),
    col("result", "Result", (r) => "", ({ row }) => (row.original.resulting_bom_id ? <Link className="text-brand hover:underline" href={`/manufacturing/bom/${row.original.resulting_bom_id}`}>New version</Link> : <span>—</span>)),
  ],
  searchText: (r) => text(r, ["change_number", "title", "bom_code", "item_name", "status"]),
  rowActions: [
    { label: "Submit", permission: "manufacturing.bom.manage", show: (r) => r.status === "draft", success: "Change submitted.", run: (r) => act("change-submit", { id: r.id }) },
    { label: "Approve", permission: "manufacturing.manage", show: (r) => r.status === "submitted", success: "Change approved.", run: (r) => act("change-decide", { id: r.id, approve: true }) },
    { label: "Reject", permission: "manufacturing.manage", show: (r) => r.status === "submitted", note: { label: "Reason", required: true }, success: "Change rejected.", run: (r, note) => act("change-decide", { id: r.id, approve: false, note }) },
    { label: "Implement", permission: "manufacturing.bom.manage", show: (r) => r.status === "approved", success: "Change implemented — a new BOM version is active.", run: (r) => act("change-implement", { id: r.id }) },
    { label: "Cancel", permission: "manufacturing.bom.manage", show: (r) => ["draft", "submitted", "approved"].includes(String(r.status)), note: { label: "Reason", required: true }, success: "Change cancelled.", run: (r, note) => act("change-cancel", { id: r.id, reason: note }) },
  ],
};

const CENTER_TYPES = ["machine", "labor", "cell", "subcontract"].map((value) => ({ value, label: label(value) }));
const WEEKDAY_PRESETS = [{ value: "1,2,3,4,5", label: "Monday to Friday" }, { value: "1,2,3,4,5,6", label: "Monday to Saturday" }, { value: "0,1,2,3,4,5,6", label: "Every day" }];

const workCenters: RegisterConfig = {
  key: "work-centers",
  title: "Work centers",
  description: "Where work is done: machines, lines or labour cells, with their calendar, efficiency and cost rates. Daily capacity = shift minutes x machines x efficiency.",
  searchLabel: "Search work centers",
  emptyTitle: "No work centers yet",
  emptyDescription: "Add a work center to plan operations against.",
  source: { kind: "view", view: "work-centers" },
  createLabel: "Add work center",
  createPermission: "manufacturing.routing.manage",
  save: { action: "work-center-save", success: "Work center saved." },
  edit: { action: "work-center-save" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "centerType", label: "Type", kind: "select", defaultValue: "machine", options: CENTER_TYPES, rowKey: "center_type" },
    { name: "status", label: "Status", kind: "select", defaultValue: "active", options: [{ value: "active", label: "Active" }, { value: "maintenance", label: "Under maintenance" }, { value: "inactive", label: "Inactive" }] },
    { name: "calendarId", label: "Shift calendar", kind: "select", options: "calendars", rowKey: "calendar_id" },
    { name: "machineCount", label: "Machines / stations", kind: "number", step: 1, defaultValue: 1, rowKey: "machine_count" },
    { name: "efficiencyPercent", label: "Efficiency %", kind: "number", step: 1, defaultValue: 100, rowKey: "efficiency_percent" },
    { name: "hourlyRate", label: "Hourly rate", kind: "number", step: 0.01, rowKey: "hourly_rate" },
    { name: "overheadRate", label: "Overhead rate / hour", kind: "number", step: 0.01, rowKey: "overhead_rate" },
    { name: "description", label: "Description", kind: "textarea" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("type", "Type", (r) => label(r.center_type)),
    badge("status", "Status", (r) => r.status),
    col("calendar", "Calendar", (r) => String(r.calendar_code ?? "—")),
    col("machines", "Machines", (r) => String(r.machine_count)),
    col("eff", "Efficiency", (r) => `${quantity(r.efficiency_percent)}%`),
    col("daily", "Minutes / day", (r) => String(r.daily_minutes)),
    col("rate", "Rate / hour", (r) => (r.hourly_rate === null ? "—" : quantity(r.hourly_rate))),
  ],
  searchText: (r) => text(r, ["code", "name", "center_type", "status"]),
};

const calendars: RegisterConfig = {
  key: "calendars",
  title: "Shift calendars",
  description: "Which weekdays a work center runs, made up of shifts (see Shifts) and closures (see Holidays and closures).",
  searchLabel: "Search calendars",
  emptyTitle: "No calendars yet",
  emptyDescription: "Add a calendar, then give it shifts.",
  source: { kind: "view", view: "calendars" },
  createLabel: "Add calendar",
  createPermission: "manufacturing.settings.manage",
  save: { action: "calendar-save", success: "Calendar saved.", transform: (v) => ({ workingWeekdays: String(v.weekdays).split(",").map(Number) }) },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "weekdays", label: "Working days", kind: "select", required: true, defaultValue: "1,2,3,4,5", options: WEEKDAY_PRESETS },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("days", "Working days", (r) => (r.working_weekdays as number[]).map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(" ")),
    col("minutes", "Minutes / day", (r) => String(r.daily_minutes)),
    col("shifts", "Shifts", (r) => String(r.shift_count)),
    col("closures", "Closures", (r) => String(r.exception_count)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["code", "name"]),
};

const shifts: RegisterConfig = {
  key: "shifts",
  title: "Shifts",
  description: "The working hours of a calendar. Shifts on one calendar cannot overlap; break time is not working time.",
  searchLabel: "Search shifts",
  emptyTitle: "No shifts yet",
  emptyDescription: "Add a shift to a calendar.",
  source: { kind: "view", view: "shifts" },
  createLabel: "Add shift",
  createPermission: "manufacturing.settings.manage",
  save: { action: "shift-add", success: "Shift added." },
  fields: [
    { name: "calendarId", label: "Calendar", kind: "select", required: true, options: "calendars" },
    { name: "name", label: "Shift name", kind: "text", required: true, defaultValue: "Day" },
    { name: "startTime", label: "Starts (HH:MM)", kind: "text", required: true, defaultValue: "08:00" },
    { name: "endTime", label: "Ends (HH:MM)", kind: "text", required: true, defaultValue: "16:00" },
    { name: "breakMinutes", label: "Break minutes", kind: "number", step: 5, defaultValue: 30 },
  ],
  columns: () => [strong("cal", "Calendar", (r) => `${r.calendar_name} (${r.calendar_code})`), col("name", "Shift", (r) => String(r.name)), col("start", "Starts", (r) => String(r.start_time).slice(0, 5)), col("end", "Ends", (r) => String(r.end_time).slice(0, 5)), col("break", "Break", (r) => `${r.break_minutes} min`), col("work", "Working", (r) => `${r.working_minutes} min`)],
  searchText: (r) => text(r, ["name", "calendar_name", "calendar_code"]),
  rowActions: [{ label: "Remove", permission: "manufacturing.settings.manage", success: "Shift removed.", run: (r) => act("shift-remove", { id: r.id }) }],
};

const exceptions: RegisterConfig = {
  key: "calendar-exceptions",
  title: "Holidays and closures",
  description: "Days a calendar does not run (or runs although it normally would not). Capacity for those days follows.",
  searchLabel: "Search closures",
  emptyTitle: "No closures yet",
  emptyDescription: "Add a holiday or a plant shutdown.",
  source: { kind: "view", view: "calendar-exceptions" },
  createLabel: "Add closure",
  createPermission: "manufacturing.settings.manage",
  save: { action: "exception-add", success: "Closure added." },
  fields: [
    { name: "calendarId", label: "Calendar", kind: "select", required: true, options: "calendars" },
    { name: "exceptionDate", label: "Date", kind: "date", required: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "isWorking", label: "Working day", kind: "bool", defaultValue: "false" },
  ],
  columns: () => [strong("date", "Date", (r) => calendarDate(r.exception_date)), col("name", "Name", (r) => String(r.name)), col("cal", "Calendar", (r) => `${r.calendar_name} (${r.calendar_code})`), col("working", "Effect", (r) => (r.is_working ? "Extra working day" : "Closed"))],
  searchText: (r) => text(r, ["name", "calendar_name"]),
  rowActions: [{ label: "Remove", permission: "manufacturing.settings.manage", success: "Closure removed.", run: (r) => act("exception-remove", { id: r.id }) }],
};

const routings: RegisterConfig = {
  key: "routings",
  title: "Routings",
  description: "The operations a product goes through, in sequence, each on a work center with setup and run time. An approved routing is revised into a new version rather than edited.",
  searchLabel: "Search routings",
  emptyTitle: "No routings yet",
  emptyDescription: "Create a routing to define how a product is made.",
  source: { kind: "view", view: "routings" },
  filters: [{ name: "status", label: "Status", options: ["draft", "active", "inactive", "obsolete"].map((value) => ({ value, label: label(value) })) }],
  createLabel: "New routing",
  createPermission: "manufacturing.routing.manage",
  newHref: "/manufacturing/routing/new",
  columns: () => [
    link("code", "Routing", (r) => `${r.code} v${r.version}`, (r) => `/manufacturing/routing/${r.id}`),
    col("name", "Name", (r) => String(r.name)),
    badge("status", "Status", (r) => r.status),
    col("product", "Product", (r) => (r.item_name ? `${r.item_name} (${r.item_code})` : "—")),
    col("default", "Default", (r) => (r.is_default ? "Yes" : "—")),
    col("ops", "Operations", (r) => String(r.operation_count)),
    col("setup", "Setup min", (r) => quantity(r.setup_minutes)),
    col("run", "Run min / unit", (r) => quantity(r.run_minutes_per_unit)),
  ],
  searchText: (r) => text(r, ["code", "name", "item_name", "item_code", "status"]),
};

// ---------------------------------------------------------------- shop floor
const PRIORITIES = ["low", "normal", "high", "urgent"].map((value) => ({ value, label: label(value) }));
const ORDER_STATUSES = ["planned", "released", "in_progress", "on_hold", "completed", "cancelled"].map((value) => ({ value, label: label(value) }));
const orderLink = (r: Row) => `/manufacturing/order/${r.work_order_id ?? r.id}`;

const productionOrders: RegisterConfig = {
  key: "production-orders",
  title: "Production orders",
  description: "What is being made, how much, and where it stands. Release reserves the components; work, material and output are recorded on the order.",
  searchLabel: "Search production orders",
  emptyTitle: "No production orders yet",
  emptyDescription: "Create a production order for a product with an approved BOM.",
  source: { kind: "view", view: "orders" },
  filters: [{ name: "status", label: "Status", options: ORDER_STATUSES }, { name: "sourceType", label: "Demand", options: [{ value: "make_to_stock", label: "Make to stock" }, { value: "make_to_order", label: "Make to order" }] }],
  createLabel: "New production order",
  createPermission: "manufacturing.work_order.manage",
  save: {
    action: "order-create",
    idempotent: true,
    success: "Production order created.",
    transform: (v) => ({ plannedStartAt: v.plannedStart ? `${v.plannedStart}T08:00:00Z` : undefined, plannedEndAt: v.plannedEnd ? `${v.plannedEnd}T17:00:00Z` : undefined }),
  },
  fields: [
    { name: "itemId", label: "Product", kind: "select", required: true, options: "items" },
    { name: "quantity", label: "Quantity", kind: "number", required: true, step: 1, defaultValue: 1 },
    { name: "sourceType", label: "Demand", kind: "select", defaultValue: "make_to_stock", options: [{ value: "make_to_stock", label: "Make to stock" }, { value: "make_to_order", label: "Make to order (for a sales order)" }] },
    { name: "sourceId", label: "Sales order", kind: "select", options: "salesOrders", showIf: (v) => v.sourceType === "make_to_order" },
    { name: "plannedStart", label: "Planned start", kind: "date" },
    { name: "plannedEnd", label: "Planned end", kind: "date" },
    { name: "priority", label: "Priority", kind: "select", defaultValue: "normal", options: PRIORITIES },
    { name: "materialWarehouseId", label: "Material warehouse", kind: "select", options: "warehouses" },
    { name: "wipWarehouseId", label: "WIP warehouse", kind: "select", options: "warehouses" },
    { name: "finishedGoodsWarehouseId", label: "Finished-goods warehouse", kind: "select", options: "warehouses" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ],
  columns: () => [
    link("no", "Order", (r) => String(r.work_order_number), (r) => `/manufacturing/order/${r.id}`),
    badge("status", "Status", (r) => r.status),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col("qty", "Done / planned", (r) => `${quantity(r.quantity_completed)} / ${quantity(r.quantity_planned)}`),
    col("ops", "Operations", (r) => (r.operation_count ? `${r.operations_done} / ${r.operation_count}` : "—")),
    col("demand", "Demand", (r) => (r.rework_of_id ? "Rework" : r.source_type === "make_to_order" ? `Order ${r.source_label ?? ""}` : "Stock")),
    col("priority", "Priority", (r) => label(r.priority)),
    col("start", "Planned start", (r) => calendarDate(r.planned_start_at)),
  ],
  searchText: (r) => text(r, ["work_order_number", "item_name", "item_code", "source_label", "status"]),
};

const shopFloor: RegisterConfig = {
  key: "shop-floor",
  title: "Shop floor",
  description: "Job cards ready to work or in progress, most urgent first. Start an operation, then complete it with the time it took; the next operation opens when it is done.",
  searchLabel: "Search job cards",
  emptyTitle: "Nothing on the floor",
  emptyDescription: "Release a production order with a routing to put its first operation here.",
  source: { kind: "view", view: "job-cards" },
  filters: [{ name: "status", label: "Status", options: [{ value: "ready", label: "Ready" }, { value: "in_progress", label: "In progress" }] }],
  columns: () => [
    link("order", "Order", (r) => String(r.work_order_number), (r) => `/manufacturing/order/${r.work_order_id}`),
    col("op", "Operation", (r) => `${r.sequence} · ${r.name}`),
    badge("status", "Status", (r) => r.status),
    col("wc", "Work center", (r) => String(r.work_center_name ?? "—")),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col("qty", "Quantity", (r) => quantity(r.quantity_planned)),
    col("plan", "Planned min", (r) => quantity(r.planned_minutes)),
    col("prio", "Priority", (r) => label(r.priority)),
  ],
  searchText: (r) => text(r, ["work_order_number", "name", "item_name", "item_code", "work_center_name"]),
  rowActions: [
    { label: "Start", permission: "manufacturing.production.post", show: (r) => r.status === "ready", success: "Operation started.", run: (r) => act("operation-start", { id: r.id }) },
    { label: "Complete", permission: "manufacturing.production.post", show: (r) => r.status === "in_progress", note: { label: "Actual minutes (leave blank to use the time since start)" }, success: "Operation completed.", run: (r, note) => act("operation-complete", { id: r.id, actualMinutes: note.trim() ? Number(note) : undefined }) },
  ],
};

const operations: RegisterConfig = {
  ...shopFloor,
  key: "operations",
  title: "Operations",
  description: "Every operation of every open production order, by status.",
  filters: [{ name: "status", label: "Status", options: ["pending", "ready", "in_progress", "completed", "skipped"].map((value) => ({ value, label: label(value) })) }],
  source: { kind: "view", view: "job-cards", params: { status: "ready" } },
};

const reservations: RegisterConfig = {
  key: "reservations",
  title: "Material reservations",
  description: "Components held for open production orders against what is free in the material warehouse. A shortage is what the order still needs but nothing is held for.",
  searchLabel: "Search reservations",
  emptyTitle: "No material reservations",
  emptyDescription: "Releasing a production order reserves its components.",
  source: { kind: "view", view: "reservations" },
  columns: () => [
    link("order", "Order", (r) => String(r.work_order_number), (r) => `/manufacturing/order/${r.work_order_id}`),
    badge("status", "Order status", (r) => r.work_order_status),
    col("item", "Component", (r) => `${r.item_name} (${r.item_code})`),
    col("wh", "Warehouse", (r) => String(r.warehouse_name)),
    col("required", "Required", (r) => quantity(r.required_quantity)),
    col("issued", "Issued", (r) => quantity(r.issued_quantity)),
    col("reserved", "Reserved", (r) => quantity(r.reserved_quantity)),
    col("free", "Free in stock", (r) => quantity(r.free_quantity)),
    { id: "short", header: "Shortage", accessorFn: (r: Row) => quantity(r.shortage_quantity), cell: ({ row }) => (Number(row.original.shortage_quantity) > 0 ? <StatusBadge tone="danger">{quantity(row.original.shortage_quantity)}</StatusBadge> : <span>—</span>) } as Col,
  ],
  searchText: (r) => text(r, ["work_order_number", "item_name", "item_code", "warehouse_name"]),
};

const postingColumns = (): Col[] => [
  col("when", "When", (r) => dateTime(r.posted_at)),
  link("order", "Order", (r) => String(r.work_order_number), (r) => `/manufacturing/order/${r.work_order_id ?? ""}`),
  badge("type", "Type", (r) => r.posting_type),
  col("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
  col("qty", "Quantity", (r) => quantity(r.quantity)),
  col("cost", "Unit cost", (r) => (r.unit_cost === null ? "—" : quantity(r.unit_cost))),
  col("wh", "Warehouse", (r) => String(r.warehouse_name)),
];
const consumption: RegisterConfig = {
  key: "consumption",
  title: "Material consumption",
  description: "Materials issued to production orders, returned from them, and lost as scrap or waste. Each is a stock movement.",
  searchLabel: "Search consumption",
  emptyTitle: "No material movements yet",
  emptyDescription: "Issue material to a released production order.",
  source: { kind: "view", view: "postings", params: { types: "material_issue,material_return,scrap" } },
  columns: postingColumns,
  searchText: (r) => text(r, ["work_order_number", "item_name", "item_code", "posting_type"]),
};
const finishedOutput: RegisterConfig = {
  ...consumption,
  key: "finished-output",
  title: "Finished output",
  description: "Finished goods received from production at the cost absorbed from work in progress.",
  emptyTitle: "Nothing produced yet",
  emptyDescription: "Report production on a production order.",
  source: { kind: "view", view: "postings", params: { types: "production_receipt" } },
};
const byProducts: RegisterConfig = {
  ...consumption,
  key: "by-products",
  title: "By-products and co-products",
  description: "Extra outputs received with the main product, at their share of the cost. Defined on a draft BOM (Bills of materials > By-products).",
  emptyTitle: "No by-products yet",
  emptyDescription: "Add a by-product to a BOM; it is received automatically when production is reported.",
  source: { kind: "view", view: "postings", params: { types: "byproduct_receipt" } },
};
const wip: RegisterConfig = {
  key: "wip",
  title: "Work in progress",
  description: "Cost accrued to open production orders (material issued, labour, overhead) and not yet absorbed into finished goods.",
  searchLabel: "Search work in progress",
  emptyTitle: "Nothing in progress",
  emptyDescription: "Issue material to a production order to start accruing WIP.",
  source: { kind: "view", view: "wip" },
  summary: (rows) => (rows.some((r) => r.wip_value !== null) ? [{ label: "Total WIP", value: amount(rows.reduce((t, r) => t + Number(r.wip_value ?? 0), 0)) }, { label: "Open orders", value: String(rows.length) }] : [{ label: "Open orders", value: String(rows.length) }]),
  columns: () => [
    link("order", "Order", (r) => String(r.work_order_number), (r) => `/manufacturing/order/${r.id}`),
    badge("status", "Status", (r) => r.status),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col("done", "Done / planned", (r) => `${quantity(r.quantity_completed)} / ${quantity(r.quantity_planned)}`),
    col("material", "Material", (r) => amount(r.material_cost)),
    col("labor", "Labour", (r) => amount(r.labor_cost)),
    col("overhead", "Overhead", (r) => amount(r.overhead_cost)),
    col("absorbed", "Absorbed", (r) => amount(r.cost_absorbed)),
    col("wip", "WIP value", (r) => amount(r.wip_value)),
  ],
  searchText: (r) => text(r, ["work_order_number", "item_name", "item_code"]),
};
const scrapRework: RegisterConfig = {
  key: "scrap-rework",
  title: "Scrap and rework",
  description: "Everything lost in production, with the reason and the cost. Record scrap and send recoverable units to rework from the production order.",
  searchLabel: "Search scrap",
  emptyTitle: "No scrap recorded",
  emptyDescription: "Scrap and waste are recorded on a production order.",
  source: { kind: "view", view: "scrap" },
  columns: () => [
    col("when", "When", (r) => dateTime(r.created_at)),
    col("order", "Order", (r) => String(r.work_order_number)),
    badge("cat", "Kind", (r) => r.category),
    col("scope", "Scope", (r) => (r.scope === "product" ? "Finished units" : "Component")),
    col("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("qty", "Quantity", (r) => quantity(r.quantity)),
    col("cost", "Unit cost", (r) => (r.unit_cost === null ? "—" : quantity(r.unit_cost))),
    col("reason", "Reason", (r) => label(r.reason_code)),
    col("note", "Note", (r) => String(r.note ?? "—")),
  ],
  searchText: (r) => text(r, ["work_order_number", "item_name", "reason_code", "note"]),
};

export const REGISTERS: Record<string, RegisterConfig> = {
  boms,
  "bom-versions": bomVersions,
  "engineering-changes": engineeringChanges,
  "work-centers": workCenters,
  calendars,
  shifts,
  "calendar-exceptions": exceptions,
  routings,
  "production-orders": productionOrders,
  "shop-floor": shopFloor,
  operations,
  reservations,
  consumption,
  wip,
  "finished-output": finishedOutput,
  "by-products": byProducts,
  "scrap-rework": scrapRework,
};
