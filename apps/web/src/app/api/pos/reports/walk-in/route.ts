import { getWalkInSalesSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// ?from=&to=&storeId= — walk-in and registered sales from finished sales and returns (transactions, never customers).
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    summary: await getWalkInSalesSummary(client, context, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, storeId: search.get("storeId") ?? undefined }),
  }), "pos.view");
}
