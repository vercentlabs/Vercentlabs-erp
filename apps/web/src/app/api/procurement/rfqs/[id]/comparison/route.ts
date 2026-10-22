import { getRfqComparison } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";


// The side-by-side comparison of the suppliers' answers.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => getRfqComparison(client, context, id));
}
