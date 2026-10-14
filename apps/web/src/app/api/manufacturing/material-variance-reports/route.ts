import { getMaterialVarianceReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a material usage variance report (?kind=by-mo|by-component|by-product|by-batch|by-period|favorable-unfavorable|cost|scrap-vs-consumption|by-reason|approvals|open-exceptions
// |bom-review-candidates &from=&to=&orderId=&itemId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "by-mo";
  const filters = Object.fromEntries(["from", "to", "orderId", "itemId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getMaterialVarianceReport(client, context, kind, filters) }));
}
