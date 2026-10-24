import { getFieldDay } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The salesperson's day for the phone (Sales report Phase 4): today's beats, retailers and products, cached for offline use.
// ?date=YYYY-MM-DD, ?all=1 for every beat of the salesperson.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return salesRead(request, "sales.order.create", async (client, context) =>
    getFieldDay(client, context, { date: url.searchParams.get("date") ?? undefined, allBeats: url.searchParams.get("all") === "1" }));
}
