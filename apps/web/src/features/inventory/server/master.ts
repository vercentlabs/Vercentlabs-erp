import "server-only";

import { HttpError } from "@/core/http";

// Inventory maintains its warehouse master data through the shared business-data engine. Only these resources are reachable from
// here, each behind the permission the seeded roles already hold. Items, item categories, units of measure, unit conversions and
// variants belong to the Item Master (/api/products) and its rules.
export const INVENTORY_MASTER = {
  warehouses: { permission: "inventory_setup.manage", label: "Warehouse" },
  "warehouse-locations": {
    permission: "inventory_setup.manage",
    label: "Location",
  },
} as const;
export type InventoryMasterResource = keyof typeof INVENTORY_MASTER;

export function masterResource(resource: string): InventoryMasterResource {
  if (!(resource in INVENTORY_MASTER))
    throw new HttpError(404, "Unknown resource.");
  return resource as InventoryMasterResource;
}

// The engine writes every mapped column, so anything omitted would be inserted as NULL and hit a
// NOT NULL constraint. These are the tables' own defaults, applied here for a create.
const DEFAULTS: Record<InventoryMasterResource, Record<string, unknown>> = {
  warehouses: {
    status: "active",
    warehouseType: "stores",
    allowNegativeStock: false,
  },
  "warehouse-locations": { status: "active", locationType: "zone" },
};

const REQUIRED: Record<InventoryMasterResource, Array<[string, string]>> = {
  warehouses: [
    ["code", "Code"],
    ["name", "Name"],
  ],
  "warehouse-locations": [
    ["warehouseId", "Warehouse"],
    ["code", "Code"],
    ["name", "Name"],
  ],
};

const ENUMS: Record<string, string[]> = {
  warehouseType: [
    "stores",
    "raw_material",
    "work_in_progress",
    "finished_goods",
    "transit",
    "returns",
    "virtual",
  ],
  locationType: ["zone", "aisle", "rack", "bin", "staging", "quality", "other"],
  status: ["active", "inactive"],
};
const NON_NEGATIVE = ["capacity"];

function normalise(input: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === "" || value === undefined)
      next[key] = null; // an emptied field clears the column
    else next[key] = typeof value === "string" ? value.trim() : value;
  }
  return next;
}

function validate(input: Record<string, unknown>) {
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const value = input[key];
    if (
      value !== undefined &&
      value !== null &&
      !allowed.includes(String(value))
    )
      throw new HttpError(400, `${key} must be one of: ${allowed.join(", ")}.`);
  }
  for (const key of NON_NEGATIVE) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
      throw new HttpError(400, `${key} must be zero or greater.`);
  }
}

export function shapeMasterCreate(
  resource: InventoryMasterResource,
  raw: Record<string, unknown>,
) {
  const input = { ...DEFAULTS[resource], ...normalise(raw) };
  for (const [key, label] of REQUIRED[resource]) {
    const value = input[key];
    if (value === undefined || value === null || String(value).trim() === "")
      throw new HttpError(400, `${label} is required.`);
  }
  // Codes are identifiers people type and scan: normalise the case so "abc" and "ABC" cannot coexist.
  if (typeof input.code === "string") input.code = input.code.toUpperCase();
  validate(input);
  return input;
}

export function shapeMasterUpdate(raw: Record<string, unknown>) {
  const input = normalise(raw);
  if (typeof input.code === "string") input.code = input.code.toUpperCase();
  validate(input);
  return input;
}
