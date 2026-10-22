import { listMsmePayments } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// MSME Payments (MSMED Act s.15): open statutory deadlines with what each bill still owes, by days left (?bucket=&supplierId=&search=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return procurementRead(request, async (client, context) =>
    listMsmePayments(client, context, { bucket: url.searchParams.get("bucket") ?? undefined, supplierId: url.searchParams.get("supplierId") ?? undefined,
      search: url.searchParams.get("search") ?? undefined }), "procurement.bills.view");
}
