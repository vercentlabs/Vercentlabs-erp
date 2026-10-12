import { listReconciliationExceptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: the exception queue (?status, code, layer, storeId, merchantAccountId, assignedTo, from, to, minAgeDays, q).
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => listReconciliationExceptions(client, context, params), "pos.view");
}
