import { z } from "zod";

import { confirmSalesOrderWithCrmSync } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  assignedTo: z.string().uuid().nullish(),
  overrideCredit: z.boolean().optional(),
  creditOverrideReason: z.string().trim().max(1000).nullish(),
});

// Credit override is enforced in the domain (it demands sales.credit.override
// and a reason); this route just carries the intent.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.confirm", schema, async (client, context, input) => ({ result: await confirmSalesOrderWithCrmSync(client, context, id, input) }));
}
