import { getProductionSummary } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Production summary and variance by order (?from=&to=&status=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = { from: url.searchParams.get("from") || undefined, to: url.searchParams.get("to") || undefined, status: url.searchParams.get("status") || undefined };
  return manufacturingRead(request, async (client, context) => ({ summary: await getProductionSummary(client, context, filters) }));
}
