import { approveSupplierBill } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Finance approves a bill (or debit note) awaiting approval; it is then posted.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await approveSupplierBill(client, context, id) }), 200, "accounting.payables.approve");
}
