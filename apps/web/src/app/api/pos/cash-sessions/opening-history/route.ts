import { listPosCashOpeningHistory } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?from=&to=&storeId=&drawerId=&sourceType=&withVariance=&limit=&offset=: every opening count — drawer, cashier, amount, source, handover and
// difference, approval, corrections (SESSION_VIEW_EXPECTED_CASH or outlet management).
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const value = (name: string) => search.get(name) || undefined;
  return posRead(request, async (client, context) => listPosCashOpeningHistory(client, context, {
    from: value("from"), to: value("to"), storeId: value("storeId"), drawerId: value("drawerId"), sourceType: value("sourceType"), withVariance: value("withVariance"),
    limit: value("limit") ? Number(value("limit")) : undefined, offset: value("offset") ? Number(value("offset")) : undefined,
  }), "pos.view");
}
