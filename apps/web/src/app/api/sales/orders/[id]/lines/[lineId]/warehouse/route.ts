import { z } from "zod";

import { changeSalesOrderLineWarehouse } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The warehouse a confirmed order line ships from; stock reserved in the old one is released.
const schema = z.object({ warehouseId: z.string().uuid(), reason: z.string().max(500).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await ctx.params;
  return salesMutation(request, "sales.order.change_warehouse", schema, async (client, context, input) => ({
    result: await changeSalesOrderLineWarehouse(client, context, id, { ...input, lineId }),
  }));
}
