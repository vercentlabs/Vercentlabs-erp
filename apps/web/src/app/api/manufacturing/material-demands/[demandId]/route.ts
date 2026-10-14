import { z } from "zod";

import { updateMaterialDemand } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Procurement acknowledges, fulfils (with the requisition or PO as its note) or cancels a demand.
const schema = z.object({ action: z.enum(["acknowledge", "fulfil", "cancel"]), note: z.string().max(500).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ demandId: string }> }) {
  const { demandId } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => ({ demand: await updateMaterialDemand(client, context, demandId, input) }), 200, "workspace.view");
}
