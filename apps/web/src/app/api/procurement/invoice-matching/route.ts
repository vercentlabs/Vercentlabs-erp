import { getInvoiceMatchingWorkbench } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The invoice matching workbench (?view=all|two_way|three_way|matched|exceptions, ?supplierId, ?search): PO-based bills with their latest match.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["view", "supplierId", "search"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return procurementRead(request, async (client, context) => ({ matching: await getInvoiceMatchingWorkbench(client, context, filters) }), "procurement.view");
}
