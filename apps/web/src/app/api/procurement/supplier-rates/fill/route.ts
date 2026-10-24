import { fillSupplierRatesFromOrders } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A first price list from the last 12 months of orders (the latest price per supplier, item and unit), for the buyer to check.
export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await fillSupplierRatesFromOrders(client, context, {}) }));
}
