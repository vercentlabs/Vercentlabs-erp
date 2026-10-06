import { addSupplierTaxRegistration, getSupplier, listSupplierTaxRegistrations } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => {
    const { supplier } = await getSupplier(client, context, id);
    return { registrations: await listSupplierTaxRegistrations(client, context.organizationId, supplier.id) };
  });
}

// Body: gstin, registrationType.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => await addSupplierTaxRegistration(client, context, id, input), 201);
}
