import { getMoMaterialVarianceLine } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One material line's variance: every basis, its posted consumption and scrap, exceptions and kept snapshots.
export async function GET(request: Request, ctx: { params: Promise<{ id: string; materialId: string }> }) {
  const { id, materialId } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ line: await getMoMaterialVarianceLine(client, context, id, materialId) }));
}
