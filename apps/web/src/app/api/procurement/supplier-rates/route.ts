import { createSupplierRate, listSupplierRates } from "@vercentlabs/api";

import { asPage, procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Supplier Rates (Procurement report H1): the price lists by view, supplier, item and search, and recording a rate.
const FILTERS = ["limit", "offset", "view", "supplierId", "itemId", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => asPage(await listSupplierRates(client, context, filters)));
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createSupplierRate(client, context, input) }), 201);
}
