import { createPurchaseOrder, listPurchaseOrders } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The purchase order list (views, search, filters) and creating a draft.
const FILTERS = ["view", "search", "supplierId", "buyerId", "status", "warehouseId", "receiptStatus", "billingStatus", "overdue", "dateFrom", "dateTo", "limit", "offset"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => listPurchaseOrders(client, context, filters), "procurement.po.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createPurchaseOrder(client, context, input) }), 201, "procurement.po.create");
}
