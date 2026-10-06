import { checkSupplierAddressDuplicates, getSupplier } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

// Likely the same place already on file, while an address is typed. Body: the address; exceptAddressId when editing.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    await getSupplier(client, context, id);
    return { matches: await checkSupplierAddressDuplicates(client, context, id, input, typeof input.exceptAddressId === "string" ? input.exceptAddressId : null) };
  });
}
