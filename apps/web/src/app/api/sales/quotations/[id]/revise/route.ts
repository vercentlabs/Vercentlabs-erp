import { reviseQuotation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.create", documentSchema, async (client, context, input) => ({ version: await reviseQuotation(client, context, id, input) }));
}
