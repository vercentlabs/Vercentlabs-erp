import { getMaterialIssueReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a material issue report (?kind=by-mo|by-date|by-warehouse|by-component|planned-vs-issued|issued-vs-consumed|issued-vs-returned|usage-variance|
// traceability|unreconciled-custody|approval-history|posting-exceptions &from=&to=&warehouseId=&orderId=&itemId=&batchId=&serial=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "by-date";
  const filters = Object.fromEntries(["from", "to", "warehouseId", "orderId", "itemId", "batchId", "serial"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getMaterialIssueReport(client, context, kind, filters) }));
}
