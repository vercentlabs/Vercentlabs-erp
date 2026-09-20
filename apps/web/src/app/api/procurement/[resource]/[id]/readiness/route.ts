import { assessProcurementRecordReadiness } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

export async function GET(_request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return procurementRead(async (client, context) => ({ readiness: await assessProcurementRecordReadiness(client, context, resource, id) }));
}
