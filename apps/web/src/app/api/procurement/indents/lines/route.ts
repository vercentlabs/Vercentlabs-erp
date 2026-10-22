import { listIndentLinesToOrder } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";


// Approved indent lines with something still to order (?indentId=&itemId=&search=): the buyer's picker for an order or an RFQ.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return procurementRead(request, async (client, context) => ({ lines: await listIndentLinesToOrder(client, context, {
    indentId: url.searchParams.get("indentId") ?? undefined, itemId: url.searchParams.get("itemId") ?? undefined, search: url.searchParams.get("search") ?? undefined }) }));
}
