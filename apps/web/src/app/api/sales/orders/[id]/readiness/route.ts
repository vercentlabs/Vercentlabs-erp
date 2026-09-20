import { assessSalesOrderReadiness } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead("sales.view", async (client, context) => ({ readiness: await assessSalesOrderReadiness(client, context, id) }));
}
