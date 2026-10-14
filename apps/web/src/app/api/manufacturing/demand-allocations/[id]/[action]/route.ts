import { z } from "zod";

import { reassignManufacturingSupply, releaseManufacturingAllocation } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// release · reassign assigned output.
const schema = z.object({ reason: z.string().max(1000), quantity: z.union([z.string(), z.number()]).optional(), toDemandId: z.string().uuid().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => {
    if (action === "release") return { demand: await releaseManufacturingAllocation(client, context, id, input) };
    if (action === "reassign") return await reassignManufacturingSupply(client, context, id, input);
    throw new HttpError(404, "Unknown allocation action.", "NOT_FOUND");
  });
}
