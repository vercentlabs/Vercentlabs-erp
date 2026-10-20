import { getIncomingInventoryStatus } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// What Inventory holds for the inspected goods — held, released, returned, disposed, cleared by Quality — read from their owners.
type Params = { params: Promise<{ inspectionId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return qualityRead(request, (client, context) => getIncomingInventoryStatus(client, context, inspectionId), "quality.incoming.view");
}
