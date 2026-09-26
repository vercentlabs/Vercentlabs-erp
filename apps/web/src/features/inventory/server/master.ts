import "server-only";

import { HttpError } from "@/core/http";

// Inventory maintains its master data through the shared business-data engine. Only these
// resources are reachable from here, each behind the permission the seeded roles already hold.
export const INVENTORY_MASTER = {
  items: { permission: "items.manage", label: "Item" },
  "item-groups": { permission: "items.manage", label: "Category" },
  "item-variants": { permission: "items.manage", label: "Variant" },
  "item-uom-conversions": { permission: "items.manage", label: "Conversion" },
  "units-of-measure": { permission: "inventory_setup.manage", label: "Unit of measure" },
  warehouses: { permission: "inventory_setup.manage", label: "Warehouse" },
  "warehouse-locations": { permission: "inventory_setup.manage", label: "Location" },
} as const;
export type InventoryMasterResource = keyof typeof INVENTORY_MASTER;

export function masterResource(resource: string): InventoryMasterResource {
  if (!(resource in INVENTORY_MASTER)) throw new HttpError(404, "Unknown resource.");
  return resource as InventoryMasterResource;
}

// The engine writes every mapped column, so anything omitted would be inserted as NULL and hit a
// NOT NULL constraint. These are the tables' own defaults, applied here for a create.
const DEFAULTS: Record<InventoryMasterResource, Record<string, unknown>> = {
  items: { status: "active", itemType: "product", trackInventory: true, trackingType: "none", allowNegativeStock: false, valuationMethod: "moving_average", standardCost: 0, salesPrice: 0, purchasePrice: 0 },
  "item-groups": { status: "active" },
  "item-variants": { status: "active" },
  "item-uom-conversions": { status: "active" },
  "units-of-measure": { status: "active", decimalPlaces: 3, isBase: false, category: "quantity" },
  warehouses: { status: "active", warehouseType: "stores", allowNegativeStock: false },
  "warehouse-locations": { status: "active", locationType: "zone" },
};

const REQUIRED: Record<InventoryMasterResource, Array<[string, string]>> = {
  items: [["code", "Code"], ["name", "Name"], ["uomId", "Unit of measure"]],
  "item-groups": [["code", "Code"], ["name", "Name"]],
  "item-variants": [["itemId", "Item"], ["sku", "SKU"], ["name", "Name"]],
  "item-uom-conversions": [["itemId", "Item"], ["fromUomId", "From unit"], ["toUomId", "To unit"], ["conversionFactor", "Conversion factor"]],
  "units-of-measure": [["code", "Code"], ["name", "Name"]],
  warehouses: [["code", "Code"], ["name", "Name"]],
  "warehouse-locations": [["warehouseId", "Warehouse"], ["code", "Code"], ["name", "Name"]],
};

const ENUMS: Record<string, string[]> = {
  itemType: ["product", "service", "consumable", "asset"],
  trackingType: ["none", "batch", "serial"],
  valuationMethod: ["moving_average", "fifo", "standard"],
  warehouseType: ["stores", "raw_material", "work_in_progress", "finished_goods", "transit", "returns", "virtual"],
  locationType: ["zone", "aisle", "rack", "bin", "staging", "quality", "other"],
  category: ["quantity", "weight", "volume", "length", "area", "time", "packaging", "other"],
  status: ["active", "inactive"],
};
const NON_NEGATIVE = ["standardCost", "salesPrice", "purchasePrice", "capacity"];

function normalise(input: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === "" || value === undefined) next[key] = null; // an emptied field clears the column
    else next[key] = typeof value === "string" ? value.trim() : value;
  }
  return next;
}

function validate(input: Record<string, unknown>) {
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const value = input[key];
    if (value !== undefined && value !== null && !allowed.includes(String(value))) throw new HttpError(400, `${key} must be one of: ${allowed.join(", ")}.`);
  }
  for (const key of NON_NEGATIVE) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${key} must be zero or greater.`);
  }
  if (input.conversionFactor !== undefined && input.conversionFactor !== null && !(Number(input.conversionFactor) > 0)) throw new HttpError(400, "The conversion factor must be greater than zero.");
  if (input.decimalPlaces !== undefined && input.decimalPlaces !== null) {
    const n = Number(input.decimalPlaces);
    if (!Number.isInteger(n) || n < 0 || n > 6) throw new HttpError(400, "Decimal places must be a whole number from 0 to 6.");
  }
}

export function shapeMasterCreate(resource: InventoryMasterResource, raw: Record<string, unknown>, activeCompanyId: string) {
  const input = { ...DEFAULTS[resource], ...normalise(raw) };
  for (const [key, label] of REQUIRED[resource]) {
    const value = input[key];
    if (value === undefined || value === null || String(value).trim() === "") throw new HttpError(400, `${label} is required.`);
  }
  // Codes are identifiers people type and scan: normalise the case so "abc" and "ABC" cannot coexist.
  if (typeof input.code === "string") input.code = input.code.toUpperCase();
  validate(input);
  // Company-scoped tables carry the ACTIVE company; the engine refuses any other.
  if (resource === "items" || resource === "warehouses" || resource === "item-variants") input.companyId = activeCompanyId;
  return input;
}

export function shapeMasterUpdate(raw: Record<string, unknown>) {
  const input = normalise(raw);
  delete input.companyId; // a record never moves company
  if (typeof input.code === "string") input.code = input.code.toUpperCase();
  validate(input);
  return input;
}

// Refuses identity changes (tracking, unit of measure, valuation) once an item has movements; the rule
// lives in the Stock domain.
export { guardStockItemIdentity as guardItemIdentity } from "@vercentlabs/api";
