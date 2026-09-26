import { listProcurementPass1Options } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Suppliers, orders, receipts, items, warehouses, sourcing events and units for
// pickers -- scoped to the caller's company by the domain function.
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ options: await listProcurementPass1Options(client, context) }));
}
