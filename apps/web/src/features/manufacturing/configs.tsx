"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { StatusBadge } from "@vercentlabs/design-system";

import { act, type Row } from "@/features/manufacturing/shared/client";
import { calendarDate, dateTime, label, quantity, tone } from "@/features/manufacturing/shared/format";
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

export const REGISTERS: Record<string, RegisterConfig> = {
  boms,
  "bom-versions": bomVersions,
  "engineering-changes": engineeringChanges,
  "work-centers": workCenters,
  calendars,
  shifts,
  "calendar-exceptions": exceptions,
  routings,
};
