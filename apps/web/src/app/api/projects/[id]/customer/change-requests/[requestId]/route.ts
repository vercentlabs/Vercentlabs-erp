import { decideProjectCustomerChange, withdrawProjectCustomerChange } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

const schema = z.object({ action: z.enum(["decide", "withdraw"]), decision: z.enum(["APPROVE", "REJECT"]).optional(), note: z.string().max(1000).optional() });
// Approve or reject a customer change (someone other than the requester), or withdraw it.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) =>
    input.action === "withdraw" ? withdrawProjectCustomerChange(client, context, id, requestId) : decideProjectCustomerChange(client, context, id, requestId, input));
}
