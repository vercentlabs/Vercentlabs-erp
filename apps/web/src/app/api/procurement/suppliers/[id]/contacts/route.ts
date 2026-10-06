import { addSupplierContact } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

// Body: contactId (an existing contact) or a new person, role, isPrimary.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => await addSupplierContact(client, context, id, input), 201);
}
