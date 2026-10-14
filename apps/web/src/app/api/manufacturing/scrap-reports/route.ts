import { getScrapReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a scrap report (?kind=by-mo|by-component|by-reason|by-batch|by-date|planned-vs-actual|cost|normal-abnormal|rejected-disposition|recoverable|by-location|approvals
// &from=&to=&orderId=&itemId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "by-date";
  const filters = Object.fromEntries(["from", "to", "orderId", "itemId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getScrapReport(client, context, kind, filters) }));
}
