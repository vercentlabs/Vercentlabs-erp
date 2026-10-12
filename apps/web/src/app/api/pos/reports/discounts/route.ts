import { getPosDiscountSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// Realised POS discounts for a period: automatic, manual and bill discounts apart, by outlet, item, reason, customer and (for managers) cashier.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    summary: await getPosDiscountSummary(client, context, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined, storeId: url.searchParams.get("storeId") ?? undefined }),
  }), "pos.view");
}
