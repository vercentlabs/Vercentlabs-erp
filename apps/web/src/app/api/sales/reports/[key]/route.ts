import { getSalesReport } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The domain enforces sales.reports.view (and sales.margin.view for the margin
// report) and an allow-list of report keys; the route's own gate is the
// module-level read permission. Filters (Line-by-line audit S6): ?from=&to=
// (YYYY-MM-DD) or ?financialYear=2026, &customerId=, &salespersonId=; &registrationId= (GSTIN) and &currency= (Sales plan).
export async function GET(
  request: Request,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params;
  const url = new URL(request.url);
  const filters = Object.fromEntries(
    ["from", "to", "financialYear", "customerId", "salespersonId", "registrationId", "currency"]
      .map((name) => [name, url.searchParams.get(name) ?? undefined])
      .filter(([, value]) => value),
  );
  return salesRead(request, "sales.reports.view", async (client, context) => ({
    rows: await getSalesReport(client, context, key, filters),
  }));
}
