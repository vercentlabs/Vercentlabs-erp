import { z } from "zod";

import { listStockBalanceRebuilds, rebuildInventoryBalanceProjection, reconcileInventoryBalances } from "@vercentlabs/api";
import { STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Does the current balance equal the ledger and the active reservations? Lists every difference; changes nothing.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({
    reconciliation: await reconcileInventoryBalances(client, context),
    rebuilds: await listStockBalanceRebuilds(client, context),
  }));
}

// Rebuild the balances from the ledger and the reservations. body: { reason }. Recorded with what changed.
export async function POST(request: Request) {
  return inventoryMutation(request, z.object({ reason: z.string() }), async (client, context, input) =>
    ({ rebuild: await rebuildInventoryBalanceProjection(client, context, input) }), 200, STOCK_PERMISSIONS.rebuildBalances);
}
