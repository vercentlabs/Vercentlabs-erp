import { z } from "zod";

import { reverseOpeningStock, validateOpeningStockReversal } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// What stands in the way of reversing (empty: it can be reversed).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ blockers: await validateOpeningStockReversal(client, context, id) }), OPENING_STOCK_PERMISSIONS.view);
}

// body: { reason }
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ document: await reverseOpeningStock(client, context, id, input) }), 200, OPENING_STOCK_PERMISSIONS.view);
}
