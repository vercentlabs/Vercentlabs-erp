import { z } from "zod";

import { closeProductionBatch } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Close a production batch: no more output is reported into it.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; batchId: string }> }) {
  const { id, batchId } = await ctx.params;
  return manufacturingMutation(request, z.object({}).passthrough(), async (client, context) => ({ batch: await closeProductionBatch(client, context, id, batchId) }));
}
