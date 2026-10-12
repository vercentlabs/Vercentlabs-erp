import { listCashCustodyTransfers } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: closing cash waiting to be accepted (?status=PENDING_ACCEPTANCE|ACCEPTED, storeId, mine).
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => ({ transfers: await listCashCustodyTransfers(client, context, params) }), "pos.view");
}
