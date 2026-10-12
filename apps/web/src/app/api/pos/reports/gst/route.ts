import { getPosGstSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?from=&to=: POS GST summary for the period (this month by default) — documents by type and B2B / B2C, rate-wise taxable value and tax,
// HSN summary, and documents issued per series.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    summary: await getPosGstSummary(client, context, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined }),
  }), "pos.view");
}
