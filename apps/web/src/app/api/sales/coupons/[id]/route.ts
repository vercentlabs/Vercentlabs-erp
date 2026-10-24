import { z } from "zod";

import { saveCoupon, setCouponActive } from "@vercentlabs/api";

import { couponSchema } from "@/features/sales/settings/coupon-schema";
import { salesMutation } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", couponSchema, async (client, context, input) => saveCoupon(client, context, input, id));
}

// { active }: switch the coupon on or off.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", z.object({ active: z.boolean() }), async (client, context, input) => setCouponActive(client, context, id, input.active));
}
