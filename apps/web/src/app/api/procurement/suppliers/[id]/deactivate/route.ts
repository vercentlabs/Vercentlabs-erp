import { deactivateSupplier } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

// Active → Inactive: no new business; history untouched. Body: reason (optional).
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => await deactivateSupplier(client, context, id, input));
}
