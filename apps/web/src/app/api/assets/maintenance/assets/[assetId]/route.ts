import { getAssetMaintenancePanel } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET the asset's Maintenance & Warranty panel: restrictions, active repairs, plans, history, downtime, warranty and (with permission) costs.
type Params = { params: Promise<{ assetId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { assetId } = await ctx.params;
  return assetsRead(request, (client, context) => getAssetMaintenancePanel(client, context, assetId));
}
