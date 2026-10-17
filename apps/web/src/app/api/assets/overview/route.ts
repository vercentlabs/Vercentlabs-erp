import { getAssetsDashboard } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET the Assets dashboard: what needs attention in every workflow the person may see, quick actions, recent activity.
export async function GET(request: Request) {
  return assetsRead(request, (client, context) => getAssetsDashboard(client, context));
}
