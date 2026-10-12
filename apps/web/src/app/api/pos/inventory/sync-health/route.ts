import { getPosInventorySyncHealth } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: live stock health — events in the last hour, delivery delay, undelivered events, and whether Inventory's balances agree with its ledger.
export async function GET(request: Request) {
  return posRead(request, async (client, context) => ({ health: await getPosInventorySyncHealth(client, context) }), "pos.view");
}
