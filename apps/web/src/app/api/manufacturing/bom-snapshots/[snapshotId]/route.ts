import { getBomSnapshot } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ snapshot: await getBomSnapshot(client, context, snapshotId) }));
}
