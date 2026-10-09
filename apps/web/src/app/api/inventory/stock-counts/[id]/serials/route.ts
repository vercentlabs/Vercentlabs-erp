import { z } from "zod";

import { enterSerialCount } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Serial numbers found on a serial line. body: { lineId, presentSerialNumbers, unexpectedSerialNumbers? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await enterSerialCount(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.view);
}
