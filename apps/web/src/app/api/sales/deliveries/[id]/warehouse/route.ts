import { z } from "zod";

import { changeDeliveryWarehouse } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Moves a draft delivery to another warehouse: its lines' reservations are released there and made in the new one.
const schema = z.object({ warehouseId: z.string().uuid(), reason: z.string().max(500).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.change_warehouse", schema, async (client, context, input) => ({ result: await changeDeliveryWarehouse(client, context, id, input) }));
}
