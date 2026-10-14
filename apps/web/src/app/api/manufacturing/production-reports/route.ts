import { getProductionReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a production report (?kind=summary|batches|planned-vs-accepted|yield|accepted-unreceived|receipts|material-per-batch|wip|cost|sales-linked|over-short|corrections|exceptions
// &from=&to=&orderId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "summary";
  const filters = Object.fromEntries(["from", "to", "orderId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getProductionReport(client, context, kind, filters) }));
}
