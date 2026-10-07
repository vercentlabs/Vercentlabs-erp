import { getRejection, updateOpenRejection } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// One rejection case with its links, resolutions, evidence and history; correcting an open case's reason, notes and expected resolution.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => getRejection(client, context, id), "procurement.rejections.view");
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await updateOpenRejection(client, context, id, input) }), 200, "procurement.rejections.edit");
}
