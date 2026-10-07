import { createPurchaseReturn, listPurchaseReturns } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Purchase returns: the list (views and filters) and a new draft return.
const FILTERS = ["view", "status", "supplierId", "purchaseOrderId", "goodsReceiptId", "warehouseId", "dateFrom", "dateTo", "reason", "financialStatus", "resolutionStatus",
  "replacementStatus", "createdBy", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => ({ rows: await listPurchaseReturns(client, context, filters) }), "procurement.returns.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createPurchaseReturn(client, context, input) }), 201, "procurement.returns.manage");
}
