import { getProcurementReport } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The domain requires procurement.reports.view and allow-lists the report key.
export async function GET(_request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  return procurementRead(async (client, context) => ({ report: await getProcurementReport(client, context, key) }), "procurement.reports.view");
}
