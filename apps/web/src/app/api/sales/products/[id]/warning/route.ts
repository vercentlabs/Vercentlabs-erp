import { z } from "zod";

import { setProductSalesWarning } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The product's sales warning: { level: none | warn | block, message }.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({ level: z.enum(["none", "warn", "block"]), message: z.string().max(300).nullable().optional() }),
    async (client, context, input) => setProductSalesWarning(client, context, id, input));
}
