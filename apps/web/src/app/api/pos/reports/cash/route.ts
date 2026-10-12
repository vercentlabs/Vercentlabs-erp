import { getPosCashPaymentSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// Cash payments for a period: cash-settled sales, received, change, net, refunds, by outlet, terminal, cashier and session, cash share,
// cash in mixed tenders, cash still pending, tenders handed back and session variances.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    summary: await getPosCashPaymentSummary(client, context, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      storeId: url.searchParams.get("storeId") ?? undefined,
    }),
  }), "pos.view");
}
