import { resolveSupplierBillDefaults } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// ?supplier= : what a new bill for this supplier starts from (currency, terms, GSTIN, address, TDS section, company registration).
export async function GET(request: Request) {
  const supplierId = new URL(request.url).searchParams.get("supplier") ?? "";
  return procurementRead(request, async (client, context) => ({ defaults: await resolveSupplierBillDefaults(client, context, supplierId) }), "procurement.bills.view");
}
