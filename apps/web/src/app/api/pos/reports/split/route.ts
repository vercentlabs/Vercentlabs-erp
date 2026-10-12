import { getPosSplitPaymentSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// Split payments for a period: sales paid with more than one tender, by combination and method, and cancelled split bills.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    summary: await getPosSplitPaymentSummary(client, context, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }),
  }), "pos.view");
}
