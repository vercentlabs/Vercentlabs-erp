import "server-only";

import { findAccountDuplicates, recordAccountDuplicateOverride } from "@vercentlabs/api";

import { HttpError } from "@/core/http";

type DuplicateClient = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
type DuplicateContext = { organizationId: string; userId: string; activeCompanyId: string | null; activeBranchId: string | null; allowAllCompanies?: boolean; permissions: string[] };

// Sales maintains customers, their contacts and addresses, and browses the
// product catalogue, through the shared business-data engine (the same tables
// CRM accounts sit on). Only these resources are reachable from Sales; anything
// else (suppliers' warehouses, currencies, ...) belongs to other modules' setup.
export const SALES_READABLE = ["parties", "items", "contacts", "addresses"] as const;
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
// A rep can otherwise create the same customer twice: business_parties has
// unique constraints on code/gstin, but nothing catches a differently-coded
// duplicate of the same legal entity. Reuses the same governed
// exact-match-blocks-unless-overridden policy CRM already applies to
// Accounts (findAccountDuplicates/recordAccountDuplicateOverride are
// package-root exports, not CRM-internal) -- gated on `parties.manage`
// (what Sales party mutations already require) instead of CRM's
// `crm.accounts.manage`, so Sales users need no CRM permission to override.
export async function assertPartyDuplicatePolicy(
  client: DuplicateClient,
  context: DuplicateContext,
  candidate: { displayName?: unknown; legalName?: unknown; gstin?: unknown; pan?: unknown },
  overrideReason: unknown,
  excludeId?: string,
): Promise<{ matchedPartyIds: string[]; reason: string } | null> {
  const matches = await findAccountDuplicates(client, context, {
    name: candidate.displayName ?? candidate.legalName,
    gstin: candidate.gstin,
    pan: candidate.pan,
    excludeId,
  });
  const exact = (matches as Array<{ classification: string; id: string }>).filter((row) => row.classification === "exact");
  if (!exact.length) return null;
  const canOverride = context.permissions.includes("parties.manage");
  const reason = String(overrideReason ?? "").trim();
  if (!canOverride || reason.length < 10) {
    throw new HttpError(
      409,
      canOverride
        ? "Explain in at least 10 characters why this exact duplicate must be created."
        : "This looks like an exact duplicate of an existing customer.",
      "SALES_PARTY_DUPLICATE_EXACT",
      { matches: exact },
    );
  }
  return { matchedPartyIds: exact.map((row) => row.id), reason };
}

export async function recordPartyDuplicateOverride(
  client: DuplicateClient,
  context: DuplicateContext,
  partyId: string,
  matchedPartyIds: string[],
  operation: "create" | "update",
  reason: string,
) {
  return recordAccountDuplicateOverride(client, context, partyId, matchedPartyIds, operation, reason, "sales");
}

export { CUSTOMER_TYPES };
