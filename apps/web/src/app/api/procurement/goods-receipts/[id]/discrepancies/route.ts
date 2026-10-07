import { recordReceiptDiscrepancy } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Records a shortage, damage, wrong item, excess or other discrepancy on a receipt.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await recordReceiptDiscrepancy(client, context, id, input) }), 201, "procurement.receipts.manage");
}
