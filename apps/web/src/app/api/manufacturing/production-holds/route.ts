import { getHeldManufacturingOrders, getProductionHoldSummary } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Production holds (?status=ACTIVE|RESUMED|CLOSED|all&severity=&reason=&orderId=&overdue=true&from=&to=&search=) with the queue's key figures.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "severity", "reason", "orderId", "overdue", "from", "to", "search"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ holds: await getHeldManufacturingOrders(client, context, filters), summary: await getProductionHoldSummary(client, context) }));
}
