import { getProductionCostReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a production costing report (?kind=by-mo|planned-vs-actual|unit-cost|material-breakdown|applied|batches|wip|wip-aging|scrap-rejection|receipts|short-closed|sales-linked
// |exceptions|inventory-to-gl &from=&to=&orderId=&itemId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "by-mo";
  const filters = Object.fromEntries(["from", "to", "orderId", "itemId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getProductionCostReport(client, context, kind, filters) }));
}
