import "server-only";

import { HttpError } from "@/core/http";

// Sales maintains customers, their contacts and addresses, and browses the
// product catalogue, through the shared business-data engine (the same tables
// CRM accounts sit on). Only these resources are reachable from Sales; anything
// else (suppliers' warehouses, currencies, ...) belongs to other modules' setup.
export const SALES_READABLE = ["parties", "items"] as const;
export const SALES_WRITABLE = ["parties", "contacts", "addresses"] as const;
const CUSTOMER_TYPES = ["customer", "prospect", "both"];

export function assertReadable(resource: string): asserts resource is (typeof SALES_READABLE)[number] {
  if (!(SALES_READABLE as readonly string[]).includes(resource)) throw new HttpError(404, "Unknown resource.");
}
export function assertWritable(resource: string): asserts resource is (typeof SALES_WRITABLE)[number] {
  if (!(SALES_WRITABLE as readonly string[]).includes(resource)) throw new HttpError(404, "Unknown resource.");
}

// A customer created from Sales is a customer: never let this surface create or
// convert a record into a supplier.
// Required columns per resource (the tables' NOT NULL columns without defaults).
// Checked here so a missing field is a clear 400, not a database error.
const REQUIRED: Record<string, Array<[string, string]>> = {
  parties: [["code", "Code"], ["displayName", "Display name"]],
  contacts: [["partyId", "Customer"], ["firstName", "First name"]],
  addresses: [["partyId", "Customer"], ["addressType", "Address type"], ["line1", "Address line 1"], ["city", "City"], ["state", "State"], ["postalCode", "Postal code"], ["countryCode", "Country"]],
};
function assertRequired(resource: string, input: Record<string, unknown>) {
  for (const [key, label] of REQUIRED[resource] ?? []) {
    const value = input[key];
    if (value === undefined || value === null || String(value).trim() === "") throw new HttpError(400, `${label} is required.`);
  }
}

export function shapeCustomerInput(resource: string, input: Record<string, unknown>, creating: boolean) {
  // The engine requires an explicit status on create; a new record is active.
  const next: Record<string, unknown> = creating ? { status: "active", ...input } : { ...input };
  if (creating) assertRequired(resource, next);
  if (resource !== "parties") return next;
  if (creating && !next.partyType) next.partyType = "customer";
  if (next.partyType !== undefined && !CUSTOMER_TYPES.includes(String(next.partyType))) throw new HttpError(400, "Sales can only maintain customers and prospects.");
  return next;
}
export { CUSTOMER_TYPES };
