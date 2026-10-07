import { getSupplierBillOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What the bill form chooses from: suppliers, expense and asset accounts, tax categories, TDS sections, terms, currencies, registrations, bank accounts.
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ options: await getSupplierBillOptions(client, context) }), "procurement.bills.view");
}
