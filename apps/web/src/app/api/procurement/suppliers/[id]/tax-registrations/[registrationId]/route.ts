import { updateSupplierTaxRegistration } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string; registrationId: string }> };

// Body: registrationType, status ("active" | "inactive").
export async function PATCH(request: Request, ctx: Params) {
  const { id, registrationId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => await updateSupplierTaxRegistration(client, context, id, registrationId, input));
}
