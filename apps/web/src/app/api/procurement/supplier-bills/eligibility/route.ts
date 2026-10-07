import { getBillablePurchaseOrderQuantity } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// ?order= : per order line, what was ordered, received and billed, and what may still be billed (with its receipts). ?bill= excludes a draft being edited.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return procurementRead(request, async (client, context) => ({
    eligibility: await getBillablePurchaseOrderQuantity(client, context, url.searchParams.get("order") ?? "", { excludeBillId: url.searchParams.get("bill") || null }),
  }), "procurement.bills.view");
}
