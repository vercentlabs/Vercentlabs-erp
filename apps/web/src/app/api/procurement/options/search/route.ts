import { searchProcurementOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The Procurement pickers' search (Procurement plan Phase 0): ?kind=suppliers|products&search=&ids=&supplierId=&activeOnly=true.
// Suppliers by name, number or GSTIN; products by name, code, SKU, barcode or HSN, each with its last purchase price from supplierId.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return procurementRead(request, async (client, context) => searchProcurementOptions(client, context, {
    kind: params.get("kind") ?? "suppliers", search: params.get("search") ?? "", ids: params.get("ids") ?? "", supplierId: params.get("supplierId"),
    activeOnly: params.get("activeOnly") === "true",
  }));
}
