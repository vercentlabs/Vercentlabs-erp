import { z } from "zod";

import { getManufacturingOrder, updateManufacturingOrderDraft } from "@vercentlabs/api";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";
import { orderHeaderSchema } from "@/features/manufacturing/orders/api/mo-schemas";

// One manufacturing order with its materials, production, receipts, costs and history.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ order: await getManufacturingOrder(client, context, id) }));
}

// Edit a draft (quantity, date or revision changes re-plan its materials).
const schema = orderHeaderSchema.extend({ expectedVersion: z.number().int().optional() });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => ({ order: await updateManufacturingOrderDraft(client, context, id, input) }));
}
