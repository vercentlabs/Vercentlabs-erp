import { createSupplierQuotation, listSupplierQuotations } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Supplier quotations, and recording one.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "supplierId", "search"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => ({ rows: await listSupplierQuotations(client, context, filters) }), "procurement.po.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createSupplierQuotation(client, context, input) }), 201, "procurement.quotations.manage");
}
