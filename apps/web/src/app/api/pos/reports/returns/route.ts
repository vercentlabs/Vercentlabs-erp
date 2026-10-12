import { getPosReturnSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?from=&to=: returns in the period (this month by default) — by status; posted values; by reason, condition, disposition, item, outlet
// and cashier; exceptions and no-receipt returns; refunds by method and status (refunded money apart from what is still owed).
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    summary: await getPosReturnSummary(client, context, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined }),
  }), "pos.view");
}
