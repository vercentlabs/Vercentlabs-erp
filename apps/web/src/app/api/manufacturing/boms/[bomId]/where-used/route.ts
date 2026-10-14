import { getBomWhereUsed } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ whereUsed: await getBomWhereUsed(client, context, bomId) }));
}
