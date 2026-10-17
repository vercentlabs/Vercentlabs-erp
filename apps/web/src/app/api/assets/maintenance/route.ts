import { getMaintenanceOverview } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET the Maintenance workspace overview: open requests and Work Orders by stage, assets under maintenance, service due, exceptions.
export async function GET(request: Request) {
  return assetsRead(request, (client, context) => getMaintenanceOverview(client, context));
}
