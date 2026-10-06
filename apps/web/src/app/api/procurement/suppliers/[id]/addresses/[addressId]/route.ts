import { setSupplierAddressStatus, updateSupplierAddress } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string; addressId: string }> };

// Body: address fields and isPrimary; or { active: false | true } to remove or restore the address.
export async function PATCH(request: Request, ctx: Params) {
  const { id, addressId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) =>
    typeof input.active === "boolean" ? await setSupplierAddressStatus(client, context, id, addressId, input.active) : await updateSupplierAddress(client, context, id, addressId, input));
}
