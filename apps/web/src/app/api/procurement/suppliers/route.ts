import { createSupplier, listSuppliers } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";
import { supplierFiltersFromUrl } from "@/features/procurement/suppliers/server/supplier-http";

// Procurement → Suppliers: the list (views, search, filters) and New Supplier. Every check is the Supplier Master's.
export async function GET(request: Request) {
  const filters = supplierFiltersFromUrl(new URL(request.url));
  return procurementRead(request, async (client, context) => await listSuppliers(client, context, filters));
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ supplier: await createSupplier(client, context, input) }), 201);
}
