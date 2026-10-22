import { saveSalesRoute } from "@vercentlabs/api";

import { beatSchema } from "@/features/sales/settings/server/beat-schema";
import { salesMutation } from "@/features/sales/shared/route-helpers";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", beatSchema, async (client, context, input) => saveSalesRoute(client, context, input, id));
}
