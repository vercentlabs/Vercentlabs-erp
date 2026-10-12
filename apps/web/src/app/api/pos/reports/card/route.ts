import { getPosCardPaymentSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// Card payments for a period: captured (provider verified vs externally attested), declined, failed, unresolved, cancelled, captured but
// not finalised, refunds, settled with fees and fee tax, unsettled and mismatched, by outlet, terminal and cashier.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    summary: await getPosCardPaymentSummary(client, context, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      storeId: url.searchParams.get("storeId") ?? undefined,
    }),
  }), "pos.view");
}
