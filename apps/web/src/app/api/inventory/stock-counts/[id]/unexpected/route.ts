import { z } from "zod";

import { addUnexpectedStock } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Stock found that the count has no line for. body: { itemId, locationId?, quantity, uomId?, batchId? | batchNumber + newExpiresOn?, serialNumbers? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await addUnexpectedStock(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.addUnexpected);
}
