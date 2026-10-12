import { getPosStockSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?from=&to=&storeId=: stock reduction — quantity sold and issued, cost consumed, by item, outlet and warehouse, batch and serial; sale
// lines whose movements disagree; bills waiting on stock recovery; checkout holds.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    summary: await getPosStockSummary(client, context, { from: search.get("from"), to: search.get("to"), storeId: search.get("storeId") }),
  }), "pos.view");
}
