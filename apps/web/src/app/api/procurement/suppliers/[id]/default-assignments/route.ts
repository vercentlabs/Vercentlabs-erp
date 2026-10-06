import { setDefaultSupplierAddress, setSupplierContactForPurpose } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

// Body: kind ("address" | "contact"), purpose, id (a location or contact relationship of this supplier; null clears the default).
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    const target = typeof input.id === "string" && input.id ? input.id : null;
    const purpose = String(input.purpose ?? "");
    return input.kind === "contact" ? await setSupplierContactForPurpose(client, context, id, purpose, target) : await setDefaultSupplierAddress(client, context, id, purpose, target);
  });
}
