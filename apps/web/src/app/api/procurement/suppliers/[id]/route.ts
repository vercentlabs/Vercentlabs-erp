import { deleteSupplier, getSupplier, updateSupplier } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => await getSupplier(client, context, id));
}

// Body: any supplier fields and expectedVersion. Identity, tax details and commercial defaults each need their own permission.
export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => await updateSupplier(client, context, id, input));
}

// Only a supplier created by mistake and never used.
export async function DELETE(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await deleteSupplier(client, context, id) }));
}
