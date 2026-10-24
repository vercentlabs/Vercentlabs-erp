import { setSupplierRateActive } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// activate · deactivate
type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => {
    if (action !== "activate" && action !== "deactivate") throw new HttpError(404, "Unknown action.");
    return { result: await setSupplierRateActive(client, context, id, action === "activate") };
  });
}
