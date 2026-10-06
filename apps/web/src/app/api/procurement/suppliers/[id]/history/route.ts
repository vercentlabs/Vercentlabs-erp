import { listSupplierHistory } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ history: await listSupplierHistory(client, context, id) }));
}
