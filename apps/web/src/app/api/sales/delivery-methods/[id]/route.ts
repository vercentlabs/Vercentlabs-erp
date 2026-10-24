import { z } from "zod";

import { saveDeliveryMethod, setDeliveryMethodActive } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { deliveryMethodSchema } from "@/features/sales/settings/delivery-method-schema";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", deliveryMethodSchema, async (client, context, input) => saveDeliveryMethod(client, context, input, id));
}

// { active }: switch the method on or off.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", z.object({ active: z.boolean() }), async (client, context, input) => setDeliveryMethodActive(client, context, id, input.active));
}
