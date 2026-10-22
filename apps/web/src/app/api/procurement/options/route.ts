import { listProcurementFormOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Suppliers, items, warehouses, units, categories and purchase payment terms for the configuration forms and list filters -- scoped
// to the caller's organization by the domain function. Suppliers and items are a first page plus ?supplierIds= / ?itemIds=.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return procurementRead(request, async (client, context) => ({
    options: await listProcurementFormOptions(client, context, { supplierIds: params.get("supplierIds") ?? "", itemIds: params.get("itemIds") ?? "" }),
  }));
}
