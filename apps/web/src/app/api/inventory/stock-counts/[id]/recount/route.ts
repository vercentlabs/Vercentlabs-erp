import { z } from "zod";

import { requestRecount } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Ask for lines to be counted again (their attempts stay). body: { lineIds, reason? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await requestRecount(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.requestRecount);
}
