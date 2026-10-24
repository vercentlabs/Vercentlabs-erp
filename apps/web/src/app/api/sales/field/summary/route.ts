import { getFieldSummary } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The salesperson's day: orders, money collected and retailers seen (?date=YYYY-MM-DD).
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? undefined;
  return salesRead(request, "sales.order.create", async (client, context) => getFieldSummary(client, context, { date }));
}
