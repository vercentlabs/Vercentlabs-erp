import { getMaintenanceRequest } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

type Params = { params: Promise<{ requestId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { requestId } = await ctx.params;
  return assetsRead(request, (client, context) => getMaintenanceRequest(client, context, requestId));
}
