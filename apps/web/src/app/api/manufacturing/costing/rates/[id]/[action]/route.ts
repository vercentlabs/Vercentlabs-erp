import { decideCostRate, submitCostRate } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]).optional(), note: z.string().max(1000).optional(), replacePrevious: z.boolean().optional() });
// submit (a draft for approval) · decide (approve or reject — by someone other than who set it).
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => {
    if (action === "submit") return submitCostRate(client, context, id);
    if (action === "decide") return decideCostRate(client, context, id, input);
    throw new HttpError(404, "Unknown rate action.", "NOT_FOUND");
  });
}
