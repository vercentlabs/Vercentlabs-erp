import { resolveSupplierDefaults } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// What a new purchase document would take from this supplier (an active one only).
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ defaults: await resolveSupplierDefaults(client, context, id) }));
}
