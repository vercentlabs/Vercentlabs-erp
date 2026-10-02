"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { StatusBadge } from "@vercentlabs/design-system";

import { type Row } from "@/features/manufacturing/shared/client";
import {
  amount,
  calendarDate,
  dateTime,
  label,
  quantity,
  tone,
} from "@/features/manufacturing/shared/format";
import type { RegisterConfig } from "@/features/manufacturing/shared/Register";

type Col = ColumnDef<Row, unknown>;
// `cell` is only set when given: an explicit undefined would replace the grid's default renderer with nothing.
const col = (
  id: string,
  header: string,
  accessorFn: (row: Row) => string,
  cell?: Col["cell"],
): Col =>
  (cell ? { id, header, accessorFn, cell } : { id, header, accessorFn }) as Col;
const badge = (id: string, header: string, value: (row: Row) => unknown): Col =>
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
const link = (
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
const text = (row: Row, keys: string[]) =>
  keys.map((key) => String(row[key] ?? "")).join(" ");

const BOM_STATUSES = [
  "draft",
  "pending_approval",
  "active",
  "inactive",
  "obsolete",
].map((value) => ({ value, label: label(value) }));

const boms: RegisterConfig = {
  key: "boms",
  title: "Bills of materials",
  description:
    "What goes into each product, with quantities, scrap allowance and issue method. A structure is approved by a second person before it can be used.",
  searchLabel: "Search BOMs",
  emptyTitle: "No BOMs yet",
  emptyDescription: "Create a BOM to define what a product is made of.",
  source: { kind: "view", view: "boms" },
  filters: [{ name: "status", label: "Status", options: BOM_STATUSES }],
  createLabel: "New BOM",
  createPermission: "manufacturing.bom.manage",
  newHref: "/manufacturing/bom/new",
  columns: () => [
    link(
      "code",
      "BOM",
      (r) => `${r.code} v${r.version}`,
      (r) => `/manufacturing/bom/${r.id}`,
    ),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    badge("status", "Status", (r) => r.status),
    col("kind", "Kind", (r) =>
      r.is_alternate
        ? `Alternate ${r.alternate_priority}`
        : r.is_default
          ? "Default"
          : "—",
    ),
    col("out", "Output", (r) => quantity(r.output_quantity)),
    col("components", "Components", (r) => String(r.component_count)),
    col("from", "Effective from", (r) => calendarDate(r.effective_from)),
    col("to", "Effective to", (r) => calendarDate(r.effective_to)),
  ],
  searchText: (r) =>
    text(r, ["code", "name", "item_name", "item_code", "status"]),
};

const bomVersions: RegisterConfig = {
  ...boms,
  key: "bom-versions",
  title: "BOM versions",
  description:
    "Every version and revision of every BOM. A change is a new version that goes through approval; the version it replaces is retired but kept.",
  createLabel: undefined,
  createPermission: undefined,
  columns: () => [
    link(
      "code",
      "BOM",
      (r) => String(r.code),
      (r) => `/manufacturing/bom/${r.id}`,
    ),
    col("version", "Version", (r) => `v${r.version}`),
    col("revision", "Revision", (r) => String(r.revision ?? "—")),
    badge("status", "Status", (r) => r.status),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col("created", "Created", (r) => dateTime(r.created_at)),
    col("approved", "Approved", (r) => dateTime(r.approved_at)),
  ],
};

// ---------------------------------------------------------------- shop floor
const PRIORITIES = ["low", "normal", "high", "urgent"].map((value) => ({
  value,
  label: label(value),
}));
const ORDER_STATUSES = [
  "planned",
  "released",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
].map((value) => ({ value, label: label(value) }));

const productionOrders: RegisterConfig = {
  key: "production-orders",
  title: "Production orders",
  description:
    "What is being made, how much, and where it stands. Release reserves the components; material, output, scrap and inspections are recorded on the order.",
  searchLabel: "Search production orders",
  emptyTitle: "No production orders yet",
  emptyDescription:
    "Create a production order for a product with an approved BOM.",
  source: { kind: "view", view: "orders" },
  filters: [
    { name: "status", label: "Status", options: ORDER_STATUSES },
    {
      name: "sourceType",
      label: "Demand",
      options: [
        { value: "make_to_stock", label: "Make to stock" },
        { value: "make_to_order", label: "Make to order" },
      ],
    },
  ],
  createLabel: "New production order",
  createPermission: "manufacturing.work_order.manage",
  save: {
    action: "order-create",
    idempotent: true,
    success: "Production order created.",
    transform: (v) => ({
      plannedStartAt: v.plannedStart
        ? `${v.plannedStart}T08:00:00Z`
        : undefined,
      plannedEndAt: v.plannedEnd ? `${v.plannedEnd}T17:00:00Z` : undefined,
    }),
  },
  fields: [
    {
      name: "itemId",
      label: "Product",
      kind: "select",
      required: true,
      options: "items",
    },
    {
      name: "quantity",
      label: "Quantity",
      kind: "number",
      required: true,
      step: 1,
      defaultValue: 1,
    },
    {
      name: "sourceType",
      label: "Demand",
      kind: "select",
      defaultValue: "make_to_stock",
      options: [
        { value: "make_to_stock", label: "Make to stock" },
        { value: "make_to_order", label: "Make to order (for a sales order)" },
      ],
    },
    {
      name: "sourceId",
      label: "Sales order",
      kind: "select",
      options: "salesOrders",
      showIf: (v) => v.sourceType === "make_to_order",
    },
    { name: "plannedStart", label: "Planned start", kind: "date" },
    { name: "plannedEnd", label: "Planned end", kind: "date" },
    {
      name: "priority",
      label: "Priority",
      kind: "select",
      defaultValue: "normal",
      options: PRIORITIES,
    },
    {
      name: "materialWarehouseId",
      label: "Material warehouse",
      kind: "select",
      options: "warehouses",
    },
    {
      name: "wipWarehouseId",
      label: "WIP warehouse",
      kind: "select",
      options: "warehouses",
    },
    {
      name: "finishedGoodsWarehouseId",
      label: "Finished-goods warehouse",
      kind: "select",
      options: "warehouses",
    },
    { name: "notes", label: "Notes", kind: "textarea" },
  ],
  columns: () => [
    link(
      "no",
      "Order",
      (r) => String(r.work_order_number),
      (r) => `/manufacturing/order/${r.id}`,
    ),
    badge("status", "Status", (r) => r.status),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col(
      "qty",
      "Done / planned",
      (r) =>
        `${quantity(r.quantity_completed)} / ${quantity(r.quantity_planned)}`,
    ),
    col("demand", "Demand", (r) =>
      r.source_type === "make_to_order"
        ? `Order ${r.source_label ?? ""}`
        : "Stock",
    ),
    col("priority", "Priority", (r) => label(r.priority)),
    col("start", "Planned start", (r) => calendarDate(r.planned_start_at)),
  ],
  searchText: (r) =>
    text(r, [
      "work_order_number",
      "item_name",
      "item_code",
      "source_label",
      "status",
    ]),
};

const reservations: RegisterConfig = {
  key: "reservations",
  title: "Material reservations",
  description:
    "Components held for open production orders against what is free in the material warehouse. A shortage is what the order still needs but nothing is held for.",
  searchLabel: "Search reservations",
  emptyTitle: "No material reservations",
  emptyDescription: "Releasing a production order reserves its components.",
  source: { kind: "view", view: "reservations" },
  columns: () => [
    link(
      "order",
      "Order",
      (r) => String(r.work_order_number),
      (r) => `/manufacturing/order/${r.work_order_id}`,
    ),
    badge("status", "Order status", (r) => r.work_order_status),
    col("item", "Component", (r) => `${r.item_name} (${r.item_code})`),
    col("wh", "Warehouse", (r) => String(r.warehouse_name)),
    col("required", "Required", (r) => quantity(r.required_quantity)),
    col("issued", "Issued", (r) => quantity(r.issued_quantity)),
    col("reserved", "Reserved", (r) => quantity(r.reserved_quantity)),
    col("free", "Free in stock", (r) => quantity(r.free_quantity)),
    {
      id: "short",
      header: "Shortage",
      accessorFn: (r: Row) => quantity(r.shortage_quantity),
      cell: ({ row }) =>
        Number(row.original.shortage_quantity) > 0 ? (
          <StatusBadge tone="danger">
            {quantity(row.original.shortage_quantity)}
          </StatusBadge>
        ) : (
          <span>—</span>
        ),
    } as Col,
  ],
  searchText: (r) =>
    text(r, ["work_order_number", "item_name", "item_code", "warehouse_name"]),
};

const postingColumns = (): Col[] => [
  col("when", "When", (r) => dateTime(r.posted_at)),
  link(
    "order",
    "Order",
    (r) => String(r.work_order_number),
    (r) => `/manufacturing/order/${r.work_order_id ?? ""}`,
  ),
  badge("type", "Type", (r) => r.posting_type),
  col("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
  col("qty", "Quantity", (r) => quantity(r.quantity)),
  col("cost", "Unit cost", (r) =>
    r.unit_cost === null ? "—" : quantity(r.unit_cost),
  ),
  col("wh", "Warehouse", (r) => String(r.warehouse_name)),
];
const consumption: RegisterConfig = {
  key: "consumption",
  title: "Material consumption",
  description:
    "Materials issued to production orders, returned from them, and lost as scrap or waste. Each is a stock movement.",
  searchLabel: "Search consumption",
  emptyTitle: "No material movements yet",
  emptyDescription: "Issue material to a released production order.",
  source: {
    kind: "view",
    view: "postings",
    params: { types: "material_issue,material_return,scrap" },
  },
  columns: postingColumns,
  searchText: (r) =>
    text(r, ["work_order_number", "item_name", "item_code", "posting_type"]),
};
const finishedOutput: RegisterConfig = {
  ...consumption,
  key: "finished-output",
  title: "Finished output",
  description:
    "Finished goods received from production at the cost absorbed from work in progress.",
  emptyTitle: "Nothing produced yet",
  emptyDescription: "Report production on a production order.",
  source: {
    kind: "view",
    view: "postings",
    params: { types: "production_receipt" },
  },
};
const scrap: RegisterConfig = {
  key: "scrap",
  title: "Scrap",
  description:
    "Everything lost in production, with the reason and the cost. Scrap is recorded on the production order.",
  searchLabel: "Search scrap",
  emptyTitle: "No scrap recorded",
  emptyDescription: "Scrap and waste are recorded on a production order.",
  source: { kind: "view", view: "scrap" },
  columns: () => [
    col("when", "When", (r) => dateTime(r.created_at)),
    col("order", "Order", (r) => String(r.work_order_number)),
    badge("cat", "Kind", (r) => r.category),
    col("scope", "Scope", (r) =>
      r.scope === "product" ? "Finished units" : "Component",
    ),
    col("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("qty", "Quantity", (r) => quantity(r.quantity)),
    col("cost", "Unit cost", (r) =>
      r.unit_cost === null ? "—" : quantity(r.unit_cost),
    ),
    col("reason", "Reason", (r) => label(r.reason_code)),
    col("note", "Note", (r) => String(r.note ?? "—")),
  ],
  searchText: (r) =>
    text(r, ["work_order_number", "item_name", "reason_code", "note"]),
};

const inspections: RegisterConfig = {
  key: "inspections",
  title: "Production inspections",
  description:
    "In-process checks recorded against production orders. An operation flagged 'inspection required' cannot be completed until a passing inspection of it is on record. Record one from the production order.",
  searchLabel: "Search inspections",
  emptyTitle: "No inspections yet",
  emptyDescription: "Inspections are recorded on a production order.",
  source: { kind: "view", view: "inspections" },
  columns: () => [
    col("when", "When", (r) => dateTime(r.created_at)),
    link(
      "order",
      "Order",
      (r) => String(r.work_order_number),
      (r) => `/manufacturing/order/${r.work_order_id}`,
    ),
    col("op", "Operation", (r) =>
      r.operation_name ? `${r.sequence} · ${r.operation_name}` : "Whole order",
    ),
    badge("result", "Result", (r) =>
      r.result === "pass" ? "completed" : "blocked",
    ),
    col("inspected", "Inspected", (r) => quantity(r.quantity_inspected)),
    col("rejected", "Rejected", (r) => quantity(r.quantity_rejected)),
    col("defect", "Defect", (r) => String(r.defect_code ?? "—")),
    col("follow", "Follow-up", (r) => label(r.follow_up)),
  ],
  searchText: (r) => text(r, ["work_order_number", "defect_code", "item_code"]),
};

const WINDOW = {
  name: "days",
  label: "Period",
  options: [
    { value: "7", label: "Last 7 days" },
    { value: "30", label: "Last 30 days" },
    { value: "90", label: "Last 90 days" },
    { value: "365", label: "Last year" },
  ],
};
const sumOf = (rows: Row[], key: string) =>
  rows.reduce((t, r) => t + Number(r[key] ?? 0), 0);

const productionCost: RegisterConfig = {
  key: "production-cost",
  title: "Production cost",
  description:
    "What each completed production order actually cost: material issued (less returns), per unit made.",
  searchLabel: "Search orders",
  emptyTitle: "No completed orders in this period",
  emptyDescription: "Choose a longer period.",
  source: { kind: "view", view: "cost-report", params: { days: "30" } },
  filters: [WINDOW],
  summary: (rows) => [
    { label: "Orders", value: String(rows.length) },
    { label: "Total cost", value: amount(sumOf(rows, "total")) },
    { label: "Material", value: amount(sumOf(rows, "material")) },
  ],
  columns: () => [
    link(
      "order",
      "Order",
      (r) => String(r.orderNumber),
      (r) => `/manufacturing/order/${r.orderId}`,
    ),
    col("product", "Product", (r) => `${r.itemName} (${r.itemCode})`),
    col("qty", "Made", (r) => quantity(r.quantity)),
    col("material", "Material", (r) => amount(r.material)),
    col("total", "Total", (r) => amount(r.total)),
    col("unit", "Cost / unit", (r) => amount(r.perUnit)),
  ],
  searchText: (r) => text(r, ["orderNumber", "itemName", "itemCode"]),
};

const varianceReport: RegisterConfig = {
  key: "variance",
  title: "Cost variance",
  description:
    "Actual against standard for each completed order, split into material price and material usage. Negative is favourable. Standard is computed from the current BOM and item standard costs.",
  searchLabel: "Search orders",
  emptyTitle: "No completed orders in this period",
  emptyDescription: "Choose a longer period.",
  source: { kind: "view", view: "variance", params: { days: "30" } },
  filters: [WINDOW],
  summary: (rows) => [
    { label: "Standard", value: amount(sumOf(rows, "standard")) },
    { label: "Actual", value: amount(sumOf(rows, "actual")) },
    { label: "Variance", value: amount(sumOf(rows, "variance")) },
  ],
  columns: () => [
    link(
      "order",
      "Order",
      (r) => String(r.orderNumber),
      (r) => `/manufacturing/order/${r.orderId}`,
    ),
    col("product", "Product", (r) => `${r.itemName} (${r.itemCode})`),
    col("standard", "Standard", (r) => amount(r.standard)),
    col("actual", "Actual", (r) => amount(r.actual)),
    {
      id: "variance",
      header: "Variance",
      accessorFn: (r: Row) => amount(r.variance),
      cell: ({ row }) => (
        <StatusBadge
          tone={
            Number(row.original.variance) > 0
              ? "danger"
              : Number(row.original.variance) < 0
                ? "success"
                : "neutral"
          }
        >
          {amount(row.original.variance)}
        </StatusBadge>
      ),
    } as Col,
    col("pct", "%", (r) =>
      r.variancePercent === null ? "—" : `${r.variancePercent}%`,
    ),
    col("price", "Material price", (r) => amount(r.materialPrice)),
    col("usage", "Material usage", (r) => amount(r.materialUsage)),
  ],
  searchText: (r) => text(r, ["orderNumber", "itemName", "itemCode"]),
};

export const REGISTERS: Record<string, RegisterConfig> = {
  boms,
  "bom-versions": bomVersions,
  "production-orders": productionOrders,
  reservations,
  consumption,
  "finished-output": finishedOutput,
  scrap,
  inspections,
  "production-cost": productionCost,
  variance: varianceReport,
};
