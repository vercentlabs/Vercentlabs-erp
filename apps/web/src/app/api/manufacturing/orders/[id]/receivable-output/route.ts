import { getReceivableManufacturingOutput } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The order's accepted, unreceived output per production entry, with the destinations a receipt may go to.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ receivable: await getReceivableManufacturingOutput(client, context, id) }));
}
