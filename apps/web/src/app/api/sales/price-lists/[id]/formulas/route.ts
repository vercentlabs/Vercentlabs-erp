import { z } from "zod";

import { addPriceListFormula, listPriceListFormulas } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The list's price rules (Sales report Phase 3).
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => listPriceListFormulas(client, context, id));
}

const schema = z.object({
  appliesTo: z.enum(["all", "category", "product"]), itemGroupId: z.string().uuid().nullish(), itemId: z.string().uuid().nullish(), base: z.enum(["cost", "list"]),
  basePriceListId: z.string().uuid().nullish(), percent: z.number().min(-99).max(1000), rounding: z.enum(["none", "whole", "end_9", "end_99"]),
});
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", schema, async (client, context, input) => addPriceListFormula(client, context, id, input), 201);
}
