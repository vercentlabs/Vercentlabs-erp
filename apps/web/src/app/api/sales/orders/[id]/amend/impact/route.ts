import { z } from "zod";

import { previewSalesOrderAmendmentImpact } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// F044: what an amendment would change and what blocks it — read only, POST
// because it takes the proposed order as a body.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.create", z.record(z.string(), z.unknown()), async (client, context, input) => ({
    impact: await previewSalesOrderAmendmentImpact(client, context, id, input),
  }));
}
