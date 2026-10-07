import { listProcurementFormOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Suppliers, items, warehouses, units, categories and purchase payment terms for the
// configuration forms -- scoped to the caller's organization by the domain function.
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({
    options: await listProcurementFormOptions(client, context),
  }));
}
