import { reconcileInventoryValuation } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Quantity, layer, entry and General Ledger reconciliation with its exceptions. GET checks; POST runs and records the run. Neither changes a value.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ report: await reconcileInventoryValuation(client, context) }), STOCK_VALUATION_PERMISSIONS.reconcileView);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.object({}).passthrough(), async (client, context) => ({ report: await reconcileInventoryValuation(client, context, { record: true }) }), 200,
    STOCK_VALUATION_PERMISSIONS.reconcileRun);
}
