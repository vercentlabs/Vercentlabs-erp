import { setItemNegativeStockPolicy } from "@vercentlabs/api";
import { NEGATIVE_STOCK_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// An item always blocks negative stock, or inherits the company policy (it is never more permissive). Audited.
const schema = z.object({ alwaysBlock: z.boolean(), reason: z.string().max(1000).nullable().optional() });

export async function PATCH(request: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;
  return inventoryMutation(request, schema, async (client, context, input) => ({ item: await setItemNegativeStockPolicy(client, context, itemId, input) }), 200,
    NEGATIVE_STOCK_PERMISSIONS.itemBlock);
}
