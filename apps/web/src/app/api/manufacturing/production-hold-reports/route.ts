import { getProductionHoldReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a production hold report (?kind=active|by-reason|by-severity|downtime|by-mo|aging|material-shortage|quality|equipment|sales-risk|subassembly|audit &from=&to=&orderId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "active";
  const filters = Object.fromEntries(["from", "to", "orderId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getProductionHoldReport(client, context, kind, filters) }));
}
