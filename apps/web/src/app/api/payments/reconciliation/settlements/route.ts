import { listSettlementBatches } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: provider settlements (?merchantAccountId, status, from, to).
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => ({ settlements: await listSettlementBatches(client, context, params) }), "pos.view");
}
