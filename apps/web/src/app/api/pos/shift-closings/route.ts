import { getShiftClosingHistory } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: closings, newest first — a cashier's own, or (for those who may see expected cash) their outlets'. Filters: storeId, terminalId,
// cashierUserId, from, to, withVariance, custodyPending, q, limit, offset.
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => getShiftClosingHistory(client, context, params), "pos.view");
}
