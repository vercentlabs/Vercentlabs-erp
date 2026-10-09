import { z } from "zod";

import { setLineResolution } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// How a variance is resolved, and the cost basis of stock found. body: { lineId, resolutionType?, note?, valuationSource?, unitCost?, costNote? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await setLineResolution(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.review);
}
