import { getSalesPerformance } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Salesperson performance for a month (Sales audit): ?month=YYYY-MM
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  return salesRead(request, "sales.view", async (client, context) => ({ performance: await getSalesPerformance(client, context, { month }) }));
}
