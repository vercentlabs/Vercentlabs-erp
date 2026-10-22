import { createPurchaseRateContract, listPurchaseRateContracts } from "@vercentlabs/api";

import { asPage, procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Rate contracts (Procurement plan Phase 3): the list by view, supplier and search, and recording one.
const FILTERS = ["limit", "offset", "view", "supplierId", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => asPage(await listPurchaseRateContracts(client, context, filters)));
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createPurchaseRateContract(client, context, input) }), 201);
}
