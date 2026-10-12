import { getPosTaxSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// POS tax summary for a period: by component, classification and rate, HSN/SAC, outlet, buyer; returns; reconciliation.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    summary: await getPosTaxSummary(client, context, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined, storeId: url.searchParams.get("storeId") ?? undefined }),
  }), "pos.view");
}
