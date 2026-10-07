import { getEligibleRejectableQuantity, recordPostReceiptRejection } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// What of a posted receipt line may still be rejected; rejecting goods already received (held goods by Quality, usable goods into quarantine).
type Params = { params: Promise<{ lineId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { lineId } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ eligible: await getEligibleRejectableQuantity(client, context, lineId) }), "procurement.rejections.view");
}

export async function POST(request: Request, ctx: Params) {
  const { lineId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await recordPostReceiptRejection(client, context, lineId, input) }), 201,
    "procurement.rejections.view");
}
