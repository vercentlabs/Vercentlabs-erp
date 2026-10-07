import { getOverdueSupplierObligations, getUpcomingSupplierPayments } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Supplier payment obligations: instalments overdue (and statutory deadlines breached) and those due in the coming days (?days=30&supplierId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = { supplierId: url.searchParams.get("supplierId") ?? undefined, days: url.searchParams.get("days") ?? undefined };
  return procurementRead(request, async (client, context) => ({
    overdue: await getOverdueSupplierObligations(client, context, filters),
    upcoming: await getUpcomingSupplierPayments(client, context, filters),
  }), "procurement.view");
}
