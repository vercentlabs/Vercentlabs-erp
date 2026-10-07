import { getProcurementReport } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// One Procurement report (?supplierId=&buyingRegistrationId=&from=&to=&status=): its columns and rows, each row linking to its source document.
const FILTERS = ["supplierId", "buyingRegistrationId", "from", "to", "status"];

export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => ({ report: await getProcurementReport(client, context, report, filters) }), "procurement.view");
}
