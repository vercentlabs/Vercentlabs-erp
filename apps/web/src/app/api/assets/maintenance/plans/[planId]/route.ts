import { getMaintenancePlan } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

type Params = { params: Promise<{ planId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { planId } = await ctx.params;
  return assetsRead(request, (client, context) => getMaintenancePlan(client, context, planId));
}
