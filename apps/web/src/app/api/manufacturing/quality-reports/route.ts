import { getQualityReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a quality report (?kind=pending|by-mo|rates|by-product|defects-by-reason|defects-by-severity|holds|rework|rejected-awaiting-scrap|batch-history|failed-measurements
// |turnaround|inspectors|corrections|quality-to-receipt &from=&to=&orderId=&itemId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "by-mo";
  const filters = Object.fromEntries(["from", "to", "orderId", "itemId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getQualityReport(client, context, kind, filters) }));
}
