import { getSupplierBillOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What the bill form chooses from: suppliers, expense and asset accounts, tax categories, TDS sections, terms, currencies, registrations,
// bank accounts. Suppliers are a first page plus the ones the form holds (?supplierIds=).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return procurementRead(request, async (client, context) => ({
    options: await getSupplierBillOptions(client, context, { supplierIds: params.get("supplierIds") ?? "" }),
  }), "procurement.bills.view");
}
