import { checkSupplierContactDuplicates, getSupplier } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

// The same person already at this supplier or elsewhere in the organization, while a contact is typed. Body: the person; exceptRelationshipId when editing.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    await getSupplier(client, context, id);
    return { matches: await checkSupplierContactDuplicates(client, context, id, input, typeof input.exceptRelationshipId === "string" ? input.exceptRelationshipId : null) };
  });
}
