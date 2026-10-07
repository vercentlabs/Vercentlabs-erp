import { getPurchaseOrderRemainingReceivableQty } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What each line may still receive, and what other draft receipts hold (a warning, not a reservation): the Create Goods Receipt form.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const except = new URL(request.url).searchParams.get("exceptReceiptId");
  return procurementRead(request, async (client, context) => ({ receivable: await getPurchaseOrderRemainingReceivableQty(client, context, id, { exceptReceiptId: except || null }) }),
    "procurement.po.view");
}
