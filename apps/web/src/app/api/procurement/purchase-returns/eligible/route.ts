import { getReturnableGoodsReceiptLines } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// ?order= or ?receipt= (&exclude= a draft being edited): per receipt line what may still be returned — entitlement, usable stock, held and rejected goods.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return procurementRead(request, async (client, context) => ({
    eligible: await getReturnableGoodsReceiptLines(client, context, { purchaseOrderId: url.searchParams.get("order") || null, goodsReceiptId: url.searchParams.get("receipt") || null,
      excludeReturnId: url.searchParams.get("exclude") || null }),
  }), "procurement.returns.view");
}
