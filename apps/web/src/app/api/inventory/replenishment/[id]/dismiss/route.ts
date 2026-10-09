import { dismissReplenishmentRecommendation } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Dismiss the open recommendation (with a reason). Stock and the rule are unchanged.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.object({ reason: z.string().optional() }), async (client, context, input) => ({ detail: await dismissReplenishmentRecommendation(client, context, id, input) }), 200,
    STOCK_REORDER_PERMISSIONS.dismiss);
}
