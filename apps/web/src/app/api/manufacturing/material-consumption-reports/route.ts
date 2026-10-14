import { getMaterialConsumptionReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a consumption report (?kind=by-mo|by-component|by-date|by-batch|planned-vs-actual|variance|issued-vs-consumed|scrap-return|actual-cost|wip|traceability|
// approval-history|unreconciled &from=&to=&orderId=&itemId=&batchId=&serial=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "by-date";
  const filters = Object.fromEntries(["from", "to", "orderId", "itemId", "batchId", "serial"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getMaterialConsumptionReport(client, context, kind, filters) }));
}
