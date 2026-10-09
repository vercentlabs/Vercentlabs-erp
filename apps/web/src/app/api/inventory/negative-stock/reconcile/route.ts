import { reconcileNegativeStockExceptions } from "@vercentlabs/api";
import { NEGATIVE_STOCK_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Open exceptions against the balances below zero. GET changes nothing; POST repairs the exception records (never a balance).
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ report: await reconcileNegativeStockExceptions(client, context) }), NEGATIVE_STOCK_PERMISSIONS.viewExceptions);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.object({}).passthrough(), async (client, context) => ({ report: await reconcileNegativeStockExceptions(client, context, { repair: true }) }), 200,
    NEGATIVE_STOCK_PERMISSIONS.configure);
}
