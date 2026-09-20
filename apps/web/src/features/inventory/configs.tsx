"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { StatusBadge } from "@vercentlabs/design-system";

import { act, type InvOptions, type Row } from "@/features/inventory/shared/client";
import type { FieldDef } from "@/features/inventory/shared/FieldInput";
import { amount, calendarDate, dateTime, label, quantity, tone } from "@/features/inventory/shared/format";
import type { RegisterConfig } from "@/features/inventory/shared/Register";

type Col = ColumnDef<Row, unknown>;
// `cell` is only set when given: an explicit undefined would replace the grid's default renderer with nothing.
const col = (id: string, header: string, accessorFn: (row: Row) => string, cell?: Col["cell"]): Col => (cell ? { id, header, accessorFn, cell } : { id, header, accessorFn }) as Col;
const badge = (id: string, header: string, value: (row: Row) => unknown): Col => ({ id, header, accessorFn: (row) => label(value(row)), cell: ({ row }) => <StatusBadge tone={tone(value(row.original))}>{label(value(row.original))}</StatusBadge> }) as Col;
const strong = (id: string, header: string, value: (row: Row) => string): Col => col(id, header, value, ({ row }) => <span className="font-medium text-text">{value(row.original)}</span>);
const name = (list: Array<{ id: string; name: string; code?: string }> | undefined, id: unknown) => {
  const found = list?.find((entry) => entry.id === id);
  return found ? found.name : id ? "…" : "—";
};
const itemName = (options: InvOptions | undefined, id: unknown) => {
  const found = options?.items.find((entry) => entry.id === id);
  return found ? `${found.name} (${found.code})` : id ? "…" : "—";
};
const text = (row: Row, keys: string[]) => keys.map((key) => String(row[key] ?? "")).join(" ");

const TRACKING = [{ value: "none", label: "None" }, { value: "batch", label: "Batch / lot" }, { value: "serial", label: "Serial number" }];
const yes = (value: unknown) => (value === true || value === "true" ? "Yes" : "No");
const QTY_STEP = 0.001;

// ---------------------------------------------------------------- master data
const items: RegisterConfig = {
  key: "items",
  title: "Items",
  description: "The item master: what you stock, how it is tracked and valued.",
  searchLabel: "Search items",
  emptyTitle: "No items yet",
  emptyDescription: "Add your first item to start tracking stock.",
  source: { kind: "master", resource: "items" },
  createLabel: "Add item",
  createPermission: "items.manage",
  archive: true,
  save: { master: "items" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "description", label: "Description", kind: "textarea" },
    { name: "itemType", label: "Item type", kind: "select", defaultValue: "product", options: [{ value: "product", label: "Product" }, { value: "consumable", label: "Consumable" }, { value: "asset", label: "Asset" }, { value: "service", label: "Service" }] },
    { name: "groupId", label: "Category", kind: "select", options: "groups" },
    { name: "uomId", label: "Unit of measure", kind: "select", required: true, options: "uoms" },
    { name: "barcode", label: "Barcode", kind: "text" },
    { name: "hsnSacCode", label: "HSN / SAC code", kind: "text" },
    { name: "trackInventory", label: "Track inventory", kind: "bool", defaultValue: "true" },
    { name: "trackingType", label: "Tracking", kind: "select", defaultValue: "none", options: TRACKING, showIf: (v) => v.trackInventory !== "false" },
    { name: "valuationMethod", label: "Valuation method", kind: "select", defaultValue: "moving_average", options: [{ value: "moving_average", label: "Moving average" }, { value: "fifo", label: "FIFO" }, { value: "standard", label: "Standard cost" }] },
    { name: "allowNegativeStock", label: "Allow negative stock", kind: "bool", defaultValue: "false" },
    { name: "standardCost", label: "Standard cost", kind: "number", step: 0.01 },
    { name: "purchasePrice", label: "Purchase price", kind: "number", step: 0.01 },
    { name: "salesPrice", label: "Sales price", kind: "number", step: 0.01 },
  ],
  columns: (o) => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("group", "Category", (r) => name(o?.groups, r.groupId)),
    col("uom", "Unit", (r) => name(o?.uoms, r.uomId)),
    col("tracking", "Tracking", (r) => (r.trackInventory === false ? "Not tracked" : label(r.trackingType))),
    col("valuation", "Valuation", (r) => label(r.valuationMethod)),
    col("barcode", "Barcode", (r) => String(r.barcode ?? "—")),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["code", "name", "barcode", "hsnSacCode"]),
};

const categories: RegisterConfig = {
  key: "item-groups",
  title: "Item categories",
  description: "Group items into categories (and nest them) for reporting and pricing.",
  searchLabel: "Search categories",
  emptyTitle: "No categories yet",
  emptyDescription: "Add a category to organise items.",
  source: { kind: "master", resource: "item-groups" },
  createLabel: "Add category",
  createPermission: "items.manage",
  archive: true,
  save: { master: "item-groups" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "parentId", label: "Parent category", kind: "select", options: "groups" },
    { name: "description", label: "Description", kind: "textarea" },
  ],
  columns: (o) => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("parent", "Parent", (r) => (r.parentId ? name(o?.groups, r.parentId) : "—")), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["code", "name", "description"]),
};

const variants: RegisterConfig = {
  key: "item-variants",
  title: "Variants and SKUs",
  description: "Sellable variants of an item (size, colour, pack) with their own SKU and barcode.",
  searchLabel: "Search variants",
  emptyTitle: "No variants yet",
  emptyDescription: "Add a variant to give an item more than one SKU.",
  source: { kind: "master", resource: "item-variants" },
  createLabel: "Add variant",
  createPermission: "items.manage",
  archive: true,
  save: { master: "item-variants" },
  fields: [
    { name: "itemId", label: "Item", kind: "select", required: true, options: "items", createOnly: true },
    { name: "sku", label: "SKU", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Variant name", kind: "text", required: true },
    { name: "barcode", label: "Barcode", kind: "text" },
    { name: "salesPrice", label: "Sales price", kind: "number", step: 0.01 },
    { name: "purchasePrice", label: "Purchase price", kind: "number", step: 0.01 },
    { name: "standardCost", label: "Standard cost", kind: "number", step: 0.01 },
  ],
  columns: (o) => [strong("sku", "SKU", (r) => String(r.sku)), col("name", "Variant", (r) => String(r.name)), col("item", "Item", (r) => itemName(o, r.itemId)), col("barcode", "Barcode", (r) => String(r.barcode ?? "—")), col("price", "Sales price", (r) => amount(r.salesPrice)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["sku", "name", "barcode"]),
};

const uoms: RegisterConfig = {
  key: "units-of-measure",
  title: "Units of measure",
  description: "The units quantities are counted in, and how many decimals each allows.",
  searchLabel: "Search units",
  emptyTitle: "No units yet",
  emptyDescription: "Add a unit of measure, such as Each or Kilogram.",
  source: { kind: "master", resource: "units-of-measure" },
  createLabel: "Add unit",
  createPermission: "inventory_setup.manage",
  archive: true,
  save: { master: "units-of-measure" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "category", label: "Category", kind: "select", defaultValue: "quantity", options: ["quantity", "weight", "volume", "length", "area", "time", "packaging", "other"].map((value) => ({ value, label: label(value) })) },
    { name: "decimalPlaces", label: "Decimal places", kind: "number", step: 1, defaultValue: 3 },
    { name: "isBase", label: "Base unit of its category", kind: "bool", defaultValue: "false" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("category", "Category", (r) => label(r.category)), col("decimals", "Decimals", (r) => String(r.decimalPlaces)), col("base", "Base unit", (r) => yes(r.isBase)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["code", "name", "category"]),
};

const conversions: RegisterConfig = {
  key: "item-uom-conversions",
  title: "Unit conversions",
  description: "How many of one unit make another for a given item, e.g. 1 carton = 12 each.",
  searchLabel: "Search conversions",
  emptyTitle: "No conversions yet",
  emptyDescription: "Add a conversion when an item is bought or sold in a different unit than it is stocked.",
  source: { kind: "master", resource: "item-uom-conversions" },
  createLabel: "Add conversion",
  createPermission: "items.manage",
  archive: true,
  save: { master: "item-uom-conversions" },
  fields: [
    { name: "itemId", label: "Item", kind: "select", required: true, options: "items", createOnly: true },
    { name: "fromUomId", label: "From unit", kind: "select", required: true, options: "uoms", createOnly: true },
    { name: "toUomId", label: "To unit", kind: "select", required: true, options: "uoms", createOnly: true },
    { name: "conversionFactor", label: "Conversion factor", kind: "number", required: true, step: 0.0001, defaultValue: 1 },
  ],
  columns: (o) => [col("item", "Item", (r) => itemName(o, r.itemId)), col("from", "From", (r) => name(o?.uoms, r.fromUomId)), col("to", "To", (r) => name(o?.uoms, r.toUomId)), col("factor", "1 from = … to", (r) => quantity(r.conversionFactor)), badge("status", "Status", (r) => r.status)],
  searchText: () => "",
};

const warehouses: RegisterConfig = {
  key: "warehouses",
  title: "Warehouses",
  description: "Where stock is held.",
  searchLabel: "Search warehouses",
  emptyTitle: "No warehouses yet",
  emptyDescription: "Add a warehouse to receive stock into.",
  source: { kind: "master", resource: "warehouses" },
  createLabel: "Add warehouse",
  createPermission: "inventory_setup.manage",
  archive: true,
  save: { master: "warehouses" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "warehouseType", label: "Type", kind: "select", defaultValue: "stores", options: ["stores", "raw_material", "work_in_progress", "finished_goods", "transit", "returns", "virtual"].map((value) => ({ value, label: label(value) })) },
    { name: "allowNegativeStock", label: "Allow negative stock", kind: "bool", defaultValue: "false" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("type", "Type", (r) => label(r.warehouseType)), col("negative", "Negative stock", (r) => yes(r.allowNegativeStock)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["code", "name", "warehouseType"]),
};

const locations: RegisterConfig = {
  key: "warehouse-locations",
  title: "Locations and bins",
  description: "Zones, racks and bins inside a warehouse.",
  searchLabel: "Search locations",
  emptyTitle: "No locations yet",
  emptyDescription: "Add a zone or bin to a warehouse.",
  source: { kind: "master", resource: "warehouse-locations" },
  createLabel: "Add location",
  createPermission: "inventory_setup.manage",
  archive: true,
  save: { master: "warehouse-locations" },
  fields: [
    { name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: "warehouses", createOnly: true },
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "locationType", label: "Type", kind: "select", defaultValue: "zone", options: ["zone", "aisle", "rack", "bin", "staging", "quality", "other"].map((value) => ({ value, label: label(value) })) },
    { name: "parentLocationId", label: "Inside location", kind: "select", options: "locations", dependsOn: "warehouseId", createOnly: true },
    { name: "capacity", label: "Capacity", kind: "number", step: 1 },
  ],
  columns: (o) => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("warehouse", "Warehouse", (r) => name(o?.warehouses, r.warehouseId)), col("type", "Type", (r) => label(r.locationType)), col("capacity", "Capacity", (r) => (r.capacity === null || r.capacity === undefined ? "—" : quantity(r.capacity))), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["code", "name", "locationType"]),
};

// ---------------------------------------------------------------- stock views
const stockDims = (extra: FieldDef[] = []): FieldDef[] => [
  { name: "itemId", label: "Item", kind: "select", required: true, options: "items" },
  { name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: "warehouses" },
  { name: "warehouseLocationId", label: "Location / bin", kind: "select", options: "locations", dependsOn: "warehouseId" },
  { name: "batchId", label: "Batch / lot", kind: "select", options: "batches", dependsOn: "itemId" },
  ...extra,
];

const ledgerColumns = (): Col[] => [
  col("when", "When", (r) => dateTime(r.occurred_at)),
  strong("no", "Movement", (r) => String(r.movement_number)),
  badge("type", "Type", (r) => r.movement_type),
  col("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
  col("warehouse", "Warehouse", (r) => String(r.warehouse_name)),
  col("location", "Location", (r) => String(r.location_code ?? "—")),
  col("batch", "Batch", (r) => String(r.batch_number ?? "—")),
  col("serial", "Serial", (r) => String(r.serial_number ?? "—")),
  col("qty", "Quantity", (r) => quantity(r.quantity)),
  col("cost", "Unit cost", (r) => amount(r.unit_cost)),
  col("ref", "Reference", (r) => (r.reference_type ? label(r.reference_type) : "—")),
  col("reason", "Reason", (r) => String(r.reason ?? "—")),
];
const ledgerSearch = (r: Row) => text(r, ["movement_number", "item_name", "item_code", "warehouse_name", "batch_number", "serial_number", "reason", "reference_type"]);

const ledger: RegisterConfig = {
  key: "ledger",
  title: "Stock ledger",
  description: "Every stock movement, newest first. The ledger is append-only: corrections are new movements.",
  searchLabel: "Search ledger",
  emptyTitle: "No stock movements yet",
  emptyDescription: "Receive stock to start the ledger.",
  source: { kind: "stock", view: "ledger" },
  filters: [{ name: "movementType", label: "Type", options: ["receipt", "issue", "transfer", "adjustment", "return", "count"].map((value) => ({ value, label: label(value) })) }],
  columns: ledgerColumns,
  searchText: ledgerSearch,
};

const receipts: RegisterConfig = {
  key: "receipts",
  title: "Stock receipts",
  description: "Stock coming in. Purchase receipts from Procurement appear here too.",
  searchLabel: "Search receipts",
  emptyTitle: "No receipts yet",
  emptyDescription: "Record a receipt to bring stock in.",
  source: { kind: "stock", view: "ledger", params: { movementType: "receipt" } },
  createLabel: "Record receipt",
  createPermission: "stock.receive",
  save: { action: "movement", fixed: { movementType: "receipt" }, idempotent: true, success: "Receipt recorded." },
  fields: stockDims([
    { name: "quantity", label: "Quantity", kind: "number", required: true, step: QTY_STEP },
    { name: "unitCost", label: "Unit cost", kind: "number", step: 0.01 },
    { name: "reason", label: "Reason / note", kind: "text", wide: true },
  ]),
  columns: ledgerColumns,
  searchText: ledgerSearch,
};

const issues: RegisterConfig = {
  key: "issues",
  title: "Stock issues",
  description: "Stock going out. Serial-tracked items are issued from the Serial numbers screen.",
  searchLabel: "Search issues",
  emptyTitle: "No issues yet",
  emptyDescription: "Record an issue to take stock out.",
  source: { kind: "stock", view: "ledger", params: { movementType: "issue" } },
  createLabel: "Record issue",
  createPermission: "stock.issue",
  save: { action: "movement", fixed: { movementType: "issue" }, idempotent: true, success: "Issue recorded." },
  fields: stockDims([
    { name: "quantity", label: "Quantity", kind: "number", required: true, step: QTY_STEP },
    { name: "reason", label: "Reason / note", kind: "text", wide: true },
  ]),
  columns: ledgerColumns,
  searchText: ledgerSearch,
};

const adjustments: RegisterConfig = {
  key: "adjustments",
  title: "Stock adjustments",
  description: "Corrections to the counted quantity. A reason is required and the ledger keeps the history.",
  searchLabel: "Search adjustments",
  emptyTitle: "No adjustments yet",
  emptyDescription: "Record an adjustment to correct a quantity.",
  source: { kind: "stock", view: "ledger", params: { movementType: "adjustment" } },
  createLabel: "Record adjustment",
  createPermission: "stock.adjust",
  save: { action: "movement", fixed: { movementType: "adjustment" }, idempotent: true, success: "Adjustment recorded." },
  fields: stockDims([
    { name: "adjustmentDirection", label: "Direction", kind: "select", required: true, defaultValue: "increase", options: [{ value: "increase", label: "Increase stock" }, { value: "decrease", label: "Decrease stock" }] },
    { name: "quantity", label: "Quantity", kind: "number", required: true, step: QTY_STEP },
    { name: "unitCost", label: "Unit cost", kind: "number", step: 0.01, showIf: (v) => v.adjustmentDirection !== "decrease" },
    { name: "reason", label: "Reason", kind: "text", required: true, wide: true },
  ]),
  columns: ledgerColumns,
  searchText: ledgerSearch,
};

const balances: RegisterConfig = {
  key: "availability",
  title: "Stock availability",
  description: "On hand, reserved and available quantity by item, warehouse, location and batch.",
  searchLabel: "Search stock",
  emptyTitle: "No stock yet",
  emptyDescription: "Stock appears here once a receipt is recorded.",
  source: { kind: "stock", view: "balances" },
  columns: () => [
    strong("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("warehouse", "Warehouse", (r) => String(r.warehouse_name)),
    col("location", "Location", (r) => String(r.location_code ?? "—")),
    col("batch", "Batch", (r) => String(r.batch_number ?? "—")),
    col("onhand", "On hand", (r) => quantity(r.on_hand_quantity)),
    col("reserved", "Reserved", (r) => quantity(r.reserved_quantity)),
    col("available", "Available", (r) => quantity(r.available_quantity)),
    col("cost", "Average cost", (r) => amount(r.average_cost)),
    col("value", "Stock value", (r) => amount(r.stock_value)),
  ],
  searchText: (r) => text(r, ["item_name", "item_code", "warehouse_name", "batch_number", "location_code"]),
};

const transfers: RegisterConfig = {
  key: "transfers",
  title: "Stock transfers",
  description: "Move stock between warehouses or bins. A transfer is drafted, then completed to move the stock.",
  searchLabel: "Search transfers",
  emptyTitle: "No transfers yet",
  emptyDescription: "Create a transfer to move stock.",
  source: { kind: "stock", view: "transfers" },
  filters: [{ name: "status", label: "Status", options: ["draft", "completed", "cancelled"].map((value) => ({ value, label: label(value) })) }],
  createLabel: "New transfer",
  createPermission: "stock.transfer",
  save: { action: "transfer", idempotent: true, success: "Transfer created." },
  fields: [
    { name: "itemId", label: "Item", kind: "select", required: true, options: "items" },
    { name: "sourceWarehouseId", label: "From warehouse", kind: "select", required: true, options: "warehouses" },
    { name: "sourceLocationId", label: "From location", kind: "select", options: "locations", dependsOn: "sourceWarehouseId" },
    { name: "destinationWarehouseId", label: "To warehouse", kind: "select", required: true, options: "warehouses" },
    { name: "destinationLocationId", label: "To location", kind: "select", options: "locations", dependsOn: "destinationWarehouseId" },
    { name: "batchId", label: "Batch / lot", kind: "select", options: "batches", dependsOn: "itemId" },
    { name: "quantity", label: "Quantity", kind: "number", required: true, step: QTY_STEP },
  ],
  columns: () => [
    strong("no", "Transfer", (r) => String(r.transfer_number)),
    badge("status", "Status", (r) => r.status),
    col("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("from", "From", (r) => String(r.source_warehouse_name)),
    col("to", "To", (r) => String(r.destination_warehouse_name)),
    col("qty", "Quantity", (r) => quantity(r.quantity)),
    col("created", "Created", (r) => dateTime(r.created_at)),
    col("completed", "Completed", (r) => dateTime(r.completed_at)),
  ],
  searchText: (r) => text(r, ["transfer_number", "item_name", "item_code", "source_warehouse_name", "destination_warehouse_name"]),
  rowActions: [{ label: "Complete", permission: "stock.transfer", show: (r) => r.status === "draft", success: "Transfer completed.", run: (r) => act("transfer-complete", { id: r.id }) }],
};

const reservations: RegisterConfig = {
  key: "reservations",
  title: "Reservations",
  description: "Stock set aside for an order or a hold. Reserved stock is not available to promise.",
  searchLabel: "Search reservations",
  emptyTitle: "No reservations",
  emptyDescription: "Reserve stock to hold it for an order.",
  source: { kind: "stock", view: "reservations" },
  filters: [{ name: "status", label: "Status", options: ["active", "released", "consumed", "cancelled"].map((value) => ({ value, label: label(value) })) }],
  createLabel: "Reserve stock",
  createPermission: "stock.reserve",
  save: { action: "reserve", idempotent: true, success: "Stock reserved." },
  fields: [
    ...stockDims([
      { name: "quantity", label: "Quantity", kind: "number", required: true, step: QTY_STEP },
      { name: "referenceType", label: "Held for", kind: "text", placeholder: "e.g. Customer order (optional)" },
    ]),
  ],
  columns: () => [
    badge("status", "Status", (r) => r.status),
    col("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("warehouse", "Warehouse", (r) => String(r.warehouse_name)),
    col("batch", "Batch", (r) => String(r.batch_number ?? "—")),
    col("qty", "Quantity", (r) => quantity(r.quantity)),
    col("ref", "Held for", (r) => (r.reference_type ? label(r.reference_type) : "—")),
    col("created", "Reserved", (r) => dateTime(r.created_at)),
    col("released", "Released", (r) => dateTime(r.released_at)),
  ],
  searchText: (r) => text(r, ["item_name", "item_code", "warehouse_name", "reference_type"]),
  rowActions: [{ label: "Release", permission: "stock.reserve", show: (r) => r.status === "active", success: "Reservation released.", run: (r) => act("reservation-release", { id: r.id }) }],
};

// ---------------------------------------------------------------- traceability
const batchColumns = (): Col[] => [
  strong("batch", "Batch / lot", (r) => String(r.batch_number)),
  col("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
  badge("status", "Status", (r) => r.status),
  col("mfg", "Manufactured", (r) => calendarDate(r.manufactured_on)),
  col("exp", "Expires", (r) => calendarDate(r.expires_on)),
  col("days", "Days to expiry", (r) => (r.days_to_expiry === null || r.days_to_expiry === undefined ? "—" : Number(r.days_to_expiry) < 0 ? `Expired ${Math.abs(Number(r.days_to_expiry))}d ago` : String(r.days_to_expiry))),
  col("onhand", "On hand", (r) => quantity(r.on_hand_quantity)),
];
const batchActions: RegisterConfig["rowActions"] = [
  { label: "Block", permission: "stock.manage", show: (r) => r.status === "active", note: { label: "Reason", required: true }, success: "Batch blocked.", run: (r, note) => act("batch-status", { id: r.id, status: "blocked", reason: note }) },
  { label: "Mark expired", permission: "stock.manage", show: (r) => r.status === "active", note: { label: "Reason", required: true }, success: "Batch marked expired.", run: (r, note) => act("batch-status", { id: r.id, status: "expired", reason: note }) },
  { label: "Unblock", permission: "stock.manage", show: (r) => r.status === "blocked" || r.status === "expired", success: "Batch reactivated.", run: (r) => act("batch-status", { id: r.id, status: "active" }) },
];

const lots: RegisterConfig = {
  key: "lots",
  title: "Lots and batches",
  description: "Batch / lot register for batch-tracked items. A blocked or expired batch cannot be issued from.",
  searchLabel: "Search batches",
  emptyTitle: "No batches yet",
  emptyDescription: "Create a batch, then receive stock against it.",
  source: { kind: "stock", view: "batches" },
  createLabel: "Add batch",
  createPermission: "stock.manage",
  save: { action: "batch", success: "Batch created." },
  fields: [
    { name: "itemId", label: "Item", kind: "select", required: true, options: "items" },
    { name: "batchNumber", label: "Batch / lot number", kind: "text", required: true },
    { name: "manufacturedOn", label: "Manufactured on", kind: "date" },
    { name: "expiresOn", label: "Expires on", kind: "date" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ],
  columns: batchColumns,
  searchText: (r) => text(r, ["batch_number", "item_name", "item_code"]),
  rowActions: batchActions,
};

const expiry: RegisterConfig = {
  key: "expiry",
  title: "Expiry",
  description: "Batches by how soon they expire. Expired stock should be blocked or written off.",
  searchLabel: "Search batches",
  emptyTitle: "Nothing expiring in this window",
  emptyDescription: "Choose a longer window, or no filter to see all batches.",
  source: { kind: "stock", view: "batches", params: { withinDays: "90" } },
  filters: [{ name: "withinDays", label: "Expiring within", options: [{ value: "0", label: "Already expired" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "180", label: "180 days" }, { value: "365", label: "1 year" }] }],
  columns: batchColumns,
  searchText: (r) => text(r, ["batch_number", "item_name", "item_code"]),
  rowActions: batchActions,
};

const serials: RegisterConfig = {
  key: "serial-numbers",
  title: "Serial numbers",
  description: "Every serial-tracked unit and where it is. Receiving registers the serials and the stock together.",
  searchLabel: "Search serial numbers",
  emptyTitle: "No serial numbers yet",
  emptyDescription: "Receive a serial-tracked item to register its units.",
  source: { kind: "stock", view: "serials" },
  filters: [{ name: "status", label: "Status", options: [{ value: "available", label: "Available" }, { value: "sold", label: "Issued" }] }],
  createLabel: "Receive serials",
  createPermission: "stock.receive",
  save: { action: "serials", idempotent: true, success: "Serial numbers received." },
  fields: [
    { name: "itemId", label: "Item", kind: "select", required: true, options: "items" },
    { name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: "warehouses" },
    { name: "warehouseLocationId", label: "Location / bin", kind: "select", options: "locations", dependsOn: "warehouseId" },
    { name: "serialNumbers", label: "Serial numbers (one per line, or comma-separated)", kind: "textarea", required: true },
    { name: "unitCost", label: "Unit cost", kind: "number", step: 0.01 },
  ],
  columns: () => [strong("serial", "Serial number", (r) => String(r.serial_number)), col("item", "Item", (r) => `${r.item_name} (${r.item_code})`), badge("status", "Status", (r) => (r.status === "sold" ? "issued" : r.status)), col("since", "Registered", (r) => dateTime(r.created_at))],
  searchText: (r) => text(r, ["serial_number", "item_name", "item_code"]),
  rowActions: [
    {
      label: "Issue",
      permission: "stock.issue",
      show: (r) => r.status === "available",
      note: { label: "Reason", required: false },
      success: "Serial issued.",
      run: (r, note) => act("movement", { movementType: "issue", itemId: r.item_id, warehouseId: r.warehouse_id, warehouseLocationId: r.warehouse_location_id || undefined, batchId: r.batch_id || undefined, serialId: r.id, quantity: 1, reason: note || "Serial issue", idempotencyKey: `serial-issue-${r.id}` }),
    },
  ],
};

// ---------------------------------------------------------------- planning
const reorderRules: RegisterConfig = {
  key: "reorder-rules",
  title: "Reorder rules",
  description: "When available stock falls to minimum + safety stock, the item shows in Replenishment. A maximum makes it order up to that level.",
  searchLabel: "Search reorder rules",
  emptyTitle: "No reorder rules yet",
  emptyDescription: "Add a rule to be alerted before an item runs out.",
  source: { kind: "stock", view: "reorder-rules" },
  createLabel: "Add rule",
  createPermission: "stock.manage",
  upsert: true,
  save: { action: "reorder-rule", success: "Reorder rule saved." },
  fields: [
    { name: "itemId", label: "Item", kind: "select", required: true, options: "items", rowKey: "item_id" },
    { name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: "warehouses", rowKey: "warehouse_id" },
    { name: "minimumQuantity", label: "Minimum (reorder point)", kind: "number", step: QTY_STEP, rowKey: "minimum_quantity" },
    { name: "safetyQuantity", label: "Safety stock", kind: "number", step: QTY_STEP, rowKey: "safety_quantity" },
    { name: "reorderQuantity", label: "Reorder quantity", kind: "number", required: true, step: QTY_STEP, defaultValue: 1, rowKey: "reorder_quantity" },
    { name: "maximumQuantity", label: "Maximum (order up to)", kind: "number", step: QTY_STEP, rowKey: "maximum_quantity" },
    { name: "leadTimeDays", label: "Lead time (days)", kind: "number", step: 1, rowKey: "lead_time_days" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true", rowKey: "active" },
  ],
  columns: () => [
    strong("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("warehouse", "Warehouse", (r) => String(r.warehouse_name)),
    col("min", "Minimum", (r) => quantity(r.minimum_quantity)),
    col("safety", "Safety", (r) => quantity(r.safety_quantity)),
    col("max", "Maximum", (r) => (Number(r.maximum_quantity) > 0 ? quantity(r.maximum_quantity) : "—")),
    col("qty", "Reorder qty", (r) => quantity(r.reorder_quantity)),
    col("lead", "Lead time", (r) => `${r.lead_time_days ?? 0}d`),
    col("available", "Available now", (r) => quantity(r.available_quantity)),
    badge("active", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["item_name", "item_code", "warehouse_name"]),
};

const replenishment: RegisterConfig = {
  key: "replenishment",
  title: "Replenishment",
  description: "Items at or below their reorder point (minimum + safety stock). Raise the purchase from Procurement planning.",
  searchLabel: "Search replenishment",
  emptyTitle: "Nothing needs replenishing",
  emptyDescription: "Every rule-covered item is above its reorder point.",
  source: { kind: "stock", view: "replenishment" },
  columns: (o) => [
    strong("item", "Item", (r) => itemName(o, r.itemId)),
    col("warehouse", "Warehouse", (r) => name(o?.warehouses, r.warehouseId)),
    col("available", "Available", (r) => quantity(r.availableQuantity)),
    col("min", "Minimum", (r) => quantity(r.minimumQuantity)),
    col("safety", "Safety", (r) => quantity(r.safetyQuantity)),
    col("suggested", "Suggested order", (r) => quantity(r.suggestedQuantity)),
    col("lead", "Lead time", (r) => `${r.leadTimeDays ?? 0}d`),
    col("plan", "", () => "Plan purchase", ({ row }) => <Link className="text-brand hover:underline" href={`/procurement/planning?item=${row.original.itemId}`}>Plan purchase</Link>),
  ],
  searchText: () => "",
};

const countColumns = (): Col[] => [
  col("no", "Count", (r) => String(r.count_number), ({ row }) => <Link className="font-medium text-brand hover:underline" href={`/inventory/counts/${row.original.id}`}>{String(row.original.count_number)}</Link>),
  badge("status", "Status", (r) => r.status),
  col("warehouse", "Warehouse", (r) => String(r.warehouse_name)),
  col("lines", "Lines", (r) => String(r.line_count)),
  col("variances", "With variance", (r) => String(r.variance_lines)),
  col("frozen", "Warehouse frozen", (r) => (r.freeze_stock && (r.status === "counting" || r.status === "review") ? "Yes" : "No")),
  col("created", "Started", (r) => dateTime(r.created_at)),
  col("posted", "Posted", (r) => dateTime(r.posted_at)),
];

const cycleCounts: RegisterConfig = {
  key: "cycle-counts",
  title: "Cycle counts",
  description: "Count part of a warehouse (a location, a category or chosen items) on a rolling basis. Variances post only after a second person approves.",
  searchLabel: "Search counts",
  emptyTitle: "No cycle counts yet",
  emptyDescription: "Start a count to compare the shelf with the system.",
  source: { kind: "stock", view: "counts", params: { countType: "cycle" } },
  filters: [{ name: "status", label: "Status", options: ["counting", "review", "posted", "cancelled"].map((value) => ({ value, label: label(value) })) }],
  createLabel: "Start cycle count",
  createPermission: "stock.count",
  save: { action: "count-create", fixed: { countType: "cycle" }, idempotent: true, success: "Count started." },
  fields: [
    { name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: "warehouses" },
    { name: "warehouseLocationId", label: "Location / bin", kind: "select", options: "locations", dependsOn: "warehouseId" },
    { name: "groupId", label: "Category", kind: "select", options: "groups" },
    { name: "blind", label: "Blind count (hide expected quantity)", kind: "bool", defaultValue: "false" },
    { name: "freezeStock", label: "Freeze the warehouse while counting", kind: "bool", defaultValue: "false" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ],
  columns: countColumns,
  searchText: (r) => text(r, ["count_number", "warehouse_name", "status"]),
};

const physicalInventory: RegisterConfig = {
  key: "physical-inventory",
  title: "Physical inventory",
  description: "Count a whole warehouse. The warehouse is frozen by default so nothing moves while it is counted.",
  searchLabel: "Search counts",
  emptyTitle: "No physical counts yet",
  emptyDescription: "Start a physical inventory to reconcile a whole warehouse.",
  source: { kind: "stock", view: "counts", params: { countType: "physical" } },
  filters: [{ name: "status", label: "Status", options: ["counting", "review", "posted", "cancelled"].map((value) => ({ value, label: label(value) })) }],
  createLabel: "Start physical inventory",
  createPermission: "stock.count",
  save: { action: "count-create", fixed: { countType: "physical" }, idempotent: true, success: "Physical inventory started." },
  fields: [
    { name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: "warehouses" },
    { name: "blind", label: "Blind count (hide expected quantity)", kind: "bool", defaultValue: "false" },
    { name: "freezeStock", label: "Freeze the warehouse while counting", kind: "bool", defaultValue: "true" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ],
  columns: countColumns,
  searchText: (r) => text(r, ["count_number", "warehouse_name", "status"]),
};

// ---------------------------------------------------------------- valuation and reports
const sum = (rows: Row[], key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
const CLASS_TONE: Record<string, "success" | "warning" | "danger"> = { active: "success", slow: "warning", dead: "danger" };

const valuation: RegisterConfig = {
  key: "valuation",
  title: "Inventory valuation",
  description: "What the stock on hand is worth, by item and warehouse. FIFO items are valued from their remaining layers.",
  searchLabel: "Search valuation",
  emptyTitle: "No stock to value",
  emptyDescription: "Valuation appears once stock is on hand.",
  source: { kind: "stock", view: "valuation" },
  summary: (rows) => [{ label: "Total stock value", value: amount(sum(rows, "stock_value")) }, { label: "Units on hand", value: quantity(sum(rows, "on_hand_quantity")) }, { label: "Lines", value: String(rows.length) }],
  columns: () => [
    strong("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("warehouse", "Warehouse", (r) => String(r.warehouse_name)),
    col("method", "Costing", (r) => label(r.method)),
    col("onhand", "On hand", (r) => quantity(r.on_hand_quantity)),
    col("unit", "Unit value", (r) => amount(r.unit_value)),
    col("value", "Stock value", (r) => amount(r.stock_value)),
  ],
  searchText: (r) => text(r, ["item_name", "item_code", "warehouse_name", "method"]),
};

const aging: RegisterConfig = {
  key: "aging",
  title: "Stock aging",
  description: "How long the stock on hand has been sitting, in age buckets. Slow: not issued within the threshold. Dead: nothing has moved within the threshold.",
  searchLabel: "Search aging",
  emptyTitle: "No stock on hand",
  emptyDescription: "Aging appears once stock is on hand.",
  source: { kind: "stock", view: "aging", params: { slowDays: "90", deadDays: "180" } },
  filters: [
    { name: "slowDays", label: "Slow after", options: [{ value: "30", label: "30 days" }, { value: "60", label: "60 days" }, { value: "90", label: "90 days" }, { value: "180", label: "180 days" }] },
    { name: "deadDays", label: "Dead after", options: [{ value: "90", label: "90 days" }, { value: "180", label: "180 days" }, { value: "365", label: "365 days" }] },
  ],
  summary: (rows) => [
    { label: "Slow-moving lines", value: String(rows.filter((r) => r.classification === "slow").length) },
    { label: "Dead-stock lines", value: String(rows.filter((r) => r.classification === "dead").length) },
    ...(rows.some((r) => r.stock_value !== null) ? [{ label: "Value of dead stock", value: amount(rows.filter((r) => r.classification === "dead").reduce((t, r) => t + Number(r.stock_value ?? 0), 0)) }] : []),
  ],
  columns: () => [
    strong("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("warehouse", "Warehouse", (r) => String(r.warehouse_name)),
    col("onhand", "On hand", (r) => quantity(r.on_hand_quantity)),
    col("b1", "0–30d", (r) => quantity(r.age_0_30)),
    col("b2", "31–60d", (r) => quantity(r.age_31_60)),
    col("b3", "61–90d", (r) => quantity(r.age_61_90)),
    col("b4", "91–180d", (r) => quantity(r.age_91_180)),
    col("b5", "181–365d", (r) => quantity(r.age_181_365)),
    col("b6", "365d+", (r) => quantity(r.age_over_365)),
    col("issue", "Days since issue", (r) => (r.days_since_issue === null ? "never" : String(r.days_since_issue))),
    col("value", "Value", (r) => amount(r.stock_value)),
    { id: "class", header: "Status", accessorFn: (r: Row) => label(r.classification), cell: ({ row }) => <StatusBadge tone={CLASS_TONE[String(row.original.classification)] ?? "neutral"}>{label(row.original.classification)}</StatusBadge> } as Col,
  ],
  searchText: (r) => text(r, ["item_name", "item_code", "warehouse_name", "classification"]),
};

const movement: RegisterConfig = {
  key: "movement",
  title: "Stock movement",
  description: "What came in, went out and was adjusted per item over a period.",
  searchLabel: "Search movement",
  emptyTitle: "No movement in this period",
  emptyDescription: "Choose a longer period.",
  source: { kind: "stock", view: "movement", params: { days: "30" } },
  filters: [{ name: "days", label: "Period", options: [{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last year" }] }],
  summary: (rows) => [{ label: "Received", value: quantity(sum(rows, "received_quantity")) }, { label: "Issued", value: quantity(sum(rows, "issued_quantity")) }, { label: "Net change", value: quantity(sum(rows, "net_quantity")) }],
  columns: () => [
    strong("item", "Item", (r) => `${r.item_name} (${r.item_code})`),
    col("in", "Received", (r) => quantity(r.received_quantity)),
    col("out", "Issued", (r) => quantity(r.issued_quantity)),
    col("adj", "Adjusted", (r) => quantity(r.adjusted_quantity)),
    col("xfer", "Transfers", (r) => quantity(r.transfer_quantity)),
    col("net", "Net", (r) => quantity(r.net_quantity)),
    col("var", "Cost variance", (r) => amount(r.cost_variance)),
    col("n", "Movements", (r) => String(r.movements)),
  ],
  searchText: (r) => text(r, ["item_name", "item_code"]),
};

const landedCost: RegisterConfig = {
  key: "landed-cost",
  title: "Landed cost",
  description: "Freight, duty and other costs recorded in Procurement. Allocating one adds its share to the value of the stock from that receipt that is still on hand; the part for stock already issued goes to cost of sales.",
  searchLabel: "Search landed costs",
  emptyTitle: "No landed costs",
  emptyDescription: "Landed costs are recorded in Procurement against an order or receipt.",
  source: { kind: "stock", view: "landed-costs" },
  columns: () => [
    strong("type", "Cost", (r) => String(r.cost_type)),
    col("order", "Order", (r) => String(r.order_number ?? (r.receipt_id ? "Receipt" : "—"))),
    col("amount", "Amount", (r) => `${r.currency_code} ${amount(r.amount)}`),
    col("method", "By", (r) => label(r.allocation_method)),
    badge("state", "Stock allocation", (r) => (r.allocated ? "completed" : "pending")),
    col("cap", "Capitalised", (r) => (r.allocated ? amount(r.capitalised_amount) : "—")),
    col("exp", "To cost of sales", (r) => (r.allocated ? amount(r.expensed_amount) : "—")),
  ],
  searchText: (r) => text(r, ["cost_type", "order_number"]),
  rowActions: [{ label: "Allocate to stock", permission: "stock.manage", show: (r) => !r.allocated, success: "Landed cost allocated to stock.", run: (r) => act("landed-cost-allocate", { id: r.id }) }],
};

// ---------------------------------------------------------------- exceptions and outbound
const damaged: RegisterConfig = {
  key: "damaged-stock",
  title: "Damaged stock",
  description: "Write-offs for damaged, expired, spoiled or lost stock. Each is an adjustment with a reason; the ledger keeps the history.",
  searchLabel: "Search write-offs",
  emptyTitle: "No write-offs yet",
  emptyDescription: "Record a write-off when stock is damaged or lost.",
  source: { kind: "stock", view: "ledger", params: { referenceType: "stock_damage" } },
  createLabel: "Record write-off",
  createPermission: "stock.adjust",
  save: { action: "damage", idempotent: true, success: "Write-off recorded." },
  fields: stockDims([
    { name: "quantity", label: "Quantity", kind: "number", required: true, step: QTY_STEP },
    { name: "category", label: "Cause", kind: "select", required: true, defaultValue: "damaged", options: ["damaged", "expired", "spoiled", "lost", "theft", "other"].map((value) => ({ value, label: label(value) })) },
    { name: "note", label: "What happened", kind: "textarea", required: true },
  ]),
  summary: (rows) => [{ label: "Write-offs", value: String(rows.length) }, { label: "Units written off", value: quantity(-sum(rows, "quantity")) }],
  columns: ledgerColumns,
  searchText: ledgerSearch,
};

const returns: RegisterConfig = {
  key: "returns",
  title: "Stock returns",
  description: "Goods coming back: customer returns recorded here, plus POS and supplier returns posted by their modules. A damaged return must go to a quarantine location.",
  searchLabel: "Search returns",
  emptyTitle: "No returns yet",
  emptyDescription: "Record a customer return to put stock back.",
  source: { kind: "stock", view: "ledger", params: { referenceType: "customer_return,pos_return,procurement_return" } },
  createLabel: "Record return",
  createPermission: "stock.receive",
  save: { action: "return", idempotent: true, success: "Return recorded." },
  fields: stockDims([
    { name: "quantity", label: "Quantity", kind: "number", required: true, step: QTY_STEP },
    { name: "condition", label: "Condition", kind: "select", required: true, defaultValue: "good", options: [{ value: "good", label: "Good — restock" }, { value: "damaged", label: "Damaged — quarantine" }] },
    { name: "unitCost", label: "Unit cost", kind: "number", step: 0.01 },
    { name: "reason", label: "Reason", kind: "text", required: true, wide: true },
  ]),
  columns: ledgerColumns,
  searchText: ledgerSearch,
};

const pickLists: RegisterConfig = {
  key: "pick-lists",
  title: "Picking, packing and shipping",
  description: "A pick list reserves the stock. Pick what is found, pack it, then ship: stock leaves the ledger once, when it ships.",
  searchLabel: "Search pick lists",
  emptyTitle: "No pick lists yet",
  emptyDescription: "Create a pick list to fulfil an order from a warehouse.",
  source: { kind: "stock", view: "picks" },
  filters: [{ name: "status", label: "Status", options: ["open", "picking", "picked", "packing", "packed", "shipped", "cancelled"].map((value) => ({ value, label: label(value) })) }],
  createLabel: "New pick list",
  createPermission: "stock.issue",
  save: {
    action: "pick-create",
    idempotent: true,
    success: "Pick list created.",
    transform: (v) => ({
      lines: [1, 2, 3]
        .map((n) => ({ itemId: v[n === 1 ? "itemId" : `itemId${n}`], quantity: v[n === 1 ? "quantity" : `quantity${n}`], warehouseLocationId: n === 1 ? v.warehouseLocationId || undefined : undefined, batchId: n === 1 ? v.batchId || undefined : undefined }))
        .filter((line) => line.itemId && Number(line.quantity) > 0),
    }),
  },
  fields: [
    { name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: "warehouses" },
    { name: "referenceLabel", label: "For order / reference", kind: "text", placeholder: "e.g. SO-1001" },
    { name: "itemId", label: "Item", kind: "select", required: true, options: "items" },
    { name: "quantity", label: "Quantity", kind: "number", required: true, step: QTY_STEP },
    { name: "warehouseLocationId", label: "Pick from location", kind: "select", options: "locations", dependsOn: "warehouseId" },
    { name: "batchId", label: "Batch / lot", kind: "select", options: "batches", dependsOn: "itemId" },
    { name: "itemId2", label: "Second item", kind: "select", options: "items" },
    { name: "quantity2", label: "Second quantity", kind: "number", step: QTY_STEP },
    { name: "itemId3", label: "Third item", kind: "select", options: "items" },
    { name: "quantity3", label: "Third quantity", kind: "number", step: QTY_STEP },
  ],
  columns: () => [
    col("no", "Pick list", (r) => String(r.pick_number), ({ row }) => <Link className="font-medium text-brand hover:underline" href={`/inventory/picking/${row.original.id}`}>{String(row.original.pick_number)}</Link>),
    badge("status", "Status", (r) => r.status),
    col("ref", "For", (r) => String(r.reference_label ?? "—")),
    col("warehouse", "Warehouse", (r) => String(r.warehouse_name)),
    col("lines", "Lines", (r) => String(r.line_count)),
    col("req", "Requested", (r) => quantity(r.requested_quantity)),
    col("picked", "Picked", (r) => quantity(r.picked_quantity)),
    col("carrier", "Carrier", (r) => (r.carrier ? `${r.carrier}${r.tracking_number ? ` · ${r.tracking_number}` : ""}` : "—")),
    col("created", "Created", (r) => dateTime(r.created_at)),
  ],
  searchText: (r) => text(r, ["pick_number", "reference_label", "warehouse_name", "carrier", "tracking_number"]),
};

export const REGISTERS: Record<string, RegisterConfig> = {
  items,
  categories,
  variants,
  "units-of-measure": uoms,
  conversions,
  warehouses,
  locations,
  availability: balances,
  ledger,
  receipts,
  issues,
  adjustments,
  transfers,
  reservations,
  lots,
  expiry,
  "serial-numbers": serials,
  "reorder-rules": reorderRules,
  replenishment,
  "cycle-counts": cycleCounts,
  "physical-inventory": physicalInventory,
  valuation,
  aging,
  movement,
  "landed-cost": landedCost,
  "damaged-stock": damaged,
  returns,
  "pick-lists": pickLists,
};

