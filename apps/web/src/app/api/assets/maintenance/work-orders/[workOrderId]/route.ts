import { getMaintenanceWorkOrder } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

type Params = { params: Promise<{ workOrderId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { workOrderId } = await ctx.params;
  return assetsRead(request, (client, context) => getMaintenanceWorkOrder(client, context, workOrderId));
}
