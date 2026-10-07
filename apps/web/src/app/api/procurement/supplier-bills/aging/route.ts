import { getSupplierBillAging } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What posted bills still owe, by how overdue, per supplier.
export async function GET(request: Request) {
  const supplierId = new URL(request.url).searchParams.get("supplierId") ?? undefined;
  return procurementRead(request, async (client, context) => ({ rows: await getSupplierBillAging(client, context, { supplierId }) }), "procurement.bills.view");
}
