import { z } from "zod";

import { approveSalesCommission } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// F057: approve an accrued commission (not your own).
const schema = z.object({}).passthrough();

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", schema, async (client, context) => ({ result: await approveSalesCommission(client, context, id) }));
}
