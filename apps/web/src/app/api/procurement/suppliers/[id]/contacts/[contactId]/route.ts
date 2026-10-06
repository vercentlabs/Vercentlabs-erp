import { setSupplierContactStatus, updateSupplierContact } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string; contactId: string }> };

// Body: role, isPrimary and the person's details; or { active: false | true } to end or restore the relationship.
export async function PATCH(request: Request, ctx: Params) {
  const { id, contactId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) =>
    typeof input.active === "boolean" ? await setSupplierContactStatus(client, context, id, contactId, input.active) : await updateSupplierContact(client, context, id, contactId, input));
}
