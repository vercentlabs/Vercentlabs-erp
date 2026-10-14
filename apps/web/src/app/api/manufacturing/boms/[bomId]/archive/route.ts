import { z } from "zod";

import { archiveManufacturingBom } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

export async function POST(request: Request, ctx: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await ctx.params;
  return manufacturingMutation(request, z.object({ reason: z.string().trim().min(1).max(1000) }), async (client, context, input) => ({ bom: await archiveManufacturingBom(client, context, bomId, input) }));
}
