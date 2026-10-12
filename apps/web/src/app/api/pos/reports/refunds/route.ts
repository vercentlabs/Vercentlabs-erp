import { getPosRefundSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?from=&to=: refunds — owed, paid, outstanding, processing, failed, unknown; by method, source, reason, outlet, cashier and cash session.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    summary: await getPosRefundSummary(client, context, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined }),
  }), "pos.view");
}
