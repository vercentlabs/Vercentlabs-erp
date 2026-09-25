import { z } from "zod";

import { decideSalesReturnRequest } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// F054: approve or reject a return (not by the person who asked for it).
const schema = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(2000).nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.approve", schema, async (client, context, input) => ({ result: await decideSalesReturnRequest(client, context, id, input) }));
}
