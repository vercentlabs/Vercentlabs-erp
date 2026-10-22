import { createPurchaseIndent, listPurchaseIndents } from "@vercentlabs/api";

import { asPage, procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";


// Purchase indents (Procurement plan Phase 2): the list by view and search, and raising one.
const FILTERS = ["limit", "offset", "view", "status", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => asPage(await listPurchaseIndents(client, context, filters)));
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createPurchaseIndent(client, context, input) }), 201);
}
