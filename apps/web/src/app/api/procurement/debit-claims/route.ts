import { createSupplierDebitClaim, getSupplierDebitClaims } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Debit notes to suppliers (commercial claims): the list and a new draft.
const FILTERS = ["view", "supplierId", "status", "from", "to", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => ({ rows: await getSupplierDebitClaims(client, context, filters) }), "procurement.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createSupplierDebitClaim(client, context, input as Record<string, unknown>) }), 201, "procurement.view");
}
