import { getPosDigitalPaymentSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// UPI & digital payments for a period: verified collections apart from static QR attested ones, by instrument and mode, digital share,
// pending / expired / reconciliation, refunds, settlement with fees, exceptions by kind, by outlet and cashier.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    summary: await getPosDigitalPaymentSummary(client, context, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      storeId: url.searchParams.get("storeId") ?? undefined,
    }),
  }), "pos.view");
}
