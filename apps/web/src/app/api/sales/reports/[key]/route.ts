import { getSalesReport } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The domain enforces sales.reports.view (and sales.margin.view for the margin
// report) and an allow-list of report keys; the route's own gate is the
// module-level read permission.
export async function GET(_request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  return salesRead("sales.reports.view", async (client, context) => ({ rows: await getSalesReport(client, context, key) }));
}
