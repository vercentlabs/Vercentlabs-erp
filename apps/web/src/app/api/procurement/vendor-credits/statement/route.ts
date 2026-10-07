import { getSupplierCreditBalance, getSupplierCreditStatement } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// A supplier's credit statement (?supplierId=&from=&to=) and unapplied balance.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const supplierId = url.searchParams.get("supplierId") ?? "";
  return procurementRead(request, async (client, context) => ({
    statement: await getSupplierCreditStatement(client, context, supplierId, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }),
    balance: await getSupplierCreditBalance(client, context, supplierId),
  }), "procurement.view");
}
