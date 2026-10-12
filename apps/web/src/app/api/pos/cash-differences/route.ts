import { listCashDifferences } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: cash differences, newest first (?context, type, status, financePending, storeId, cashierUserId, shiftId, from, to, limit, offset).
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => listCashDifferences(client, context, params), "pos.view");
}
