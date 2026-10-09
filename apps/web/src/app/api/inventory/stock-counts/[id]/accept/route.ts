import { z } from "zod";

import { acceptCountLines } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Accept counted lines. body: { lineIds? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await acceptCountLines(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.review);
}
