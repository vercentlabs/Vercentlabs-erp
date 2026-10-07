import { getPurchaseOrderDefaults } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What a new order for a supplier starts from, and each product's suggested purchase cost (a suggestion only).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return procurementRead(request, async (client, context) => ({
    defaults: await getPurchaseOrderDefaults(client, context, { supplierId: url.searchParams.get("supplierId") ?? undefined, productIds: url.searchParams.get("productIds") ?? "" }),
  }), "procurement.po.create");
}
